import assert from "node:assert/strict";
import { test } from "node:test";
import { api } from "./api";

test("gateway outages produce a readable error and a subsequent request recovers", async (t) => {
  let attempt = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempt++;
    return attempt === 1
      ? new Response("<html>Bad Gateway</html>", { status: 502 })
      : Response.json({ status: "ok" });
  });
  await assert.rejects(api("/project"), /temporarily unavailable/);
  assert.deepEqual(await api("/project"), { status: "ok" });
});

test("API policy errors retain the server explanation", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "The baseline has changed." }, { status: 409 }),
  );
  await assert.rejects(
    api("/runs/example/promote", {}),
    /baseline has changed/,
  );
});
