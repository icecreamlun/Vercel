import { readFileSync } from "node:fs";

// Local convenience only. Production supplies these through its secret manager.
export function loadEnv() {
  try {
    for (const line of readFileSync(
      new URL("../.token", import.meta.url),
      "utf8",
    ).split("\n")) {
      const match = line.match(/^\s*([\w]+)\s*[:=]\s*(.*?)\s*$/);
      if (!match) continue;
      const aliases = {
        TEAM_ID: "VERCEL_TEAM_ID",
        PROJECT_ID: "VERCEL_PROJECT_ID",
        anthropic_api_key: "ANTHROPIC_API_KEY",
      };
      const key = aliases[match[1]] || match[1];
      process.env[key] ||= match[2].replace(/^["']|["']$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function safeError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const [key, value] of Object.entries(process.env)) {
    if (/TOKEN|KEY|PASSWORD|SECRET/.test(key) && value?.length > 6)
      message = message.split(value).join("[redacted]");
  }
  return message.slice(0, 1000);
}

loadEnv();
