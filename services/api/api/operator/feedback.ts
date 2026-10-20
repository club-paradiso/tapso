/**
 * GET /api/operator/feedback?limit= — beta tester reports, newest first.
 * Authenticated (`Authorization: Bearer <RIDE_CAPTURE_OPERATOR_TOKEN>`), uncached.
 */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const GET = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
