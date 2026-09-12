/** GET /api/v1/vehicles?routeId=&cityCode= — normalized live snapshot with honest timestamp semantics. */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const GET = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
