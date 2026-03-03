import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage, MatchResult, JobRecord } from "@/lib/types";

// Mock OpenAI at module level before any imports that use it
const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
  },
}));

import { generateResponse } from "@/lib/llm";

function mockRecord(overrides?: Partial<JobRecord>): MatchResult {
  return {
    score: 10,
    record: {
      jurisdiction: "sdcounty",
      code: "03697",
      title: "Assistant Sheriff",
      description: "Under general direction, assists the Sheriff...",
      salaryGrades: [{ grade: 1, value: "$43.38" }],
      ...overrides,
    },
  };
}

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: "Mocked LLM response" } }],
  });
});

describe("generateResponse", () => {
  it("includes system prompt as the first message", async () => {
    const history: ChatMessage[] = [
      { id: "1", role: "user", content: "Tell me about the sheriff" },
    ];
    await generateResponse(history, [mockRecord()]);

    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("HR assistant");
  });

  it("injects matched records context before last user message", async () => {
    const history: ChatMessage[] = [
      { id: "1", role: "user", content: "What about the salary?" },
    ];
    await generateResponse(history, [mockRecord()]);

    const messages = mockCreate.mock.calls[0][0].messages;
    const contextMsg = messages.find(
      (m: { role: string; content: string }) =>
        m.role === "system" && m.content.includes("Relevant job records")
    );
    expect(contextMsg).toBeDefined();
    expect(contextMsg.content).toContain("Assistant Sheriff");
    expect(contextMsg.content).toContain("$43.38");

    // User message should be last
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toBe("What about the salary?");
  });

  it("sends NO MATCHING RECORDS context when records are empty", async () => {
    await generateResponse(
      [{ id: "1", role: "user", content: "Tell me about CEO" }],
      []
    );
    const messages = mockCreate.mock.calls[0][0].messages;
    const contextMsg = messages.find(
      (m: { role: string; content: string }) =>
        m.content?.includes("NO MATCHING RECORDS")
    );
    expect(contextMsg).toBeDefined();
  });

  it("limits conversation history to 10 messages", async () => {
    const history: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Message ${i}`,
    }));
    await generateResponse(history, []);

    const messages = mockCreate.mock.calls[0][0].messages;
    // Filter non-system messages (system prompt + context are system role)
    const nonSystemMessages = messages.filter(
      (m: { role: string }) => m.role !== "system"
    );
    expect(nonSystemMessages.length).toBeLessThanOrEqual(10);
  });

  it("calls OpenAI with correct model parameters", async () => {
    await generateResponse(
      [{ id: "1", role: "user", content: "test" }],
      []
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 1024,
      })
    );
  });

  it("returns fallback message when LLM response is null", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });
    const result = await generateResponse(
      [{ id: "1", role: "user", content: "test" }],
      []
    );
    expect(result).toContain("wasn't able to generate");
  });

  it("includes all matched records in context", async () => {
    const records = [
      mockRecord({ title: "Job A", jurisdiction: "ventura" }),
      mockRecord({ title: "Job B", jurisdiction: "sdcounty" }),
    ];
    await generateResponse(
      [{ id: "1", role: "user", content: "test" }],
      records
    );
    const messages = mockCreate.mock.calls[0][0].messages;
    const contextMsg = messages.find(
      (m: { role: string; content: string }) =>
        m.content?.includes("Relevant job records")
    );
    expect(contextMsg.content).toContain("Job A");
    expect(contextMsg.content).toContain("Job B");
  });

  it("returns the LLM response content", async () => {
    const result = await generateResponse(
      [{ id: "1", role: "user", content: "test" }],
      []
    );
    expect(result).toBe("Mocked LLM response");
  });
});
