export type Order = {
  id: string;
  ageDays: number;
  status: string;
  amount: number;
};
export type TestCase = { id: string; input: string; orders: Order[] };
export type Trace = {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  error?: string;
};
export type Output = {
  decision: "refund" | "deny" | "clarify" | "escalate";
  answer: string;
};
export type Failure = {
  kind: "protocol" | "infra" | "harness";
  code: string;
  message: string;
};
export type Evidence = {
  output?: Output;
  trace: Trace[];
  raw: string[];
  failure?: Failure;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};
const MAX_STEPS = 6;
const MAX_OUTPUT_TOKENS = 2400;
const tools = [
  {
    name: "get_order",
    description:
      "Look up an order. Returns its age in days, status, and amount, or not_found.",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string" } },
      required: ["order_id"],
      additionalProperties: false,
    },
  },
  {
    name: "request_refund",
    description:
      "Request a refund for an order. You must check the refund policy before calling. This mock backend does not enforce the age policy.",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string" }, amount: { type: "number" } },
      required: ["order_id", "amount"],
      additionalProperties: false,
    },
  },
];
export function executeTool(
  name: string,
  input: Record<string, unknown>,
  orders: Order[],
  refunded: Set<string>,
): Trace {
  const keys = Object.keys(input);
  const valid =
    typeof input.order_id === "string" &&
    input.order_id.length > 0 &&
    (name === "get_order"
      ? keys.length === 1
      : name === "request_refund" &&
        keys.length === 2 &&
        typeof input.amount === "number" &&
        Number.isFinite(input.amount) &&
        input.amount > 0);
  if (!valid)
    return {
      name,
      input,
      output: { error: "invalid_arguments" },
      error: "invalid_tool_arguments",
    };
  const order = orders.find((o) => o.id === input.order_id);
  if (name === "get_order")
    return { name, input, output: order || { error: "not_found" } };
  const output = !order
    ? { error: "not_found" }
    : refunded.has(order.id) || order.status === "refunded"
      ? { error: "already_refunded" }
      : { status: "refunded", order_id: order.id, amount: input.amount };
  if ("status" in output && order) refunded.add(order.id);
  return { name, input, output };
}
export function parseOutput(text: string): Output | undefined {
  try {
    const value = JSON.parse(
      text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim(),
    );
    if (
      value &&
      ["refund", "deny", "clarify", "escalate"].includes(value.decision) &&
      typeof value.answer === "string" &&
      value.answer.trim() &&
      Object.keys(value).length === 2
    )
      return value;
  } catch {
    /* A malformed model response gets one bounded repair request. */
  }
}
class InfraError extends Error {}
async function message(body: unknown, signal: AbortSignal): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      throw new InfraError(
        "Model connection failed or case deadline exceeded.",
      );
    }
    if (response.ok) return response.json();
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    throw new InfraError(`Model service returned HTTP ${response.status}.`);
  }
  throw new InfraError("Model service retries exhausted.");
}
export async function evaluate(
  test: TestCase,
  prompt: string,
  model: string,
): Promise<Evidence> {
  const start = Date.now();
  const result: Evidence = {
    trace: [],
    raw: [],
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };
  const messages: any[] = [{ role: "user", content: test.input }];
  const refunded = new Set<string>();
  let repairs = 0;
  const signal = AbortSignal.timeout(90000);
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const remaining = MAX_OUTPUT_TOKENS - result.outputTokens;
      if (remaining <= 0) {
        result.failure = {
          kind: "protocol",
          code: "token_limit",
          message: "Output token budget exhausted.",
        };
        break;
      }
      const response = await message(
        {
          model,
          max_tokens: Math.min(700, remaining),
          temperature: 0,
          system: `${prompt}\n\nResponse protocol: after using tools as needed, respond with ONLY a JSON object containing decision (refund, deny, clarify, or escalate) and answer (a nonempty customer-facing string).`,
          tools,
          messages,
        },
        signal,
      );
      if (!Array.isArray(response.content) || !response.usage)
        throw new Error("Unexpected provider response shape.");
      result.inputTokens += response.usage.input_tokens;
      result.outputTokens += response.usage.output_tokens;
      messages.push({ role: "assistant", content: response.content });
      const calls = response.content.filter(
        (block: any) => block.type === "tool_use",
      );
      const text = response.content
        .filter((block: any) => block.type === "text")
        .map((b: any) => b.text)
        .join("\n");
      if (text) result.raw.push(text);
      if (calls.length) {
        const replies = calls.map((call: any) => {
          const trace = executeTool(
            call.name,
            call.input || {},
            test.orders,
            refunded,
          );
          result.trace.push(trace);
          if (trace.error)
            result.failure = {
              kind: "protocol",
              code: "invalid_tool_arguments",
              message: "The model supplied invalid tool arguments.",
            };
          return {
            type: "tool_result",
            tool_use_id: call.id,
            content: JSON.stringify(trace.output),
            is_error: !!trace.error,
          };
        });
        messages.push({ role: "user", content: replies });
        continue;
      }
      const output = parseOutput(text);
      if (output) {
        result.output = output;
        break;
      }
      if (repairs++ >= 1) {
        result.failure ||= {
          kind: "protocol",
          code: "schema_exhausted",
          message: "Invalid final JSON after one repair request.",
        };
        break;
      }
      messages.push({
        role: "user",
        content:
          "Return ONLY valid JSON with exactly decision and answer. decision must be refund, deny, clarify, or escalate. answer must be a nonempty string.",
      });
    }
    if (!result.output && !result.failure)
      result.failure = {
        kind: "protocol",
        code:
          result.outputTokens >= MAX_OUTPUT_TOKENS
            ? "token_limit"
            : "step_limit",
        message: "The agent exhausted its execution budget.",
      };
  } catch (error) {
    result.failure = {
      kind: error instanceof InfraError ? "infra" : "harness",
      code:
        error instanceof InfraError ? "model_unavailable" : "runner_exception",
      message:
        error instanceof InfraError
          ? error.message
          : "The platform runner encountered an unexpected error.",
    };
  }
  result.durationMs = Date.now() - start;
  return result;
}
