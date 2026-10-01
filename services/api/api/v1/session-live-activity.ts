/** PUT, DELETE /v1/sessions/:id/live-activity — rewrite target for the Live Activity push token. */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const PUT = (request: Request): Promise<Response> => handleTransitRequest(request);
export const DELETE = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
