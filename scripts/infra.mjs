import { existsSync, mkdirSync, openSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
const pg =
  process.env.PG_BIN ||
  (existsSync("/opt/homebrew/opt/postgresql@17/bin")
    ? "/opt/homebrew/opt/postgresql@17/bin/"
    : "");
mkdirSync(".local", { recursive: true });
const run = (name, args) => execFileSync(pg + name, args, { stdio: "inherit" });
const reachable = (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
if (!(await reachable(54329))) {
  if (!existsSync(".local/postgres/PG_VERSION"))
    run("initdb", [
      "-D",
      ".local/postgres",
      "-A",
      "trust",
      "--encoding=UTF8",
      "--locale=C",
    ]);
  run("pg_ctl", [
    "-D",
    ".local/postgres",
    "-l",
    ".local/postgres.log",
    "-o",
    "-p 54329 -h 127.0.0.1",
    "start",
  ]);
  try {
    run("createdb", ["-h", "127.0.0.1", "-p", "54329", "promptship"]);
  } catch {
    console.log("Database may already exist; continuing.");
  }
}
if (!(await reachable(7233))) {
  const log = openSync(".local/temporal.log", "a");
  const child = spawn(
    "temporal",
    [
      "server",
      "start-dev",
      "--ip",
      "127.0.0.1",
      "--port",
      "7233",
      "--ui-port",
      "8233",
      "--db-filename",
      ".local/temporal.db",
    ],
    { detached: true, stdio: ["ignore", log, log] },
  );
  child.on("error", () =>
    console.error(
      "Install the Temporal CLI to start the local orchestration server.",
    ),
  );
  child.unref();
}
console.log(
  "Local services: PostgreSQL :54329 · Temporal :7233 · Temporal UI :8233",
);
