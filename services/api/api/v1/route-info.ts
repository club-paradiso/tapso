/** GET /api/v1/route-info?routeId=&cityCode= — a route's published service day (first/last departure, headways). */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const GET = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
