/** POST /api/v1/matches — pure ranking over caller-supplied candidates. */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const POST = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
