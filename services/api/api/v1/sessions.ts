/** POST /api/v1/sessions — ride session creation; fails closed while sessions are memory-only. */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const POST = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
