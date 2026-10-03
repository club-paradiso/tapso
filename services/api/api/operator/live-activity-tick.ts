/**
 * POST /api/operator/live-activity/tick — authenticated, uncached.
 *
 * The Live Activity scheduler (`docs/exec-plans/LIVE_ACTIVITY_PUSH.md`,
 * milestone 5): refreshes rides that hold a push token and pushes their Live
 * Activity while the app may be suspended. Called every 20 s by the Railway
 * collector with `Authorization: Bearer <RIDE_CAPTURE_OPERATOR_TOKEN>`; answers
 * 503 where APNs is not configured.
 */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const POST = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
