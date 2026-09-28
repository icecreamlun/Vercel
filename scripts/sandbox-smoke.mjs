import { Sandbox } from "@vercel/sandbox";
import { safeError } from "./env.mjs";

let sandbox;
try {
  sandbox = await Sandbox.create({
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
    name: `ps-smoke-${Date.now()}`,
    persistent: false,
    image: "vercel/sandbox/node:22",
    timeout: 120000,
    networkPolicy: {
      allow: {
        "api.anthropic.com": [
          {
            transform: [
              {
                headers: {
                  "x-api-key": process.env.ANTHROPIC_API_KEY,
                  "anthropic-version": "2023-06-01",
                },
              },
            ],
          },
        ],
      },
    },
  });
  await sandbox.writeFiles([
    {
      path: "/vercel/sandbox/check.mjs",
      content: Buffer.from(`
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:16,messages:[{role:'user',content:'Reply with OK.'}]})});
    const b=await r.json(); console.log(JSON.stringify({node:process.version,status:r.status,text:b.content?.[0]?.text,error:b.error?.type}));
  `),
    },
  ]);
  const command = await sandbox.runCommand("node", [
    "/vercel/sandbox/check.mjs",
  ]);
  console.log(await command.stdout());
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
} finally {
  if (sandbox) {
    await sandbox.stop().catch(() => {});
    await sandbox.delete().catch(() => {});
  }
}
