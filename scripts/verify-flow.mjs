import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const endpoint = process.env.SMOKE_API || "http://127.0.0.1:8080";
const origin = process.env.SMOKE_ORIGIN || "http://localhost:3000";
const cookie = await readFile(
  process.env.SMOKE_COOKIE || ".local/smoke-cookie",
  "utf8",
);
async function request(path, body, session = cookie) {
  const response = await fetch(endpoint + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: session,
      Origin: origin,
      "Content-Type": "application/json",
      "X-PromptShip-Request": "1",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
const initial = (await request("/project")).body;
const run = initial.jobs.find(
  (j) =>
    j.kind === "eval" &&
    j.candidate.id === "candidate-b" &&
    j.gateStatus === "passed",
);
assert.ok(run, "a real passing B run is required");
const stranger = await request("/demo/session", {}, "");
assert.equal(
  (await request(`/runs/${run.id}`, undefined, stranger.cookie)).status,
  404,
);
assert.equal(
  (await request(`/runs/${run.id}/promote`, {}, stranger.cookie)).status,
  404,
);
const promoted = await Promise.all(
  Array.from({ length: 5 }, () => request(`/runs/${run.id}/promote`, {})),
);
for (const response of promoted) {
  assert.equal(response.status, 200);
  assert.equal(response.body.id, promoted[0].body.id);
  assert.equal(response.body.prompt.hash, run.candidate.hash);
}
const current = (await request("/project")).body;
assert.equal(current.project.generation, initial.project.generation + 1);
assert.equal(current.project.release.id, promoted[0].body.id);
assert.equal(
  (await request("/project", undefined, stranger.cookie)).body.project
    .generation,
  1,
);
const results = [];
for (const [input, decision] of [
  ["Please refund ORD-2048. I know it is 45 days old.", "deny"],
  ["I would like my money back for ORD-1042.", "refund"],
]) {
  const created = await request("/playground", { input });
  assert.equal(created.status, 202);
  for (let i = 0; i < 120; i++) {
    const { body: job } = await request(`/playground/${created.body.id}`);
    if (!["queued", "running"].includes(job.executionStatus)) {
      assert.equal(job.executionStatus, "completed", job.error);
      assert.equal(job.baselineReleaseId, current.project.release.id);
      assert.equal(job.baseline.hash, run.candidate.hash);
      assert.equal(job.results[0].output.decision, decision);
      if (decision === "deny")
        assert.equal(
          job.results[0].trace.filter((t) => t.name === "request_refund")
            .length,
          0,
        );
      if (decision === "refund")
        assert.equal(
          job.results[0].trace.filter((t) => t.name === "request_refund")
            .length,
          1,
        );
      await writeFile(
        `.local/report-${job.id}.json`,
        JSON.stringify(job, null, 2),
      );
      results.push({
        id: job.id,
        decision,
        releaseId: job.baselineReleaseId,
        promptHash: job.baseline.hash,
      });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
assert.equal(results.length, 2, "Playground completion deadline exceeded");
const summary = {
  verifiedAt: new Date().toISOString(),
  sourceRun: run.id,
  releaseId: current.project.release.id,
  concurrentPromotionRequests: 5,
  generationBefore: initial.project.generation,
  generationAfter: current.project.generation,
  crossSessionIsolation: "passed",
  playground: results,
};
await writeFile(
  ".local/flow-validation.json",
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
