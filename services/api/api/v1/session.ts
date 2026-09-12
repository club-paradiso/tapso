/**
 * GET /v1/sessions/:id — the rewrite in vercel.json resolves here and passes the
 * identifier as a query parameter, so no dynamic filename convention is relied on.
 */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const GET = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
