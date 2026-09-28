import type { Job, Prompt } from "./types";
export const short = (value: string) => value.slice(0, 7);
export const active = (job: Job) =>
  ["queued", "running"].includes(job.executionStatus);
export const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
export const date = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
export const name = (p: Prompt) =>
  p.id === "baseline"
    ? "Baseline"
    : p.id === "candidate-a"
      ? "Candidate A"
      : "Candidate B";
