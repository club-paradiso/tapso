/** GET /api/v1/night-guard — see src/apiRouter.ts and src/nightGuard.ts. Read from the reviewed timetable file in data/. */
import { handleTransitRequest } from "../../src/apiRuntime.ts";

export const GET = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
