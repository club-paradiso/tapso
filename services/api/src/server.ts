/**
 * Local Node adapter for the transit API.
 *
 * This file owns transport only: it turns a Node request into a Web `Request`,
 * hands it to the shared handler, and writes the `Response` back. Routing,
 * validation, caching, and policy live in `apiRouter.ts` so the local server and
 * the production Vercel Functions cannot diverge.
 *
 *   node --experimental-strip-types src/server.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MAX_BODY_BYTES } from "./apiRouter.ts";
import { transitApi } from "./apiRuntime.ts";

const port = Number(process.env.PORT ?? 8787);
const LOCAL_ORIGIN = "http://127.0.0.1";

export const server = createServer(async (request, response) => {
  try {
    const webRequest = await toWebRequest(request);
    const result = await transitApi.handler(webRequest, {
      clientAddress: request.socket.remoteAddress ?? "unknown",
    });
    await writeResponse(response, result);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "payload_too_large";
    const body = JSON.stringify(
      tooLarge
        ? { error: "PAYLOAD_TOO_LARGE", message: "request body exceeds 64 KiB" }
        : { error: "INTERNAL_ERROR", message: "internal error" },
    );
    response.writeHead(tooLarge ? 413 : 500, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  }
});

async function toWebRequest(request: IncomingMessage): Promise<Request> {
  // A fixed base keeps a hostile Host header out of routing. Nothing downstream
  // reads the origin, only the path and the query.
  const url = new URL(request.url ?? "/", LOCAL_ORIGIN);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    // No trusted proxy sits in front of the local server, so forwarding headers
    // would let any caller choose its own rate-limit bucket.
    const lowered = name.toLowerCase();
    if (lowered === "x-forwarded-for" || lowered === "x-real-ip") continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }

  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }
  return new Request(url, { method, headers, body: await readBody(request) });
}

async function readBody(request: IncomingMessage): Promise<ArrayBuffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("payload_too_large");
    chunks.push(buffer);
  }
  const merged = Buffer.concat(chunks);
  return merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength) as ArrayBuffer;
}

async function writeResponse(response: ServerResponse, result: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  result.headers.forEach((value, name) => {
    headers[name] = name === "set-cookie" ? [value] : value;
  });
  const body = result.body ? Buffer.from(await result.arrayBuffer()) : undefined;
  response.writeHead(result.status, headers);
  response.end(body);
}

if (process.env.NODE_ENV !== "test") {
  server.listen(port, "127.0.0.1", () => console.info(`TAPSO API listening on ${LOCAL_ORIGIN}:${port}`));
}
