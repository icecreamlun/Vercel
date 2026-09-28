import "./env.mjs";
import { safeError } from "./env.mjs";
import { Sandbox } from "@vercel/sandbox";
import { writeFile } from "node:fs/promises";
const mode = process.argv[2];
const pid = Number(process.argv[3]);
if (!["worker", "sandbox"].includes(mode) || (mode === "worker" && !pid))
  throw new Error(
    "Usage: node scripts/fault.mjs worker <known-api-pid> | sandbox",
  );
let cookie = "";
async function api(path, body) {
  const r = await fetch("http://127.0.0.1:8080" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      "X-PromptShip-Request": "1",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.headers.has("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const b = await r.json();
  if (!r.ok) throw new Error(b.error);
  return b;
}
try {
  await api("/api/demo/session", {});
  const { id } = await api("/api/runs", { version: "candidate-b" });
  await writeFile(`.local/fault-${mode}-cookie`, cookie, { mode: 0o600 });
  console.log(JSON.stringify({ mode, id }));
  for (let i = 0; i < 120; i++) {
    const j = await api(`/api/runs/${id}`);
    const x = j.executions.find((x) => x.state === "running" && x.commandId);
    if (x) {
      const sandbox = await Sandbox.get({
        token: process.env.VERCEL_TOKEN,
        teamId: process.env.VERCEL_TEAM_ID,
        projectId: process.env.VERCEL_PROJECT_ID,
        name: x.name,
        resume: false,
      });
      const ps = await sandbox.runCommand("ps", ["-eo", "comm"]);
      const processes = await ps.stdout();
      if (!processes.split("\n").some((p) => p.trim() === "node"))
        throw new Error("Runner already exited; fault was not injected.");
      const record = {
        mode,
        jobId: id,
        commandId: x.commandId,
        side: x.side,
        name: x.name,
        confirmedNodeRunning: true,
        injectedAt: new Date().toISOString(),
      };
      await writeFile(
        `.local/fault-${mode}.json`,
        JSON.stringify(record, null, 2),
      );
      if (mode === "worker") process.kill(pid, "SIGKILL");
      else {
        await sandbox.stop();
        await sandbox.delete();
      }
      console.log(
        JSON.stringify({
          ...record,
          action: mode === "worker" ? "worker killed" : "sandbox deleted",
        }),
      );
      process.exit(0);
    }
    if (j.executionStatus === "error") throw new Error(j.error);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("No active command appeared before the fault-test deadline.");
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
