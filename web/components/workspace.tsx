"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  GitBranch,
  GitCommitHorizontal,
  Play,
  Plus,
  X,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  CircleCheck,
  Loader2,
  RotateCcw,
  Layers3,
  FlaskConical,
  MessageSquare,
  Rocket,
  AlertTriangle,
} from "lucide-react";
import type { Data, Job } from "./types";
import { api } from "./api";
import { short, active, date, time } from "./format";
import { Status, Empty } from "./shared";
import { NewEvaluation } from "./new-evaluation";
import { RunDetail } from "./run-detail";
import { Playground } from "./playground";
import { Dialog } from "./dialog";
import { Releases } from "./releases";
let session: Promise<unknown> | undefined;
export default function Workspace() {
  const [data, setData] = useState<Data>();
  const [view, setView] = useState<"runs" | "playground" | "releases">("runs");
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const displayedError = error || connectionError;
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const refresh = useCallback(async () => {
    const next = await api<Data>("/project");
    setData(next);
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        session ||= api("/demo/session", {});
        try {
          await session;
        } catch (error) {
          session = undefined;
          throw error;
        }
        const next = await api<Data>("/project");
        if (!disposed) {
          setData(next);
          setConnectionError("");
        }
      } catch (e) {
        if (!disposed) setConnectionError((e as Error).message);
      } finally {
        if (!disposed) timer = setTimeout(poll, 2500);
      }
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const run =
    data &&
    [...data.jobs, ...(data.examples || [])].find((j) => j.id === selected);
  const inProgress = data?.jobs.some(active) || false;
  async function create(version: string) {
    setBusy(true);
    setError("");
    try {
      const j = await api<{ id: string }>(
        "/runs",
        { version },
        crypto.randomUUID(),
      );
      await refresh();
      setSelected(j.id);
      setCreating(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function promote(job: Job) {
    setBusy(true);
    try {
      await api(`/runs/${job.id}/promote`, {});
      await refresh();
      setToast("New prompt is live in Production.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    try {
      await api("/reset", {});
      await refresh();
      setConfirmReset(false);
      setToast(
        "Production restored to baseline. Previous reports are preserved.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const navigate = (next: typeof view) => {
    setView(next);
    setSelected(undefined);
    setCreating(false);
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="PromptShip home">
          <span className="brand-mark">
            <Layers3 size={20} />
          </span>
          promptship<span className="beta">BETA</span>
        </a>
        <div className="workspace-picker">
          <span className="workspace-avatar">F</span>
          <span>
            Forma workspace<small>Personal sandbox</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={view === "runs" ? "selected" : ""}
            onClick={() => navigate("runs")}
          >
            <FlaskConical size={17} />
            Evaluations
            {data && (
              <span className="nav-count">
                {data.jobs.filter((j) => j.kind === "eval").length}
              </span>
            )}
          </button>
          <button
            className={view === "playground" ? "selected" : ""}
            onClick={() => navigate("playground")}
          >
            <MessageSquare size={17} />
            Playground
          </button>
          <button
            className={view === "releases" ? "selected" : ""}
            onClick={() => navigate("releases")}
          >
            <Rocket size={17} />
            Releases
          </button>
        </nav>
        <div className="sidebar-project">
          <div className="nav-label">CONNECTED PROJECT</div>
          <div>
            <span className="project-dot" />
            customer-support
          </div>
          <p>Prompt-only pipeline</p>
        </div>
        <div className="sidebar-bottom">
          <div className="engine-status">
            <span />
            Isolated execution
          </div>
          <p>
            Go + Temporal
            <br />
            Powered by Vercel Sandbox
          </p>
          <button
            className="text-button muted"
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcw size={13} />
            Reset workspace
          </button>
          <div className="profile">
            <span className="avatar">Y</span>
            <div>
              Your workspace<small>Private to this browser</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="mobile-brand">promptship / </span>
            <span className="muted">Projects</span>
            <ChevronRight size={13} />
            <span>customer-support</span>
            <span className="project-type">Agent</span>
          </div>
          <div>
            <span className="live-dot" />
            <span className="muted">
              {data?.project.release.prompt.id === "baseline"
                ? "Bootstrap release"
                : "Production live"}
            </span>
            <span className="avatar tiny">Y</span>
          </div>
        </header>
        <main>
          {displayedError && (
            <div className="notice error-notice" role="alert">
              <AlertTriangle size={17} />
              <span>{displayedError}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!data ? (
            <div className="loading">
              <Loader2 className="spin" size={25} />
              <h2>Opening your workspace</h2>
              <p>Preparing an isolated release pipeline.</p>
            </div>
          ) : view === "playground" ? (
            <Playground data={data} refresh={refresh} onError={setError} />
          ) : view === "releases" ? (
            <Releases
              data={data}
              onOpen={(id) => {
                setView("runs");
                setSelected(id);
              }}
            />
          ) : run ? (
            <RunDetail
              job={run}
              busy={busy}
              onBack={() => setSelected(undefined)}
              onPromote={() => promote(run)}
              onPlayground={() => navigate("playground")}
              onEvaluate={() => {
                setSelected(undefined);
                setCreating(true);
              }}
            />
          ) : (
            <>
              <div className="page-heading">
                <div className="eyebrow">
                  <span className="project-dot" />
                  CUSTOMER SUPPORT AGENT
                </div>
                <div className="heading-row">
                  <div>
                    <h1>Ship with evidence.</h1>
                    <p>Catch the regressions your average score misses.</p>
                  </div>
                  <button
                    className="button primary"
                    disabled={inProgress}
                    onClick={() => setCreating(true)}
                  >
                    <Plus size={16} />
                    New evaluation
                  </button>
                </div>
              </div>
              <div className="production-card">
                <div className="production-main">
                  <span className="production-icon">
                    <Rocket size={22} strokeWidth={1.5} />
                  </span>
                  <div>
                    <div className="card-eyebrow">
                      PRODUCTION
                      <span className="live-label">
                        <span />
                        Live
                      </span>
                    </div>
                    <h2>{data.project.release.prompt.label}</h2>
                    <div className="inline-meta">
                      <GitCommitHorizontal size={14} />
                      <code>{short(data.project.release.prompt.sha)}</code>
                      <span className="dot-separator">·</span>
                      <span>
                        {data.project.release.runId
                          ? "Promoted " + date(data.project.release.createdAt)
                          : "Bootstrap · not yet evaluated"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="production-model">
                  <span className="small-label">MODEL</span>
                  <span>Claude Haiku 4.5</span>
                  <span className="small-muted">
                    Same model. Same tools. New prompt.
                  </span>
                </div>
                <button
                  className="button secondary"
                  onClick={() => navigate("playground")}
                >
                  Try in Playground
                  <ArrowUpRight size={15} />
                </button>
              </div>
              <div className="section-heading">
                <div className="tab-title">
                  Evaluations
                  <span>
                    {data.jobs.filter((j) => j.kind === "eval").length}
                  </span>
                </div>
                <div className="section-meta">
                  <ShieldCheck size={14} />3 critical checks<span>·</span>8 test
                  cases
                </div>
              </div>
              <div className="run-list">
                {data.jobs.filter((j) => j.kind === "eval").length === 0 ? (
                  <Empty title="Your next release starts here.">
                    Compare a candidate prompt against Production.
                    <br />
                    Every result includes the behavior behind the score.
                    <button
                      className="button secondary"
                      onClick={() => setCreating(true)}
                    >
                      <Play size={14} />
                      Run your first evaluation
                    </button>
                  </Empty>
                ) : (
                  <>
                    <div className="table-head">
                      <span>CANDIDATE</span>
                      <span>RELEASE GATE</span>
                      <span>PASS RATE</span>
                      <span>CREATED</span>
                      <span />
                    </div>
                    {data.jobs
                      .filter((j) => j.kind === "eval")
                      .map((j) => (
                        <button
                          className="run-row"
                          key={j.id}
                          onClick={() => setSelected(j.id)}
                        >
                          <div className="run-title">
                            <span className={`run-icon ${j.gateStatus}`}>
                              <GitBranch size={18} />
                            </span>
                            <div>
                              <strong>{j.candidate.label}</strong>
                              <span>
                                <code>{short(j.candidate.sha)}</code>
                                <ArrowLeft size={10} />
                                <code>{short(j.baseline.sha)}</code>
                                <span className="run-number">
                                  #{short(j.id)}
                                </span>
                              </span>
                            </div>
                          </div>
                          <div>
                            <Status
                              value={
                                active(j) ? j.executionStatus : j.gateStatus
                              }
                            />
                            {j.promotionStatus === "promoted" && (
                              <small className="promoted-note">Promoted</small>
                            )}
                          </div>
                          <div className="score-cell">
                            {j.report ? (
                              <>
                                <span className="muted">
                                  {Math.round(
                                    (j.report.baselinePassed / j.report.total) *
                                      100,
                                  )}
                                  %
                                </span>
                                <ArrowRight size={13} />
                                <strong>
                                  {Math.round(
                                    (j.report.candidatePassed /
                                      j.report.total) *
                                      100,
                                  )}
                                  %
                                </strong>
                              </>
                            ) : (
                              <span className="muted">
                                {j.results.length} /{" "}
                                {j.context.suite.length * 2} complete
                              </span>
                            )}
                          </div>
                          <div className="created-cell">
                            {date(j.createdAt)}
                            <small>{time(j.createdAt)}</small>
                          </div>
                          <ChevronRight size={16} className="muted" />
                        </button>
                      ))}
                  </>
                )}
              </div>
              {data.examples?.length > 0 && (
                <div className="example-reports">
                  <div>
                    <span className="small-label">RECORDED EXAMPLES</span>
                    <p>
                      Real runs, preserved for inspection. Start your own
                      evaluation to promote a prompt.
                    </p>
                  </div>
                  <div>
                    {data.examples.map((j) => (
                      <button key={j.id} onClick={() => setSelected(j.id)}>
                        <Status value={j.gateStatus} />
                        <span>{j.candidate.label}</span>
                        <span className="example-date">
                          {date(j.createdAt)}
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="principle-grid">
                <div>
                  <span>01</span>
                  <h3>Compare behavior</h3>
                  <p>
                    Both versions run the same cases, tools, and model in
                    isolated environments.
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <h3>Protect what matters</h3>
                  <p>
                    A higher average cannot excuse a failed critical policy
                    check.
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <h3>Promote deliberately</h3>
                  <p>
                    Publish the exact prompt that passed. Try the release in the
                    Playground.
                  </p>
                </div>
              </div>
              <div className="page-foot">
                <span>
                  Evaluations measure this fixed suite, not overall model
                  quality.
                </span>
                <span>Session expires {date(data.project.expiresAt)}</span>
              </div>
            </>
          )}
        </main>
      </div>
      {creating && data && (
        <NewEvaluation
          versions={data.versions}
          baseline={data.project.release.prompt}
          busy={busy}
          onClose={() => setCreating(false)}
          onCreate={create}
        />
      )}
      {confirmReset && (
        <div className="modal-scrim">
          <Dialog
            className="modal small-modal"
            labelledBy="reset-title"
            onClose={() => {
              if (!busy) setConfirmReset(false);
            }}
          >
            <h2 id="reset-title">Restore the baseline?</h2>
            <p>
              Production returns to the original prompt. Previous reports stay
              available, but unpromoted evaluations become stale. The shared
              execution budget does not reset.
            </p>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setConfirmReset(false)}
              >
                Keep working
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={reset}
              >
                Reset production
              </button>
            </div>
          </Dialog>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
