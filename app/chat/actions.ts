"use server";

import type { ChatMessage } from "@/lib/types";
import { searchRecords } from "@/lib/index";
import { generateResponse } from "@/lib/llm";
import { sanitizeMessage, sanitizeHistory } from "@/lib/sanitize";
import { buildContextualQuery } from "@/lib/query-utils";

export async function sendMessage(
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const msgResult = sanitizeMessage(userMessage);
  if (!msgResult.valid) return msgResult.error!;

  const cleanHistory = sanitizeHistory(history);

  // First, try matching on the current message alone
  let matchedRecords = await searchRecords(msgResult.sanitized);

  // If no matches found and there's conversation history,
  // retry with context from previous messages
  if (matchedRecords.length === 0 && cleanHistory.length > 0) {
    const contextualQuery = buildContextualQuery(
      msgResult.sanitized,
      cleanHistory
    );
    matchedRecords = await searchRecords(contextualQuery);
  }

  const fullHistory: ChatMessage[] = [
    ...cleanHistory,
    { id: crypto.randomUUID(), role: "user", content: msgResult.sanitized },
  ];

  const response = await generateResponse(fullHistory, matchedRecords);
  return response;
}
