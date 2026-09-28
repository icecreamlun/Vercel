import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool, parseOutput } from "./agent.js";
test("trace preserves forbidden refund attempts instead of silently blocking policy", () => {
  const trace = executeTool(
    "request_refund",
    { order_id: "old", amount: 79 },
    [{ id: "old", ageDays: 45, status: "paid", amount: 79 }],
    new Set(),
  );
  assert.deepEqual(trace.output, {
    status: "refunded",
    order_id: "old",
    amount: 79,
  });
});
test("invalid tool arguments become observable errors", () => {
  assert.equal(
    executeTool(
      "request_refund",
      { order_id: "x", amount: "79" },
      [],
      new Set(),
    ).error,
    "invalid_tool_arguments",
  );
  assert.equal(
    executeTool("shell", { order_id: "x" }, [], new Set()).error,
    "invalid_tool_arguments",
  );
});
test("response schema rejects unknown decision and empty answer", () => {
  assert.equal(parseOutput('{"decision":"refund","answer":""}'), undefined);
  assert.equal(parseOutput('{"decision":"maybe","answer":"Hello"}'), undefined);
  assert.deepEqual(
    parseOutput('{"decision":"deny","answer":"Outside policy."}'),
    { decision: "deny", answer: "Outside policy." },
  );
});
