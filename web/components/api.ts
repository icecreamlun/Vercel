export async function api<T>(
  path: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-PromptShip-Request": "1",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      "The service is temporarily unavailable. Please try again.",
    );
  }
  if (!response.ok)
    throw new Error(
      typeof value?.error === "string"
        ? value.error
        : "The request could not be completed. Please try again.",
    );
  return value;
}
