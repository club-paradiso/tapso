/** GET /api/v1/places?q= — place and address search (Kakao Local), Jeju only. See src/placeSearch.ts. */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const GET = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
