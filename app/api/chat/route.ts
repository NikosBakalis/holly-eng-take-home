import { searchRecords } from "@/lib/index";
import { generateStreamingResponse } from "@/lib/llm";
import { sanitizeMessage, sanitizeHistory } from "@/lib/sanitize";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildContextualQuery } from "@/lib/query-utils";
import type { ChatMessage } from "@/lib/types";

export async function POST(request: Request): Promise<Response> {
  // Rate limit by IP
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again later." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(
            Math.ceil((rateCheck.retryAfterMs ?? 60000) / 1000)
          ),
        },
      }
    );
  }

  let body: { history?: unknown; userMessage?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate message
  const msgResult = sanitizeMessage(body.userMessage);
  if (!msgResult.valid) {
    return new Response(JSON.stringify({ error: msgResult.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate history
  const history: ChatMessage[] = sanitizeHistory(body.history);

  // Search for matching records
  let matchedRecords = await searchRecords(msgResult.sanitized);

  // Contextual retry with history if no matches
  if (matchedRecords.length === 0 && history.length > 0) {
    const contextualQuery = buildContextualQuery(
      msgResult.sanitized,
      history
    );
    matchedRecords = await searchRecords(contextualQuery);
  }

  const fullHistory: ChatMessage[] = [
    ...history,
    { id: crypto.randomUUID(), role: "user", content: msgResult.sanitized },
  ];

  // Stream the response
  const stream = await generateStreamingResponse(fullHistory, matchedRecords);

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) {
            controller.enqueue(encoder.encode(text));
          }
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            "I'm sorry, something went wrong generating a response."
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
