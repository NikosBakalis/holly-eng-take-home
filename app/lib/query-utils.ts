import type { ChatMessage } from "@/lib/types";

/**
 * Builds a contextual query by combining the current message with
 * the most recent prior user message from conversation history.
 * Handles follow-ups like "What about the salary?" after asking about a specific job.
 */
export function buildContextualQuery(
  currentMessage: string,
  history: ChatMessage[]
): string {
  const recentUserMessages = history
    .filter((msg) => msg.role === "user")
    .slice(-3);

  if (recentUserMessages.length > 0) {
    const lastUserMsg = recentUserMessages[recentUserMessages.length - 1];
    return `${lastUserMsg.content} ${currentMessage}`;
  }

  return currentMessage;
}
