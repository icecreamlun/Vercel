import { readFile, writeFile } from "node:fs/promises";
const endpoint = process.env.SMOKE_API || "http://127.0.0.1:8080";
const origin = process.env.SMOKE_ORIGIN || "http://localhost:3000";
const cookiePath = process.env.SMOKE_COOKIE || ".local/smoke-cookie";
let cookie = "";
try {
  cookie = await readFile(cookiePath, "utf8");
} catch {}
async function api(path, body, key) {
  const response = await fetch(endpoint + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
      "X-PromptShip-Request": "1",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cookie = setCookie.split(";")[0];
    await writeFile(cookiePath, cookie, { mode: 0o600 });
  }
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.error}`);
  return data;
}
await api("/api/demo/session", {});
const version = process.argv[2] || "candidate-a";
const { id } = process.env.RUN_ID
  ? { id: process.env.RUN_ID }
  : await api("/api/runs", { version }, crypto.randomUUID());
console.log(JSON.stringify({ id, version }));
let previous = "";
let completed = false;
for (let i = 0; i < 360; i++) {
  let job;
  try {
    job = await api(`/api/runs/${id}`);
  } catch (error) {
    console.log("API temporarily unavailable; waiting for recovery.");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    continue;
  }
  const summary = JSON.stringify({
    id,
    state: job.executionStatus,
    gate: job.gateStatus,
    progress: job.results.length,
    error: job.error,
    report: job.report,
  });
  if (summary !== previous) {
    console.log(summary);
    previous = summary;
  }
  if (!["queued", "running"].includes(job.executionStatus)) {
    completed = true;
    await writeFile(`.local/report-${id}.json`, JSON.stringify(job, null, 2));
    process.exitCode = job.executionStatus === "error" ? 1 : 0;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
}
if (!completed) throw new Error("Evaluation completion deadline exceeded.");
