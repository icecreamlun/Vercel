import { Sandbox } from "@vercel/sandbox";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { safeError } from "./env.mjs";
// Session operations are deliberately bound to the existing VM. Unlike the
// Sandbox convenience methods, they cannot auto-resume a lost environment.
const credentials = {
  token: process.env.VERCEL_TOKEN,
  teamId: process.env.VERCEL_TEAM_ID,
  projectId: process.env.VERCEL_PROJECT_ID,
};
const input = JSON.parse(
  await new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  }),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  let sandbox;
  if (input.action === "prepare") {
    try {
      sandbox = await Sandbox.get({
        ...credentials,
        name: input.name,
        resume: false,
      });
    } catch (error) {
      if (
        error.status !== 404 &&
        error.code !== "not_found" &&
        !String(error.message).includes("not found")
      )
        throw error;
    }
    if (!sandbox)
      sandbox = await Sandbox.create({
        ...credentials,
        name: input.name,
        image: input.image,
        persistent: false,
        timeout: 1200000,
        networkPolicy: {
          allow: {
            "api.anthropic.com": [
              {
                match: { path: { exact: "/v1/messages" }, method: ["POST"] },
                transform: [
                  {
                    headers: {
                      "x-api-key": process.env.ANTHROPIC_API_KEY,
                      "anthropic-version": "2023-06-01",
                    },
                  },
                ],
              },
              {
                response: {
                  statusCode: 403,
                  body: "Endpoint is not allowed.",
                  contentType: "text/plain",
                },
              },
            ],
          },
        },
      });
    if (sandbox.status !== "running")
      throw new Error(
        `Sandbox is ${sandbox.status}; automatic resume is disabled.`,
      );
    const bundle = await readFile(
      `${process.env.BUNDLE_DIR || "dist/bundles"}/${input.bundleHash}.mjs`,
    );
    if (
      hash(bundle) !== input.bundleHash ||
      hash(input.prompt) !== input.config.promptHash
    )
      throw new Error("Frozen artifact hash mismatch");
    await sandbox.currentSession().writeFiles([
      { path: "/vercel/sandbox/runner.mjs", content: bundle },
      {
        path: "/vercel/sandbox/prompt.txt",
        content: Buffer.from(input.prompt),
      },
      {
        path: "/vercel/sandbox/config.json",
        content: Buffer.from(JSON.stringify(input.config)),
      },
    ]);
    const check = await sandbox
      .currentSession()
      .runCommand("node", [
        "--input-type=module",
        "-e",
        `import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const h=p=>createHash('sha256').update(readFileSync(p)).digest('hex');console.log(JSON.stringify({node:process.version,bundle:h('/vercel/sandbox/runner.mjs'),prompt:h('/vercel/sandbox/prompt.txt')}))`,
      ]);
    if (check.exitCode !== 0)
      throw new Error(
        `Artifact verification command failed: ${(await check.stderr()).slice(0, 500)}`,
      );
    const verified = JSON.parse(await check.stdout());
    if (
      verified.bundle !== input.bundleHash ||
      verified.prompt !== input.config.promptHash
    )
      throw new Error("Sandbox artifact verification failed");
    console.log(JSON.stringify({ image: sandbox.image, node: verified.node }));
  } else {
    try {
      sandbox = await Sandbox.get({
        ...credentials,
        name: input.name,
        resume: false,
      });
    } catch (error) {
      if (
        input.action === "cleanup" &&
        (error.status === 404 ||
          error.code === "not_found" ||
          String(error.message).includes("not found"))
      ) {
        console.log("{}");
        process.exit(0);
      }
      throw error;
    }
    if (input.action === "cleanup") {
      if (sandbox.status === "running") await sandbox.stop();
      await sandbox.delete();
      console.log("{}");
    } else {
      if (sandbox.status !== "running")
        throw new Error(
          `Sandbox is ${sandbox.status}; execution cannot be resumed.`,
        );
      if (input.action === "start") {
        const command = await sandbox.currentSession().runCommand({
          cmd: "node",
          args: ["/vercel/sandbox/runner.mjs", "/vercel/sandbox/config.json"],
          detached: true,
        });
        console.log(JSON.stringify({ commandId: command.cmdId }));
      } else if (input.action === "poll") {
        const command = await sandbox
          .currentSession()
          .getCommand(input.commandId);
        let exitCode = command.exitCode;
        // Metadata may omit a finished command's exit code. The wait endpoint
        // is authoritative; aborting this wait does not kill the remote process.
        const waitSignal = AbortSignal.timeout(750);
        try {
          exitCode = (await command.wait({ signal: waitSignal })).exitCode;
        } catch (error) {
          if (!waitSignal.aborted) throw error;
        }
        const records = [];
        for (const id of input.caseIds) {
          try {
            const bytes = await sandbox.currentSession().readFileToBuffer({
              path: `/vercel/sandbox/results/${input.attempt}/${id}.json`,
            });
            if (bytes === null) continue;
            const text = bytes.toString("utf8");
            if (text.length > 200000)
              throw new Error("Result exceeds maximum size");
            records.push(JSON.parse(text));
          } catch (error) {
            if (
              error.code === "ENOENT" ||
              String(error.message).includes("ENOENT") ||
              String(error.message).includes("No such file")
            )
              continue;
            throw error;
          }
        }
        console.log(
          JSON.stringify({
            records,
            done: exitCode !== null,
            exitCode,
          }),
        );
      } else throw new Error("Unsupported adapter action");
    }
  }
} catch (error) {
  const infrastructure =
    error.name === "APIError" ||
    error.response ||
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|Unexpected response reading file: status/.test(
      error.message || "",
    );
  console.log(
    JSON.stringify({
      error: safeError(error),
      errorKind: infrastructure ? "infra" : "harness",
    }),
  );
  process.exitCode = 1;
}
