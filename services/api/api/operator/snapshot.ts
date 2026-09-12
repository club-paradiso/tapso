/**
 * GET /api/operator/snapshot?routeId=&cityCode= — authenticated, uncached.
 *
 * The public `/v1/vehicles` path answers from a shared 20-second cache. A
 * controlled ride measures how often TAGO's own content changes, so it must not
 * poll that cache. This route goes straight to the provider and is `no-store`
 * end to end; it requires `Authorization: Bearer <RIDE_CAPTURE_OPERATOR_TOKEN>`.
 */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const GET = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
