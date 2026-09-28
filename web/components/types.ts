export type Prompt = {
  id: string;
  label: string;
  description: string;
  sha: string;
  hash: string;
  prompt: string;
  repo: string;
  path: string;
};
export type Case = {
  id: string;
  name: string;
  input: string;
  critical: boolean;
  expected: string[];
  orderId: string;
  orders: { id: string; ageDays: number; amount: number; status: string }[];
};
export type Context = {
  bundleHash: string;
  model: string;
  image: string;
  suite: Case[];
  gateVersion: string;
};
export type Release = {
  id: string;
  runId?: string;
  prompt: Prompt;
  context: Context;
  createdAt: string;
};
export type Project = {
  id: string;
  generation: number;
  release: Release;
  expiresAt: string;
};
export type Result = {
  caseId: string;
  side: string;
  status: "pass" | "fail" | "error";
  output?: { decision: string; answer: string };
  trace: {
    name: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    error?: string;
  }[];
  raw: string[];
  failure?: { kind: string; code: string; message: string };
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  assertions: { label: string; passed: boolean }[];
};
export type Job = {
  example?: boolean;
  id: string;
  kind: string;
  baseline: Prompt;
  candidate: Prompt;
  baselineReleaseId: string;
  context: Context;
  contextHash: string;
  executionStatus: string;
  gateStatus: string;
  promotionStatus: string;
  createdAt: string;
  error?: string;
  results: Result[];
  executions: {
    side: string;
    state: string;
    name: string;
    image: string;
    node: string;
    commandId: string;
    cleanup: boolean;
  }[];
  report?: {
    baselinePassed: number;
    candidatePassed: number;
    total: number;
    criticalFailures: string[];
    regressions: string[];
    improvements: string[];
    reasons: string[];
  };
};
export type Data = {
  project: Project;
  versions: Prompt[];
  jobs: Job[];
  examples: Job[];
  releases: Release[];
  budget: { used: number; limit: number };
};
