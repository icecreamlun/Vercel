import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { evaluate, type TestCase } from "./agent.js";
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const prompt = await readFile("/vercel/sandbox/prompt.txt", "utf8");
if (createHash("sha256").update(prompt).digest("hex") !== config.promptHash)
  throw new Error("Prompt integrity mismatch");
const dir = `/vercel/sandbox/results/${config.attempt}`;
await mkdir(dir, { recursive: true });
for (const test of config.cases as TestCase[]) {
  const evidence = await evaluate(test, prompt, config.model);
  const record = {
    schemaVersion: 1,
    jobId: config.jobId,
    side: config.side,
    attempt: config.attempt,
    contextHash: config.contextHash,
    caseId: test.id,
    ...evidence,
  };
  const path = `${dir}/${test.id}.json`;
  await writeFile(`${path}.tmp`, JSON.stringify(record));
  await rename(`${path}.tmp`, path);
  console.log(
    JSON.stringify({
      caseId: test.id,
      state: evidence.failure?.kind || "completed",
    }),
  );
  if (
    evidence.failure?.kind === "infra" ||
    evidence.failure?.kind === "harness"
  )
    break;
}
