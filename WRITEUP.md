# Holly Take-Home: Writeup

## How to Run

### Option 1: Docker (Recommended)

```bash
cp .env.example .env.local
# Edit .env.local and add your OpenAI API key

docker compose up --build
```

Open [http://localhost:3000/chat](http://localhost:3000/chat).

### Option 2: Local Development

```bash
cp .env.example .env.local
# Edit .env.local and add your OpenAI API key

npm install
npm run dev
```

Open [http://localhost:3000/chat](http://localhost:3000/chat).

### Running Tests

```bash
# Via Docker (recommended)
docker compose build test
docker compose run --rm test

# Locally
npm test
```

### Running Benchmarks

```bash
npm run benchmark
```

---

## Approach

### Architecture Overview

The application has four distinct layers:

```
User Query
  → Query Parser (tokenize, remove stopwords, detect jurisdiction)
  → N-gram Inverted Index (score candidates, return top matches)
  → LLM (GPT-4o-mini receives ONLY matched records, streams response)
  → Chat UI (displays streaming response token-by-token)
```

### Data Processing (`app/lib/data.ts`)

On first request, both JSON files are loaded and joined on `jurisdiction + code`. The salary data uses different field casing (`Jurisdiction` vs `jurisdiction`, `Job Code` vs `code`) which is normalized during the join. Salary values with leading/trailing whitespace are trimmed. The joined records are cached in `globalThis` so they persist across requests and survive HMR reloads in development.

Salary records with no matching job description (e.g., `kerncounty/0265` which appears in salaries but not in job descriptions) are silently dropped — we only surface records that have job descriptions.

### Matching Strategy (`app/lib/index.ts`)

This is the core of the solution. The matching engine uses a hand-built **n-gram inverted index** with **two-phase query processing**:

**Phase 1: Index Construction (one-time, cached)**

1. **Jurisdiction alias derivation**: Concatenated jurisdiction keys are split into tokens using a greedy word-boundary algorithm (e.g., `"sanbernardino"` → `["san", "bernardino"]`, `"sdcounty"` → `["sd", "county"]`). Common abbreviations are expanded (e.g., `"sd"` also maps to `"san"`, `"diego"`). This is derived from the data itself rather than hardcoded per-jurisdiction, so new jurisdictions following the same naming conventions are handled automatically.

2. **Title n-gram indexing**: Each job title is normalized (lowercased, punctuation stripped) and tokenized. Unigrams, bigrams, and trigrams are generated and stored in an inverted index (`Map<string, Set<number>>`). For example, "Assistant Chief Probation Officer" generates:
   - Unigrams: `"assistant"`, `"chief"`, `"probation"`, `"officer"`
   - Bigrams: `"assistant chief"`, `"chief probation"`, `"probation officer"`
   - Trigrams: `"assistant chief probation"`, `"chief probation officer"`

**Phase 2: Query Processing (per request)**

1. **Normalize and filter**: The query is lowercased, tokenized, and stopwords are removed.

2. **Jurisdiction detection**: Query tokens are matched against jurisdiction aliases. If a jurisdiction is confidently detected (at least one non-"county" token matches), the candidate set is narrowed to that jurisdiction's records only. This prevents false matches when the same job title exists in multiple jurisdictions.

3. **Title abbreviation expansion**: Common abbreviations like "DA" → "district attorney" and "HR" → "human resources" are expanded before scoring.

4. **N-gram scoring**: Query n-grams are looked up in the inverted index. Each match adds to a candidate's score, weighted by n-gram length (trigram = 5, bigram = 3, unigram = 1). This weighting ensures that longer consecutive matches are strongly preferred — "assistant chief probation" scores much higher than three scattered unigram matches.

5. **Result filtering**: Results within 50% of the top score are returned (capped at 5) to handle ambiguous queries where multiple records are relevant.

**What I chose NOT to use (and why):**

- No fuzzy matching libraries (as required). The n-gram approach naturally handles partial matches and word order variation.
- No embeddings or vector search. While powerful, it would add infrastructure complexity (vector DB) and obscure the matching logic. The n-gram approach is transparent, debuggable, and sufficient for this domain.
- No LLM-based query extraction as a first pass. While I considered using the LLM to extract structured `{title, jurisdiction}` from the query, I wanted the matching logic to be demonstrably my own engineering work, not delegated to the LLM.

### Input Sanitization (`app/lib/sanitize.ts`, `app/lib/rate-limit.ts`)

All user input is validated and sanitized at the server boundary:

- **Type validation**: Input must be a string (rejects non-string payloads).
- **Length limits**: Messages capped at 500 characters, history at 50 messages.
- **HTML stripping**: Tags are removed via regex as defense-in-depth against XSS. React already escapes content in JSX, but the LLM might echo user input.
- **Rate limiting**: In-memory per-IP limiter (20 requests/minute) prevents abuse. Returns 429 with `Retry-After` header. Note: for multi-instance deployments, this would need a shared store (Redis).
- **History validation**: Each message in conversation history is validated for correct shape (`id`, `role`, `content`) — malformed entries are silently dropped.

### LLM Integration (`app/lib/llm.ts`)

- **GPT-4o-mini** for cost efficiency and speed.
- **Streaming responses**: The route handler uses OpenAI's streaming API (`stream: true`), piping chunks through a `ReadableStream` so tokens appear in the UI as they're generated.
- The system prompt instructs the model to use ONLY the provided records and to disambiguate when multiple jurisdictions match.
- Matched records are injected as a system message immediately before the user's latest message, placing them in the most relevant attention position.
- Conversation history (last 10 messages) is included for multi-turn context, so users can ask follow-up questions.
- Temperature is set to 0.3 for factual accuracy.
- The OpenAI client is lazily instantiated via `globalThis` to avoid build-time errors in Docker (where the API key isn't available during `npm run build`).

### Chat UI (`app/chat/page.tsx`)

- **Streaming display**: Responses appear token-by-token as they're generated, using `fetch` + `ReadableStream` reader.
- **Animated typing indicator**: Three bouncing dots shown while waiting for the first token.
- **Suggestion chips**: Empty state shows clickable example queries to guide first-time users.
- **Timestamps**: Each message displays when it was sent/received.
- **Character counter**: Appears near the input limit (500 chars) to prevent truncation.
- **Error handling**: Failed responses show in red with a "Retry" button. Rate limit responses show a wait message.
- Auto-scroll to the latest message. Enter to send, Shift+Enter for newline.

### Server Action (`app/chat/actions.ts`) & Route Handler (`app/api/chat/route.ts`)

The streaming route handler is the primary entry point for the chat UI. It validates input (sanitization + rate limiting), runs the search engine, and streams the LLM response. The server action is retained as a non-streaming path used by the integration test suite.

Both paths implement the same contextual fallback: if the current query yields no matches and there's conversation history, the last user message is combined with the current query and re-searched.

---

## Performance & Scale

Benchmarks measured on Apple Silicon (M-series), Node.js 20, averaged over 100 iterations per scale factor.

| Scale | Records | Build (avg) | Build (median) | Query (avg) | Query (p99) | Memory  |
|-------|---------|-------------|----------------|-------------|-------------|---------|
| 1x    | 8       | 0.024ms     | 0.019ms        | <0.01ms     | <0.01ms     | 0.1MB   |
| 10x   | 80      | 0.174ms     | 0.140ms        | <0.01ms     | 0.016ms     | 1.4MB   |
| 100x  | 800     | 1.01ms      | 0.982ms        | 0.034ms     | 0.112ms     | 2.5MB   |

**Per-query breakdown (1x):**

| Query Type           | Avg Latency | Results |
|---------------------|-------------|---------|
| Exact + jurisdiction | <0.01ms     | 1       |
| Partial title        | <0.01ms     | 2       |
| Jurisdiction only    | <0.01ms     | 3       |
| Abbreviation         | <0.01ms     | 1       |
| No match             | <0.01ms     | 0       |
| Natural language     | <0.01ms     | 1       |

### Analysis

- **Index build scales linearly**: 0.024ms → 0.174ms → 1.01ms tracks the ~10x record increases, confirming O(R × T) complexity.
- **Query time stays sub-millisecond at 100x**: The inverted index lookup is O(G × M) where G = query n-grams (typically <15) and M = posting list size. The jurisdiction filter reduces M proportionally.
- **Memory is modest**: 2.5MB for 800 records. The index stores integer indices (not full records), keeping the overhead proportional to total n-gram postings.
- **At 10,000+ records**: The algorithmic approach remains sound. Potential optimizations would be: persistent index (avoid rebuild on cold start), jurisdiction-based sharding, and moving the inverted index to a search engine (Elasticsearch/Meilisearch) while keeping the same scoring logic.

---

## Test Coverage

**56 tests across 4 test files:**

- **`__tests__/index.test.ts`** (34 tests): Index construction, exact/partial matching, abbreviations, jurisdiction disambiguation, jurisdiction-only queries, natural language, edge cases, scoring correctness.
- **`__tests__/llm.test.ts`** (8 tests): System prompt validation, context injection, empty records handling, history limits, model parameters, fallback messages, multi-record context.
- **`__tests__/actions.test.ts`** (6 tests): Full pipeline integration (search → LLM with mocked OpenAI), input validation, contextual follow-ups.
- **`__tests__/sanitize.test.ts`** (11 tests): Type validation, length limits, HTML stripping, history validation and capping.

---

## Data Observations

- The same job title ("Assistant Chief Probation Officer") exists in two jurisdictions (`sanbernardino` and `ventura`). The matching engine handles this by returning both when no jurisdiction is specified, and the LLM disambiguates by presenting both options.
- Salary field casing differs between the two JSON files (`jurisdiction` vs `Jurisdiction`). This is normalized during the data join.
- Some salary records have an optional `Approval Date` field with an inconsistent schema across records.
- One salary record (`kerncounty/0265`) has no matching job description — it's dropped during the join rather than surfaced with incomplete data.
- Salary values have mixed formats: some are hourly rates (e.g., `$70.38`), others appear to be monthly (e.g., `$3,119.39`) with leading/trailing whitespace that is trimmed during loading.

---

## Technologies Used

- **Next.js 15.3.1** with App Router and streaming Route Handler
- **React 19** with streaming fetch for real-time token display
- **TypeScript 5** (strict mode)
- **Tailwind CSS v4** (CSS-based configuration)
- **OpenAI GPT-4o-mini** via the `openai` npm package (streaming API)
- **Vitest** for unit and integration testing
- **Docker** with multi-stage build for production deployment

---

## Challenges

1. **Jurisdiction matching**: The concatenated jurisdiction keys (e.g., `"sdcounty"`, `"sanbernardino"`) needed to be split into human-readable tokens and expanded with common abbreviations. A greedy word-boundary splitting algorithm handles this.

2. **Same title across jurisdictions**: Required the two-phase approach (filter by jurisdiction first, then score by title) rather than a simpler flat search.

3. **Docker build-time vs runtime environment**: The OpenAI client was initially instantiated at module load time, which caused the Docker build to fail (no API key available during `npm run build`). Fixed by lazy-instantiating the client on first use.

4. **Balancing matching precision with recall**: Pure token matching can be too broad ("assistant" matches many titles). The n-gram weighting system (trigrams weighted 5x more than unigrams) ensures that longer consecutive matches are strongly preferred, dramatically improving precision.

5. **Streaming architecture**: Server actions cannot return streaming responses. Solved by adding a Route Handler for the streaming path while retaining the server action for testability.

---

## AI Assistance

The architecture, matching strategy, and overall problem-solving approach are my own work. The n-gram inverted index design, two-phase jurisdiction filtering, weighted scoring system, and data join strategy were decisions I made based on the requirements.

I used Claude (Anthropic) as a coding assistant primarily for **Next.js syntax and patterns** — this is not a framework I use day-to-day, so AI helped me write idiomatic Next.js code (server actions, App Router conventions, streaming Route Handlers, Tailwind v4 configuration). I also used it to scaffold boilerplate and to help run a validation test suite across query categories.

All architectural decisions, the matching algorithm design, and the approach to scaling were mine.
