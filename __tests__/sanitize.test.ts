import { describe, it, expect } from "vitest";
import {
  sanitizeMessage,
  sanitizeHistory,
  MAX_MESSAGE_LENGTH,
  MAX_HISTORY_LENGTH,
} from "@/lib/sanitize";

describe("sanitizeMessage", () => {
  it("passes a valid string through", () => {
    const result = sanitizeMessage("What jobs are in San Bernardino?");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("What jobs are in San Bernardino?");
  });

  it("trims whitespace", () => {
    const result = sanitizeMessage("  hello  ");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("hello");
  });

  it("rejects non-string input", () => {
    expect(sanitizeMessage(123).valid).toBe(false);
    expect(sanitizeMessage(null).valid).toBe(false);
    expect(sanitizeMessage(undefined).valid).toBe(false);
    expect(sanitizeMessage({}).valid).toBe(false);
  });

  it("rejects empty string", () => {
    const result = sanitizeMessage("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("enter a message");
  });

  it("rejects whitespace-only string", () => {
    const result = sanitizeMessage("   ");
    expect(result.valid).toBe(false);
  });

  it("rejects over-length string", () => {
    const long = "a".repeat(MAX_MESSAGE_LENGTH + 1);
    const result = sanitizeMessage(long);
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`${MAX_MESSAGE_LENGTH} characters`);
  });

  it("accepts string at exactly max length", () => {
    const exact = "a".repeat(MAX_MESSAGE_LENGTH);
    const result = sanitizeMessage(exact);
    expect(result.valid).toBe(true);
  });

  it("strips HTML tags", () => {
    const result = sanitizeMessage("<script>alert('xss')</script>hello");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("alert('xss')hello");
    expect(result.sanitized).not.toContain("<script>");
  });

  it("strips nested HTML tags", () => {
    const result = sanitizeMessage("<div><b>bold</b> text</div>");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("bold text");
  });
});

describe("sanitizeHistory", () => {
  it("passes valid history through", () => {
    const history = [
      { id: "1", role: "user" as const, content: "hello" },
      { id: "2", role: "assistant" as const, content: "hi" },
    ];
    const result = sanitizeHistory(history);
    expect(result.length).toBe(2);
    expect(result[0].content).toBe("hello");
  });

  it("returns empty array for non-array input", () => {
    expect(sanitizeHistory(null)).toEqual([]);
    expect(sanitizeHistory("string")).toEqual([]);
    expect(sanitizeHistory(123)).toEqual([]);
  });

  it("filters out malformed entries", () => {
    const history = [
      { id: "1", role: "user", content: "valid" },
      { id: "2", role: "invalid_role", content: "bad role" },
      { role: "user", content: "missing id" },
      { id: "3", role: "user" }, // missing content
      null,
      42,
    ];
    const result = sanitizeHistory(history);
    expect(result.length).toBe(1);
    expect(result[0].content).toBe("valid");
  });

  it("caps history at MAX_HISTORY_LENGTH", () => {
    const history = Array.from({ length: MAX_HISTORY_LENGTH + 10 }, (_, i) => ({
      id: String(i),
      role: "user" as const,
      content: `message ${i}`,
    }));
    const result = sanitizeHistory(history);
    expect(result.length).toBe(MAX_HISTORY_LENGTH);
  });

  it("strips HTML from history content", () => {
    const history = [
      { id: "1", role: "user" as const, content: "<b>bold</b> text" },
    ];
    const result = sanitizeHistory(history);
    expect(result[0].content).toBe("bold text");
  });
});
