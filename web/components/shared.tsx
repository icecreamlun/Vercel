import {
  Check,
  X,
  ChevronDown,
  Circle,
  Loader2,
  FlaskConical,
  AlertTriangle,
} from "lucide-react";
import type { Result } from "./types";
export function Status({ value }: { value: string }) {
  const pending = ["queued", "running", "pending"].includes(value);
  const good = ["passed", "pass", "promoted", "completed", "eligible"].includes(
    value,
  );
  const bad = ["blocked", "fail"].includes(value);
  return (
    <span
      className={`status ${good ? "good" : bad ? "bad" : value === "error" ? "error" : pending ? "pending" : "neutral"}`}
    >
      {pending ? (
        <Loader2 size={12} className={value === "queued" ? "" : "spin"} />
      ) : good ? (
        <Check size={12} />
      ) : bad ? (
        <X size={12} />
      ) : value === "error" ? (
        <AlertTriangle size={12} />
      ) : (
        <Circle size={10} />
      )}
      <span>
        {value === "pass"
          ? "Passed"
          : value === "fail"
            ? "Failed"
            : value.charAt(0).toUpperCase() + value.slice(1)}
      </span>
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FlaskConical size={24} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function CaseStatus({ result }: { result?: Result }) {
  return result ? (
    <Status value={result.status} />
  ) : (
    <span className="case-pending">
      <Circle size={11} />
      Pending
    </span>
  );
}
export function Trace({ result }: { result: Result }) {
  return (
    <div className="trace">
      {result.trace.length === 0 ? (
        <div className="no-tools">No tools called.</div>
      ) : (
        result.trace.map((t, i) => (
          <details key={i} open={t.name === "request_refund"}>
            <summary>
              <span className="trace-number">{i + 1}</span>
              <code>{t.name}</code>
              <ChevronDown size={12} />
            </summary>
            <div className="trace-body">
              <span>INPUT</span>
              <pre>{JSON.stringify(t.input, null, 2)}</pre>
              <span>RESULT</span>
              <pre>{JSON.stringify(t.output, null, 2)}</pre>
              {t.error && <span className="red-text">{t.error}</span>}
            </div>
          </details>
        ))
      )}
    </div>
  );
}
export function PromptDiff({
  baseline,
  candidate,
}: {
  baseline: string;
  candidate: string;
}) {
  const old = baseline.split("\n");
  const next = candidate.split("\n");
  return (
    <div className="prompt-diff">
      {old
        .filter((l) => l && !next.includes(l))
        .map((l, i) => (
          <div className="removed" key={`old${i}`}>
            <span>−</span>
            {l}
          </div>
        ))}
      {next
        .filter((l) => l && !old.includes(l))
        .map((l, i) => (
          <div className="added" key={`new${i}`}>
            <span>+</span>
            {l}
          </div>
        ))}
    </div>
  );
}
