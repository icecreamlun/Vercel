"use client";
import { useState } from "react";
import {
  GitBranch,
  Play,
  X,
  ShieldCheck,
  Braces,
  ChevronDown,
  Loader2,
} from "lucide-react";
import type { Prompt } from "./types";
import { short, name } from "./format";
import { Dialog } from "./dialog";
import { PromptDiff } from "./shared";
export function NewEvaluation({
  versions,
  baseline,
  busy,
  onClose,
  onCreate,
}: {
  versions: Prompt[];
  baseline: Prompt;
  busy: boolean;
  onClose: () => void;
  onCreate: (version: string) => void;
}) {
  const candidates = versions.filter((v) => v.hash !== baseline.hash);
  const [id, setID] = useState(candidates[0]?.id);
  const [showPrompt, setShowPrompt] = useState(false);
  const selected = candidates.find((v) => v.id === id);
  return (
    <div
      className="modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <Dialog
        className="modal"
        labelledBy="new-eval-title"
        onClose={() => {
          if (!busy) onClose();
        }}
      >
        <div className="modal-header">
          <span className="modal-icon">
            <GitBranch size={23} />
          </span>
          <button aria-label="Close" disabled={busy} onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <div className="eyebrow">A CONTROLLED COMPARISON</div>
        <h2 id="new-eval-title">What are we shipping next?</h2>
        <p>
          Choose a prompt revision. We’ll compare it with the current production
          release across all 8 test cases.
        </p>
        <div className="baseline-strip">
          <span className="live-dot" />
          <span>Production baseline</span>
          <code>{short(baseline.sha)}</code>
          <strong>{name(baseline)}</strong>
        </div>
        <label className="field-label">CANDIDATE REVISION</label>
        <div className="candidate-options">
          {candidates.map((v) => (
            <button
              key={v.id}
              onClick={() => setID(v.id)}
              className={id === v.id ? "chosen" : ""}
            >
              <span className="radio">{id === v.id && <span />}</span>
              <div>
                <strong>{v.label}</strong>
                <p>{v.description}</p>
                <code>{short(v.sha)}</code>
              </div>
              <span className="version-label">{name(v)}</span>
            </button>
          ))}
        </div>
        <button
          className="text-button"
          onClick={() => setShowPrompt(!showPrompt)}
        >
          <Braces size={14} />
          {showPrompt ? "Hide" : "Review"} prompt changes
          <ChevronDown size={13} />
        </button>
        {showPrompt && selected && (
          <PromptDiff baseline={baseline.prompt} candidate={selected.prompt} />
        )}
        <div className="eval-contract">
          <ShieldCheck size={16} />
          <span>
            Fixed model, harness, and test suite.
            <br />
            <strong>Critical policy failures block release.</strong>
          </span>
        </div>
        <div className="modal-actions">
          <span>16 case executions · real model calls</span>
          <button
            className="button primary"
            disabled={busy || !id}
            onClick={() => onCreate(id)}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Play size={14} />}
            Run evaluation
          </button>
        </div>
      </Dialog>
    </div>
  );
}
