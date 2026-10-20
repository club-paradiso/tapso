/** POST /api/v1/feedback — a beta tester's report, answered with a receipt id. See src/feedbackStore.ts. */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const POST = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
