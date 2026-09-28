import { readFile, readdir, writeFile } from "node:fs/promises";
const reports = [];
for (const file of await readdir(".local")) {
  if (!file.startsWith("report-") || !file.endsWith(".json")) continue;
  const j = JSON.parse(await readFile(`.local/${file}`));
  if (j.kind !== "eval") continue;
  reports.push({
    id: j.id,
    createdAt: j.createdAt,
    version: j.candidate.id,
    status: j.executionStatus,
    gate: j.gateStatus,
    error: j.error || null,
    report: j.report || null,
    bundleHash: j.context.bundleHash,
    model: j.context.model,
    cases: j.results.map((r) => ({
      id: r.caseId,
      side: r.side,
      status: r.status,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      durationMs: r.durationMs,
    })),
  });
}
reports.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
await writeFile("docs/validation-runs.json", JSON.stringify(reports, null, 2));
const counts = {};
for (const j of reports.filter((j) => j.status === "completed"))
  for (const r of j.cases) {
    const version = r.side === "baseline" ? "baseline" : j.version;
    counts[version] ||= {};
    counts[version][r.id] ||= { pass: 0, total: 0 };
    counts[version][r.id].total++;
    if (r.status === "pass") counts[version][r.id].pass++;
  }
console.log(JSON.stringify(counts, null, 2));
