import "./env.mjs";
import { mkdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
process.env.DATABASE_URL ||=
  "postgres://localhost:54329/promptship?sslmode=disable";
process.env.APP_ORIGIN ||= "http://localhost:3000";
mkdirSync("bin", { recursive: true });
execFileSync("go", ["build", "-o", "bin/promptship", "./cmd/server"], {
  stdio: "inherit",
});
const children = [
  spawn("./bin/promptship", [], { stdio: "inherit", env: process.env }),
  spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1"],
    { cwd: "web", stdio: "inherit", env: process.env },
  ),
];
let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => stop(signal));
for (const child of children) {
  child.on("error", () => {
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code) => {
    if (code) process.exitCode = code;
    stop();
  });
}
