import OpenAI from "openai";
import type { ChatMessage, JobRecord, MatchResult } from "@/lib/types";

function getClient(): OpenAI {
  const globalRef = globalThis as unknown as { __openai?: OpenAI };
  if (!globalRef.__openai) {
    globalRef.__openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return globalRef.__openai;
}

const SYSTEM_PROMPT = `You are an HR assistant that helps users find information about government job positions and salaries across different jurisdictions.

You will be provided with matched job records from a database based on the user's query. Use ONLY the provided records to answer questions. Do not make up information.

Guidelines:
- If multiple matching records are provided, help the user identify which one they're asking about. If the records are from different jurisdictions, mention the jurisdiction to disambiguate.
- When discussing salaries, present the salary grade information clearly. Present the numbers as given in the data.
- When the user asks about job requirements, duties, qualifications, or other details, reference the job description directly.
- If no matching records are provided (empty context), politely tell the user you couldn't find a matching position and suggest they try rephrasing with more detail (e.g., mentioning the jurisdiction or full job title).
- Keep responses concise but thorough.
- Always mention which jurisdiction a position belongs to for clarity.`;

function formatRecordForContext(record: JobRecord): string {
  const salaryInfo =
    record.salaryGrades.length > 0
      ? record.salaryGrades
          .map((sg) => `  Grade ${sg.grade}: ${sg.value}`)
          .join("\n")
      : "  No salary data available";

  const parts = [
    `--- Job Record ---`,
    `Title: ${record.title}`,
    `Jurisdiction: ${record.jurisdiction}`,
    `Job Code: ${record.code}`,
    `Salary Grades:\n${salaryInfo}`,
    record.approvalDate ? `Approval Date: ${record.approvalDate}` : null,
    `Description:\n${record.description}`,
    `--- End Record ---`,
  ];

  return parts.filter(Boolean).join("\n");
}

/**
 * Builds the OpenAI message array from conversation history and matched records.
 * Shared between streaming and non-streaming paths.
 */
export function buildMessages(
  conversationHistory: ChatMessage[],
  matchedRecords: MatchResult[]
): OpenAI.ChatCompletionMessageParam[] {
  let context: string;
  if (matchedRecords.length === 0) {
    context =
      "NO MATCHING RECORDS FOUND. Inform the user that no matching job positions were found for their query and suggest they try rephrasing with more detail.";
  } else {
    context = matchedRecords
      .map((mr) => formatRecordForContext(mr.record))
      .join("\n\n");
  }

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    // Include prior conversation for multi-turn context (last 10 messages)
    ...conversationHistory.slice(-10).map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    })),
  ];

  // Inject matched records as context right before the last user message
  const lastUserMsgIndex = messages.length - 1;
  messages.splice(lastUserMsgIndex, 0, {
    role: "system",
    content: `Relevant job records matching the user's current query:\n\n${context}`,
  });

  return messages;
}

export async function generateResponse(
  conversationHistory: ChatMessage[],
  matchedRecords: MatchResult[]
): Promise<string> {
  const messages = buildMessages(conversationHistory, matchedRecords);

  const response = await getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.3,
    max_tokens: 1024,
  });

  return (
    response.choices[0]?.message?.content ??
    "I'm sorry, I wasn't able to generate a response. Please try again."
  );
}

export async function generateStreamingResponse(
  conversationHistory: ChatMessage[],
  matchedRecords: MatchResult[]
) {
  const messages = buildMessages(conversationHistory, matchedRecords);

  return getClient().chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.3,
    max_tokens: 1024,
    stream: true,
  });
}
