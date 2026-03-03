import type {
  JobRecord,
  SearchIndex,
  JurisdictionAlias,
  MatchResult,
} from "@/lib/types";
import { loadRecords } from "@/lib/data";

// ---- Constants ----

const STOPWORDS = new Set([
  "a", "an", "the", "in", "of", "for", "and", "or", "is", "are", "was",
  "were", "be", "been", "to", "from", "with", "at", "by", "on", "about",
  "what", "which", "who", "how", "do", "does", "can", "could", "would",
  "should", "tell", "me", "show", "describe", "explain", "give",
  "job", "jobs", "position", "positions", "role", "roles",
  "available", "list", "all", "any", "there",
]);

const NGRAM_WEIGHTS: Record<number, number> = { 1: 1, 2: 3, 3: 5 };

// Common abbreviations for job title words
const TITLE_ABBREVIATIONS: Record<string, string[]> = {
  da: ["district", "attorney"],
  hr: ["human", "resources"],
  apcd: ["apcd"],
};

// Known words for splitting concatenated jurisdiction keys
const KNOWN_WORDS = [
  "san", "bernardino", "ventura", "county", "diego", "kern",
  "los", "angeles", "orange", "riverside", "santa", "barbara",
  "cruz", "clara", "francisco", "joaquin", "luis", "obispo",
].sort((a, b) => b.length - a.length); // longest first for greedy matching

// Common abbreviations found in jurisdiction keys
const ABBREVIATION_MAP: Record<string, string[]> = {
  sd: ["san", "diego"],
  sb: ["san", "bernardino"],
  la: ["los", "angeles"],
};

// ---- Singleton cache (survives HMR in development) ----

const globalCache = globalThis as unknown as {
  __searchIndex?: SearchIndex;
};

// ---- Public API ----

export async function getIndex(): Promise<SearchIndex> {
  if (globalCache.__searchIndex) return globalCache.__searchIndex;
  const records = await loadRecords();
  globalCache.__searchIndex = buildIndex(records);
  return globalCache.__searchIndex;
}

export async function searchRecords(query: string): Promise<MatchResult[]> {
  const index = await getIndex();
  return matchQuery(query, index);
}

// ---- Index construction ----

/** @internal Exported for benchmarking */
export function buildIndex(records: JobRecord[]): SearchIndex {
  const jurisdictionAliases = deriveJurisdictionAliases(records);

  const ngramIndex = new Map<string, Set<number>>();
  const jurisdictionIndex = new Map<string, Set<number>>();

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    // Index by jurisdiction
    if (!jurisdictionIndex.has(record.jurisdiction)) {
      jurisdictionIndex.set(record.jurisdiction, new Set());
    }
    jurisdictionIndex.get(record.jurisdiction)!.add(i);

    // Generate n-grams from normalized title
    const titleTokens = normalize(record.title);
    const ngrams = generateNgrams(titleTokens, 3);

    for (const ng of ngrams) {
      if (!ngramIndex.has(ng)) {
        ngramIndex.set(ng, new Set());
      }
      ngramIndex.get(ng)!.add(i);
    }
  }

  return { records, jurisdictionAliases, ngramIndex, jurisdictionIndex };
}

function deriveJurisdictionAliases(records: JobRecord[]): JurisdictionAlias[] {
  const uniqueJurisdictions = [...new Set(records.map((r) => r.jurisdiction))];

  return uniqueJurisdictions.map((key) => {
    const expanded = expandJurisdictionKey(key);
    const allTokens = new Set<string>(expanded);

    // Also index the raw concatenated key
    allTokens.add(key);

    // Expand abbreviations (e.g. "sd" -> "san", "diego")
    for (const token of expanded) {
      if (ABBREVIATION_MAP[token]) {
        for (const expansion of ABBREVIATION_MAP[token]) {
          allTokens.add(expansion);
        }
      }
    }

    const label = expanded
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    return { key, label, tokens: [...allTokens] };
  });
}

/**
 * Splits a concatenated jurisdiction key into component words.
 * e.g. "sanbernardino" -> ["san", "bernardino"]
 *      "sdcounty" -> ["sd", "county"]
 */
