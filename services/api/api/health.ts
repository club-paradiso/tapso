/** GET /api/health — also served at `/health` through the rewrite in vercel.json. */
import { handleTransitRequest } from "../src/apiRuntime.ts";

export const GET = (request: Request): Promise<Response> => handleTransitRequest(request);
export const OPTIONS = (request: Request): Promise<Response> => handleTransitRequest(request);
