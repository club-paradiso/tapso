/**
 * One Upstash Redis command over its REST API.
 *
 * Shared by every store that talks to Upstash, so they fail the same way. The
 * rules it enforces:
 *
 *  - A store that cannot be reached never reads as an absent row. Every
 *    transport and protocol failure throws.
 *  - Error messages are ours, never the thrown one. A transport error can carry
 *    the request URL, and that URL carries the credential's host.
 *  - The command body is never logged. Callers put raw evidence in it.
 */

export interface UpstashConnection {
  restUrl: string;
  restToken: string;
  fetchImpl?: typeof fetch;
}

/**
 * `subject` names the store in error messages ("the session store"), and
 * `fail` builds the store's own error type, so callers keep their error
 * contracts.
 */
export async function upstashCommand(
  connection: UpstashConnection,
  command: string[],
  subject: string,
  fail: (message: string) => Error,
): Promise<unknown> {
  const fetchImpl = connection.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(connection.restUrl.replace(/\/+$/, ""), {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.restToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
  } catch {
    throw fail(`${subject} could not be reached`);
  }

  if (!response.ok) {
    throw fail(`${subject} rejected a command with status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw fail(`${subject} returned a malformed response`);
  }
  if (!payload || typeof payload !== "object") {
    throw fail(`${subject} returned a malformed response`);
  }
  if ("error" in payload) {
    throw fail(`${subject} reported a command error`);
  }
  if (!("result" in payload)) {
    throw fail(`${subject} returned a response with no result`);
  }
  return (payload as { result: unknown }).result;
}