function expandJurisdictionKey(key: string): string[] {
  const result: string[] = [];
  let remaining = key.toLowerCase();

  while (remaining.length > 0) {
    let matched = false;

    for (const word of KNOWN_WORDS) {
      if (remaining.startsWith(word)) {
        result.push(word);
        remaining = remaining.slice(word.length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Find the next known word boundary
      let nextBoundary = remaining.length;
      for (const word of KNOWN_WORDS) {
        const idx = remaining.indexOf(word, 1);
        if (idx > 0 && idx < nextBoundary) {
          nextBoundary = idx;
        }
      }
      result.push(remaining.slice(0, nextBoundary));
      remaining = remaining.slice(nextBoundary);
    }
  }

  return result;
}

// ---- Text processing ----

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function generateNgrams(tokens: string[], maxN: number): string[] {
  const result: string[] = [];
  for (let n = 1; n <= Math.min(maxN, tokens.length); n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      result.push(tokens.slice(i, i + n).join(" "));
    }
  }
  return result;
}

// ---- Query parsing ----

interface ParsedQuery {
  jurisdictionKey: string | null;
  searchTokens: string[];
}

function parseQuery(
  query: string,
  aliases: JurisdictionAlias[]
): ParsedQuery {
  const tokens = normalize(query).filter((t) => !STOPWORDS.has(t));

  // Phase 1: Detect jurisdiction by matching tokens against aliases
  let bestJurisdiction: string | null = null;
  let bestJurisdictionScore = 0;
  let bestTokenIndices = new Set<number>();

  for (const alias of aliases) {
    let score = 0;
    const usedIndices = new Set<number>();

    for (const aliasToken of alias.tokens) {
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] === aliasToken && !usedIndices.has(i)) {
          score++;
          usedIndices.add(i);
          break;
        }
      }
    }

    if (score > bestJurisdictionScore) {
      bestJurisdictionScore = score;
      bestJurisdiction = alias.key;
      bestTokenIndices = usedIndices;
    }
  }

  // Require at least one non-"county" token to match for jurisdiction detection
  // "county" alone is too ambiguous
  if (bestJurisdiction && bestJurisdictionScore >= 1) {
    const nonCountyMatches = [...bestTokenIndices].filter(
      (i) => tokens[i] !== "county"
    );
    if (nonCountyMatches.length === 0) {
      bestJurisdiction = null;
      bestTokenIndices = new Set();
    }
  }

  // Phase 2: Remaining tokens (excluding jurisdiction matches) become search terms
  const rawSearchTokens = tokens.filter((_, i) => !bestTokenIndices.has(i));

  // Phase 3: Expand known title abbreviations (e.g. "DA" -> "district", "attorney")
  const searchTokens: string[] = [];
  for (const token of rawSearchTokens) {
    if (TITLE_ABBREVIATIONS[token]) {
      searchTokens.push(...TITLE_ABBREVIATIONS[token]);
    } else {
      searchTokens.push(token);
    }
  }

  return {
    jurisdictionKey: bestJurisdiction,
    searchTokens,
  };
}

// ---- Search and scoring ----

/** @internal Exported for benchmarking */
export function matchQuery(query: string, index: SearchIndex): MatchResult[] {
  const parsed = parseQuery(query, index.jurisdictionAliases);

  // Determine candidate set based on jurisdiction filter
  let candidates: Set<number>;
  if (
    parsed.jurisdictionKey &&
    index.jurisdictionIndex.has(parsed.jurisdictionKey)
  ) {
    candidates = new Set(
      index.jurisdictionIndex.get(parsed.jurisdictionKey)!
    );
  } else {
    candidates = new Set(index.records.map((_, i) => i));
  }

  if (parsed.searchTokens.length === 0) {
    return [...candidates].map((i) => ({
      record: index.records[i],
      score: 0,
    }));
  }

  // Generate n-grams from query and score candidates
  const queryNgrams = generateNgrams(parsed.searchTokens, 3);
  const scores = new Map<number, number>();

  for (const ng of queryNgrams) {
    const matchingRecords = index.ngramIndex.get(ng);
    if (!matchingRecords) continue;

    const ngramLength = ng.split(" ").length;
    const weight = NGRAM_WEIGHTS[ngramLength] ?? 1;

    for (const recordIdx of matchingRecords) {
      if (!candidates.has(recordIdx)) continue;
      scores.set(recordIdx, (scores.get(recordIdx) ?? 0) + weight);
    }
  }

  const results: MatchResult[] = [...scores.entries()]
    .map(([idx, score]) => ({ record: index.records[idx], score }))
    .sort((a, b) => b.score - a.score);

  if (results.length === 0) return [];

  // Return results within 50% of the top score, capped at 5
  const topScore = results[0].score;
  const threshold = topScore * 0.5;

  return results.filter((r) => r.score >= threshold).slice(0, 5);
}
