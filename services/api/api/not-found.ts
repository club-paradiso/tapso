/**
 * Catch-all for unmatched `/v1/...` paths.
 *
 * Without it those requests fall through to the static output and a JSON client
 * receives Vercel's HTML 404 instead of the documented error body. The router
 * resolves nothing for this path and answers `404 NOT_FOUND`.
 */
import { handleTransitRequest } from "../src/apiRuntime.ts";

export const GET = (request: Request): Promise<Response> => handleTransitRequest(request);
export const POST = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
