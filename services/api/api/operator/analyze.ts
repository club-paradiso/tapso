/**
 * POST /api/operator/analyze — a completed ride capture in, the sanitized
 * report out. Stateless: the capture is analysed and discarded in the same
 * request, never stored and never logged, so the raw vehicle numbers it carries
 * stay on the operator's device apart from this one transit.
 */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const POST = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
