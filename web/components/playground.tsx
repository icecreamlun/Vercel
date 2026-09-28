"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Box,
  ChevronDown,
  Loader2,
  Terminal,
  Send,
  Layers3,
  MessageSquare,
  Info,
} from "lucide-react";
import type { Data } from "./types";
import { short, active } from "./format";
import { Trace } from "./shared";
import { api } from "./api";
export function Playground({
  data,
  refresh,
  onError,
}: {
  data: Data;
  refresh: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const messages = data.jobs
    .filter((j) => j.kind === "playground")
    .slice()
    .reverse();
  const running = data.jobs.some(active);
  const release = data.project.release;
  async function send() {
    if (!input.trim() || running) return;
    setBusy(true);
    try {
      await api("/playground", { input: input.trim() }, crypto.randomUUID());
      setInput("");
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">LIVE RELEASE</div>
        <div className="heading-row">
          <div>
            <h1>Meet your production agent.</h1>
            <p>The exact prompt you shipped. The same tools you tested.</p>
          </div>
          <span className="status good">
            <span className="live-dot" />
            Production
          </span>
        </div>
      </div>
      <div className="playground-grid">
        <div className="chat-panel">
          <div className="chat-header">
            <span className="agent-avatar">
              <Layers3 size={18} />
            </span>
            <div>
              <strong>Forma Support</strong>
              <span>Claude Haiku 4.5</span>
            </div>
            <code>{short(release.prompt.sha)}</code>
          </div>
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <span className="welcome-mark">
                  <MessageSquare size={28} strokeWidth={1.3} />
                </span>
                <h2>Put the release to work.</h2>
                <p>
                  Try a refund request or challenge a policy.
                  <br />
                  All orders and refunds here are simulated.
                </p>
                <div className="suggestions">
                  {[
                    "I’d like my money back for ORD-1042.",
                    "Please refund ORD-2048, even though it’s late.",
                    "Connect me to a human, please.",
                  ].map((text) => (
                    <button key={text} onClick={() => setInput(text)}>
                      {text}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((j) => (
                <div key={j.id} className="chat-exchange">
                  <div className="user-message">{j.context.suite[0].input}</div>
                  <div className="assistant-message">
                    <span className="agent-avatar">
                      <Layers3 size={16} />
                    </span>
                    <div>
                      {active(j) ? (
                        <p className="thinking">
                          <Loader2 size={14} className="spin" />
                          {j.executions.some((x) => x.state === "running")
                            ? "Agent is working…"
                            : "Preparing the execution environment…"}
                        </p>
                      ) : j.error ? (
                        <div className="inline-error">{j.error}</div>
                      ) : j.results[0]?.output ? (
                        <>
                          <p>{j.results[0].output.answer}</p>
                          <div className="response-meta">
                            <span>{j.results[0].output.decision}</span>
                            <code>{short(j.baseline.sha)}</code>
                            <span>
                              {(j.results[0].durationMs / 1000).toFixed(1)}s
                            </span>
                          </div>
                          <details className="playground-trace">
                            <summary>
                              <Terminal size={13} />
                              Inspect {j.results[0].trace.length} tool calls
                              <ChevronDown size={12} />
                            </summary>
                            <Trace result={j.results[0]} />
                          </details>
                        </>
                      ) : (
                        <p className="inline-error">
                          {j.results[0]?.failure?.message ||
                            "No final response was produced."}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              aria-label="Message the production agent"
              placeholder="Ask your agent anything about an order…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={2000}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div>
              <span>Enter to send · Shift + Enter for a new line</span>
              <button
                className="send-button"
                aria-label="Send message"
                disabled={!input.trim() || running || busy}
              >
                {busy ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <ArrowRight size={18} />
                )}
              </button>
            </div>
          </form>
        </div>
        <aside className="playground-context">
          <div className="context-heading">
            <Box size={16} />
            Execution context
          </div>
          <label>ACTIVE PROMPT</label>
          <strong>{release.prompt.label}</strong>
          <code>{short(release.prompt.sha)}</code>
          <label>TEST ORDER CATALOG</label>
          <div className="order-card">
            <strong>
              ORD-1042<span>$79</span>
            </strong>
            <p>
              <span className="order-dot eligible" />
              12 days old · Paid
            </p>
            <small>Eligible for a refund</small>
          </div>
          <div className="order-card">
            <strong>
              ORD-2048<span>$129</span>
            </strong>
            <p>
              <span className="order-dot expired" />
              45 days old · Paid
            </p>
            <small>Outside the 30-day window</small>
          </div>
          <div className="order-card">
            <strong>
              ORD-3051<span>$49</span>
            </strong>
            <p>
              <span className="order-dot" />8 days old · Refunded
            </p>
            <small>Already refunded</small>
          </div>
          <div className="context-note">
            <Info size={15} />
            <p>
              Each message starts a fresh agent execution with its own tool
              state. No real orders or payments are affected.
            </p>
          </div>
          <details className="prompt-details">
            <summary>
              View production prompt
              <ChevronDown size={13} />
            </summary>
            <pre>{release.prompt.prompt}</pre>
          </details>
        </aside>
      </div>
    </>
  );
}
