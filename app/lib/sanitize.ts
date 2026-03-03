import type { ChatMessage } from "@/lib/types";

export const MAX_MESSAGE_LENGTH = 500;
export const MAX_HISTORY_LENGTH = 50;

export interface SanitizeResult {
  valid: boolean;
  error?: string;
  sanitized: string;
}

/**
 * Strip HTML tags from a string.
 * Defense-in-depth: React already escapes JSX content,
 * but the LLM might echo user input, so we strip at the server boundary.
 */
function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

/**
 * Validates and sanitizes a user message at the server boundary.
 */
export function sanitizeMessage(input: unknown): SanitizeResult {
  if (typeof input !== "string") {
    return { valid: false, error: "Message must be a string.", sanitized: "" };
  }

  let sanitized = input.trim();

  if (sanitized.length === 0) {
    return { valid: false, error: "Please enter a message.", sanitized: "" };
  }

  if (sanitized.length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      error: `Message must be ${MAX_MESSAGE_LENGTH} characters or less.`,
      sanitized: "",
    };
  }

  sanitized = stripHtml(sanitized);

  return { valid: true, sanitized };
}

/**
 * Validates and sanitizes conversation history.
 * Filters out malformed entries and caps length.
 */
export function sanitizeHistory(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (msg): msg is ChatMessage =>
        typeof msg === "object" &&
        msg !== null &&
        typeof msg.id === "string" &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string"
    )
    .slice(-MAX_HISTORY_LENGTH)
    .map((msg) => ({
      ...msg,
      content: stripHtml(msg.content).slice(0, MAX_MESSAGE_LENGTH * 2),
    }));
}
