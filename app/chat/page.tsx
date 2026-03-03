"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/lib/types";
import { MAX_MESSAGE_LENGTH } from "@/lib/sanitize";

const SUGGESTIONS = [
  "What jobs are available in San Bernardino?",
  "Tell me about the Assistant Sheriff in San Diego County",
  "What is the salary for the District Attorney?",
  "Probation Officer qualifications in Ventura",
];

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(ts);
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastUserMsgRef = useRef<string>("");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submitQuery = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      setError(null);
      lastUserMsgRef.current = trimmed;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      const assistantMsgId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setIsStreaming(true);

      try {
        abortRef.current = new AbortController();
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ history: messages, userMessage: trimmed }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          let errMsg = "Something went wrong. Please try again.";
          if (res.status === 429) {
            const retryAfter = res.headers.get("Retry-After");
            errMsg = `Too many requests. Please wait ${retryAfter ?? "a few"} seconds.`;
          } else {
            try {
              const errBody = await res.json();
              if (errBody.error) errMsg = errBody.error;
            } catch {
              // use default error
            }
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: errMsg } : m
            )
          );
          setError(errMsg);
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + chunk, timestamp: Date.now() }
                : m
            )
          );
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: "Sorry, something went wrong. Please try again.",
                }
              : m
          )
        );
        setError("Connection error.");
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming]
  );

  function handleRetry() {
    if (lastUserMsgRef.current) {
      // Remove the last failed assistant message
      setMessages((prev) => prev.slice(0, -1));
      setError(null);
      submitQuery(lastUserMsgRef.current);
    }
  }

  const charsLeft = MAX_MESSAGE_LENGTH - input.length;
  const showCounter = input.length > MAX_MESSAGE_LENGTH - 100;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 shrink-0">
        <h1 className="text-xl font-semibold text-gray-900">
          HR Job Assistant
        </h1>
        <p className="text-sm text-gray-500">
          Ask about government job positions and salaries
        </p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <div className="text-4xl mb-4">&#128188;</div>
              <h2 className="text-lg font-medium text-gray-700 mb-2">
                How can I help you today?
              </h2>
              <p className="text-sm text-gray-500 mb-6 max-w-md">
                I can help you find information about job positions, salaries,
                qualifications, and duties across different jurisdictions.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => submitQuery(suggestion)}
                    disabled={isStreaming}
                    className="px-4 py-2 text-sm bg-white border border-gray-200 rounded-full hover:bg-gray-100 hover:border-gray-300 transition-colors text-gray-700 shadow-sm disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message list */
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={msg.role === "user" ? "max-w-[75%]" : "max-w-[85%]"}>
                  <div
                    className={`rounded-2xl px-5 py-3 shadow-sm ${
                      msg.role === "user"
                        ? "bg-blue-500 text-white"
                        : msg.content === "" && isStreaming
                          ? "bg-white border border-gray-200"
                          : error &&
                              msg === messages[messages.length - 1] &&
                              msg.role === "assistant"
                            ? "bg-red-50 border border-red-200 text-red-700"
                            : "bg-white border border-gray-200 text-gray-900"
                    }`}
                  >
                    {msg.role === "assistant" &&
                    msg.content === "" &&
                    isStreaming ? (
                      <div className="flex items-center gap-1 py-1 px-1">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </div>
                    ) : msg.role === "assistant" ? (
                      <div className="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                  {msg.timestamp && msg.content !== "" && (
                    <p
                      className={`text-xs text-gray-400 mt-1 ${msg.role === "user" ? "text-right" : "text-left"}`}
                    >
                      {formatTime(msg.timestamp)}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Error retry */}
          {error && !isStreaming && (
            <div className="flex justify-start">
              <button
                onClick={handleRetry}
                className="text-sm text-red-600 hover:text-red-800 underline"
              >
                Retry last message
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white px-6 py-4 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2 items-center">
            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitQuery(input);
                  }
                }}
                placeholder="Ask about a job position..."
                maxLength={MAX_MESSAGE_LENGTH}
                className={`w-full border border-gray-300 rounded-xl px-4 py-2.5 leading-6 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 ${showCounter ? "pr-12" : ""}`}
                disabled={isStreaming}
              />
              {showCounter && (
                <span
                  className={`absolute bottom-2 right-3 text-xs ${charsLeft < 20 ? "text-red-500" : "text-gray-400"}`}
                >
                  {charsLeft}
                </span>
              )}
            </div>
            <button
              onClick={() => submitQuery(input)}
              disabled={isStreaming || !input.trim()}
              className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:hover:bg-blue-500 text-white px-5 py-2.5 leading-6 rounded-xl font-medium transition-colors shrink-0"
            >
              {isStreaming ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
