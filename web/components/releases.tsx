import {
  ArrowUpRight,
  GitCommitHorizontal,
  ChevronDown,
  Rocket,
} from "lucide-react";
import type { Data } from "./types";
import { short, date, time } from "./format";
export function Releases({
  data,
  onOpen,
}: {
  data: Data;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">PRODUCTION HISTORY</div>
        <h1>Every release has a reason.</h1>
        <p>
          An immutable record of the prompt and evidence behind each promotion.
        </p>
      </div>
      <div className="release-timeline">
        {data.releases.map((release, i) => (
          <div key={release.id} className="timeline-item">
            <span className={`timeline-dot ${i === 0 ? "current" : ""}`}>
              <Rocket size={16} />
            </span>
            <div className="release-history-card">
              <div>
                <span className="small-label">
                  {date(release.createdAt)} · {time(release.createdAt)}
                </span>
                {i === 0 && (
                  <span className="status good">Current production</span>
                )}
              </div>
              <h2>{release.prompt.label}</h2>
              <div className="inline-meta">
                <GitCommitHorizontal size={15} />
                <code>{short(release.prompt.sha)}</code>
                <span>·</span>
                <span>
                  {release.runId
                    ? "Promoted from a passing evaluation"
                    : "Bootstrap release · no evaluation claimed"}
                </span>
              </div>
              {release.runId && (
                <button
                  className="text-button"
                  onClick={() => onOpen(release.runId!)}
                >
                  View evaluation
                  <ArrowUpRight size={14} />
                </button>
              )}
              <details className="prompt-details">
                <summary>
                  Inspect release artifact
                  <ChevronDown size={13} />
                </summary>
                <div className="release-artifact">
                  <p>
                    Prompt SHA-256 <code>{release.prompt.hash}</code>
                  </p>
                  <p>
                    Runner SHA-256 <code>{release.context.bundleHash}</code>
                  </p>
                  <pre>{release.prompt.prompt}</pre>
                </div>
              </details>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
