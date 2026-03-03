import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock OpenAI at module level
const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

import { sendMessage } from "../app/chat/actions";

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: "The Assistant Sheriff salary is..." } }],
  });
});

describe("sendMessage (full pipeline)", () => {
  it("searches and passes matched records to LLM", async () => {
    const result = await sendMessage([], "Assistant Sheriff San Diego");
    expect(result).toBe("The Assistant Sheriff salary is...");

    const messages = mockCreate.mock.calls[0][0].messages;
    const contextMsg = messages.find(
      (m: { role: string; content: string }) =>
        m.content?.includes("Assistant Sheriff")
    );
    expect(contextMsg).toBeDefined();
  });

  it("returns prompt for empty input", async () => {
    const result = await sendMessage([], "   ");
    expect(result).toContain("enter a message");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("passes no-records context for unmatched queries", async () => {
    await sendMessage([], "CEO position in Mars");
    const messages = mockCreate.mock.calls[0][0].messages;
    const contextMsg = messages.find(
      (m: { role: string; content: string }) =>
        m.content?.includes("NO MATCHING RECORDS")
    );
    expect(contextMsg).toBeDefined();
  });

  it("uses conversation history for contextual follow-up queries", async () => {
    const history = [
      {
        id: "1",
        role: "user" as const,
        content: "Tell me about Assistant Sheriff San Diego",
      },
      {
        id: "2",
        role: "assistant" as const,
        content: "The Assistant Sheriff...",
      },
    ];
    await sendMessage(history, "What about the salary?");

    // Should find Assistant Sheriff via contextual query fallback
    const messages = mockCreate.mock.calls[0][0].messages;
    const contextMsg = messages.find(
      (m: { role: string; content: string }) =>
        m.content?.includes("Relevant job records") &&
        m.content?.includes("Assistant Sheriff")
    );
    expect(contextMsg).toBeDefined();
  });

  it("rejects non-string input", async () => {
    // @ts-expect-error testing runtime validation
    const result = await sendMessage([], 123);
    expect(result).toContain("must be a string");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects over-length input", async () => {
    const result = await sendMessage([], "a".repeat(501));
    expect(result).toContain("500 characters");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
