"use client";
import { Dialog } from "./dialog";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCheck,
  X,
  ShieldCheck,
  ShieldAlert,
  Box,
  Info,
  Braces,
  ChevronRight,
  ChevronDown,
  Loader2,
  Rocket,
  AlertTriangle,
} from "lucide-react";
import type { Job, Result } from "./types";
import { short, active, date, time } from "./format";
import { Status, PromptDiff, CaseStatus, Trace } from "./shared";
export function RunDetail({
  job,
  busy,
  onBack,
  onPromote,
  onPlayground,
  onEvaluate,
}: {
  job: Job;
  busy: boolean;
  onBack: () => void;
  onPromote: () => void;
  onPlayground: () => void;
  onEvaluate: () => void;
}) {
  const [selectedCase, setSelectedCase] = useState<string>();
  const [promptOpen, setPromptOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const report = job.report;
  const isActive = active(job);
  const total = job.context.suite.length * 2;
  const failed = job.gateStatus === "blocked";
  const good = job.gateStatus === "passed";
  const rows = job.context.suite.map((c) => ({
    test: c,
    b: job.results.find((r) => r.caseId === c.id && r.side === "baseline"),
    n: job.results.find((r) => r.caseId === c.id && r.side === "candidate"),
  }));
  const evidence = rows.find((r) => r.test.id === selectedCase);
  const shown = rows.filter(
    (r) =>
      filter === "all" ||
      (filter === "regressions" &&
        r.b?.status === "pass" &&
        r.n?.status === "fail") ||
      (filter === "critical" && r.test.critical),
  );
  const completed = job.executionStatus === "completed";
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={14} />
        All evaluations
      </button>
      {job.example && (
        <div className="example-notice">
          <Info size={16} />
          <span>
            Recorded example · {date(job.createdAt)} at {time(job.createdAt)}.
            Read-only evidence from a real evaluation.
          </span>
          <button onClick={onEvaluate}>
            Run your own
            <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      <div className="detail-heading">
        <div>
          <div className="eyebrow">EVALUATION / {short(job.id)}</div>
          <h1>{job.candidate.label}</h1>
          <div className="detail-meta">
            <code>{short(job.baseline.sha)}</code>
            <ArrowRight size={14} />
            <code>{short(job.candidate.sha)}</code>
            <span>·</span>
            <span>
              {date(job.createdAt)} at {time(job.createdAt)}
            </span>
            <button
              className="text-button"
              onClick={() => setPromptOpen(!promptOpen)}
            >
              <Braces size={13} />
              Prompt diff
            </button>
          </div>
        </div>
        <Status value={isActive ? job.executionStatus : job.gateStatus} />
      </div>
      {promptOpen && (
        <PromptDiff
          baseline={job.baseline.prompt}
          candidate={job.candidate.prompt}
        />
      )}
      <div className="pipeline">
        {[
          { label: "Inputs frozen", done: true },
          {
            label: "Sandbox execution",
            done: completed || job.results.length === total,
            running: isActive,
          },
          {
            label: "Evaluate behavior",
            done: completed,
            running: isActive && job.results.length > 0,
          },
          {
            label: "Release gate",
            done: good,
            error: failed,
            unavailable: job.executionStatus === "error",
          },
        ].map((s, i) => (
          <div
            className={`pipeline-step ${s.done ? "done" : ""} ${s.error ? "failed" : ""}`}
            key={s.label}
          >
            <span className="step-symbol">
              {s.done ? (
                <Check size={13} />
              ) : s.error ? (
                <X size={13} />
              ) : s.unavailable ? (
                <AlertTriangle size={13} />
              ) : s.running ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <span>{i + 1}</span>
              )}
            </span>
            {s.label}
            {i < 3 && <div className="pipeline-line" />}
          </div>
        ))}
      </div>
      <div
        className={`gate-banner ${failed ? "blocked" : good ? "passed" : job.executionStatus === "error" ? "errored" : "running"}`}
      >
        <span className="gate-symbol">
          {failed ? (
            <ShieldAlert size={26} />
          ) : good ? (
            <ShieldCheck size={26} />
          ) : job.executionStatus === "error" ? (
            <AlertTriangle size={24} />
          ) : (
            <Loader2 className="spin" size={24} />
          )}
        </span>
        <div>
          <h2>
            {failed
              ? report && report.candidatePassed > report.baselinePassed
                ? "A better score isn’t always a safer release."
                : "This candidate does not meet the release policy."
              : good
                ? "The evidence supports this release."
                : job.executionStatus === "error"
                  ? "This run could not be evaluated."
                  : "Collecting evidence, one case at a time."}
          </h2>
          <p>
            {failed
              ? report?.reasons.join(" ")
              : good
                ? "All critical checks passed and the overall pass rate did not decrease."
                : job.error ||
                  "The same agent is running both prompt versions in Vercel Sandbox."}
          </p>
          {failed &&
            report?.criticalFailures.map((id) => (
              <button
                key={id}
                className="critical-link"
                onClick={() => setSelectedCase(id)}
              >
                {id}
                <ArrowUpRight size={13} />
              </button>
            ))}
        </div>
      </div>
      <div className="metrics-grid">
        <div>
          <span className="small-label">PASS RATE</span>
          <div className="metric-value">
            {report ? (
              <>
                <span className="old-metric">
                  {Math.round((report.baselinePassed / report.total) * 100)}
                  <small>%</small>
                </span>
                <ArrowRight size={22} />
                <span>
                  {Math.round((report.candidatePassed / report.total) * 100)}
                  <small>%</small>
                </span>
              </>
            ) : (
              <span className="waiting-value">Awaiting results</span>
            )}
          </div>
          <p>
            {report
              ? `${report.baselinePassed} → ${report.candidatePassed} of ${report.total} cases passed`
              : "Incomplete runs are not compared."}
          </p>
        </div>
        <div>
          <span className="small-label">CRITICAL FAILURES</span>
          <div
            className={`metric-value ${report?.criticalFailures.length ? "red-text" : ""}`}
          >
            {report ? (
              report.criticalFailures.length
            ) : (
              <span className="waiting-value">—</span>
            )}
            <small className="metric-unit">/ 3 checks</small>
          </div>
          <p>
            {report?.criticalFailures.length
              ? "Must be fixed before promotion."
              : "Policy checks are release requirements."}
          </p>
        </div>
        <div>
          <span className="small-label">EVALUATION PROGRESS</span>
          <div className="metric-value">
            {job.results.length}
            <small className="metric-unit">/ {total} cases</small>
            {isActive && <Loader2 size={17} className="spin" />}
          </div>
          <div className="progress-track">
            <div style={{ width: `${(job.results.length / total) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="section-heading">
        <div className="case-tabs">
          {[
            ["all", "All cases"],
            ["regressions", "Regressions"],
            ["critical", "Critical"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={filter === id ? "active" : ""}
            >
              {label}
              {id === "regressions" && report && (
                <span>{report.regressions.length}</span>
              )}
            </button>
          ))}
        </div>
        <span className="section-meta">Click a case to inspect evidence</span>
      </div>
      <div className="cases-table">
        <div className="case-head">
          <span>TEST CASE</span>
          <span>BASELINE</span>
          <span>CANDIDATE</span>
          <span>CHANGE</span>
          <span />
        </div>
        {shown.length === 0 ? (
          <div className="no-rows">No cases in this view.</div>
        ) : (
          shown.map(({ test, b, n }) => (
            <button
              key={test.id}
              className={`case-row ${n?.status === "fail" ? "has-failure" : ""}`}
              onClick={() => setSelectedCase(test.id)}
            >
              <div>
                <strong>{test.name}</strong>
                <span>
                  <code>{test.id}</code>
                  {test.critical && (
                    <span className="critical-tag">CRITICAL</span>
                  )}
                </span>
              </div>
              <CaseStatus result={b} />
              <CaseStatus result={n} />
              <span>
                {b && n ? (
                  b.status === "pass" && n.status === "fail" ? (
                    <span className="change regressed">Regression</span>
                  ) : b.status === "fail" && n.status === "pass" ? (
                    <span className="change improved">Improved</span>
                  ) : (
                    <span className="muted">—</span>
                  )
                ) : (
                  <span className="muted">—</span>
                )}
              </span>
              <ChevronRight size={15} />
            </button>
          ))
        )}
      </div>
      {!job.example && (
        <div className="release-bar">
          <div>
            <div>
              {job.promotionStatus === "promoted" ? (
                <CheckCheck size={18} />
              ) : (
                <ShieldCheck size={18} />
              )}
              <strong>
                {job.promotionStatus === "promoted"
                  ? "This prompt was promoted."
                  : job.promotionStatus === "stale"
                    ? "Production changed after this evaluation."
                    : good
                      ? "Ready when you are."
                      : "This evaluation cannot be promoted."}
              </strong>
            </div>
            <p>
              {job.promotionStatus === "stale"
                ? "Run a new comparison against the current release."
                : job.promotionStatus === "promoted"
                  ? "The release uses the exact evaluated prompt artifact."
                  : good
                    ? "Promote this exact prompt to your workspace’s Production."
                    : "Only a complete, passing evaluation can be promoted."}
            </p>
          </div>
          {job.promotionStatus === "promoted" ? (
            <button className="button secondary" onClick={onPlayground}>
              Open Playground
              <ArrowUpRight size={15} />
            </button>
          ) : (
            <button
              className="button primary"
              disabled={busy || job.promotionStatus !== "eligible"}
              onClick={onPromote}
            >
              {busy ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Rocket size={15} />
              )}
              Promote to Production
            </button>
          )}
        </div>
      )}
      <details className="provenance">
        <summary>
          <Box size={14} />
          Execution provenance
          <ChevronDown size={14} />
        </summary>
        <div>
          <p>
            <span>Model</span>
            <code>{job.context.model} · temperature 0</code>
          </p>
          <p>
            <span>Runner bundle</span>
            <code>{job.context.bundleHash}</code>
          </p>
          <p>
            <span>Frozen context</span>
            <code>{job.contextHash}</code>
          </p>
          <p>
            <span>Gate policy</span>
            <code>{job.context.gateVersion}</code>
          </p>
          {job.executions.map((x) => (
            <p key={x.side}>
              <span>{x.side}</span>
              <code>
                {x.node || "Preparing"} ·{" "}
                {x.cleanup ? "Environment cleaned up" : x.state}
                <br />
                {x.image || job.context.image}
              </code>
            </p>
          ))}
        </div>
      </details>
      {evidence && (
        <div
          className="drawer-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedCase(undefined);
          }}
        >
          <Dialog
            className="evidence-drawer"
            labelledBy="evidence-title"
            onClose={() => setSelectedCase(undefined)}
          >
            <div className="drawer-head">
              <span className="eyebrow">BEHAVIORAL EVIDENCE</span>
              <button
                onClick={() => setSelectedCase(undefined)}
                aria-label="Close evidence"
              >
                <X size={20} />
              </button>
            </div>
            <h2 id="evidence-title">{evidence.test.name}</h2>
            <div className="evidence-subtitle">
              <code>{evidence.test.id}</code>
              {evidence.test.critical && (
                <span className="critical-tag">CRITICAL</span>
              )}
            </div>
            <div className="input-block">
              <span className="small-label">CUSTOMER MESSAGE</span>
              <p>“{evidence.test.input}”</p>
            </div>
            <div className="expected-block">
              <ShieldCheck size={16} />
              <span>
                Expected decision:{" "}
                <strong>{evidence.test.expected.join(" or ")}</strong>
                {evidence.test.orders[0] && (
                  <small>
                    Order age: {evidence.test.orders[0].ageDays} days · Status:{" "}
                    {evidence.test.orders[0].status}
                  </small>
                )}
              </span>
            </div>
            <div className="evidence-columns">
              <Evidence title="Baseline" result={evidence.b} />
              <Evidence title="Candidate" result={evidence.n} />
            </div>
            <p className="evidence-footnote">
              Tool calls are captured by the platform harness. Assertions are
              computed by Go outside the sandbox.
            </p>
          </Dialog>
        </div>
      )}
    </>
  );
}
function Evidence({ title, result }: { title: string; result?: Result }) {
  return (
    <div className="evidence-panel">
      <div className="evidence-panel-head">
        <h3>{title}</h3>
        <CaseStatus result={result} />
      </div>
      {!result ? (
        <p className="muted">Waiting for this case to complete.</p>
      ) : (
        <>
          {result.failure && (
            <div className="inline-error">
              <strong>
                {result.failure.kind} / {result.failure.code}
              </strong>
              <p>{result.failure.message}</p>
            </div>
          )}
          {result.output && (
            <>
              <div className="decision">
                <span>DECISION</span>
                <code>{result.output.decision}</code>
              </div>
              <p className="answer">{result.output.answer}</p>
            </>
          )}
          <div className="evidence-section-label">
            TOOL TRACE <span>{result.trace.length} calls</span>
          </div>
          <Trace result={result} />
          {result.assertions?.length > 0 && (
            <>
              <div className="evidence-section-label">ASSERTIONS</div>
              <div className="assertions">
                {result.assertions.map((a) => (
                  <div
                    key={a.label}
                    className={a.passed ? "" : "assertion-failed"}
                  >
                    {a.passed ? <Check size={13} /> : <X size={13} />}
                    <span>{a.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="usage-line">
            {(result.durationMs / 1000).toFixed(1)}s ·{" "}
            {result.inputTokens.toLocaleString()} input /{" "}
            {result.outputTokens.toLocaleString()} output tokens
          </div>
          <details className="raw-response">
            <summary>Raw model output</summary>
            <pre>{result.raw.join("\n\n")}</pre>
          </details>
        </>
      )}
    </div>
  );
}
