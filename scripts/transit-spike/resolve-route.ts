import { PublicDataUltraPrecisionProvider } from "../../services/api/src/publicDataProvider.ts";

const routeNumber = process.argv[2]?.trim();
const standardRegionCode = process.argv[3]?.trim() || "50110";

if (!routeNumber) {
  console.error([
    "Usage: node --experimental-strip-types scripts/transit-spike/resolve-route.ts <route-number> [stdgCd]",
    "Example: node --experimental-strip-types scripts/transit-spike/resolve-route.ts 365 50110",
    "Requires PUBLIC_DATA_SERVICE_KEY in the shell environment. The key is never printed.",
  ].join("\n"));
  process.exit(2);
}

try {
  const provider = new PublicDataUltraPrecisionProvider();
  const routeMasters = await provider.routeMasters(standardRegionCode);
  const normalizedTarget = normalizeRouteNumber(routeNumber);
  const matches = routeMasters.filter(
    (route) => normalizeRouteNumber(route.routeNumber) === normalizedTarget,
  );

  if (matches.length === 0) {
    console.error(JSON.stringify({
      ok: false,
      code: "ROUTE_NOT_FOUND",
      routeNumber,
      standardRegionCode,
      message: "No exact route-number match was returned by the official route-master endpoint.",
    }));
    process.exit(3);
  }

  if (matches.length > 1) {
    console.error(JSON.stringify({
      ok: false,
      code: "ROUTE_AMBIGUOUS",
      routeNumber,
      standardRegionCode,
      candidates: matches,
      message: "Multiple official route-master records matched. Choose only after inspecting direction/variant metadata.",
    }, null, 2));
    process.exit(4);
  }

  console.log(matches[0]!.routeId);
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  console.error(JSON.stringify({
    ok: false,
    code: code ?? "ROUTE_RESOLUTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
    hint: code === "BLOCKED_BY_CREDENTIALS"
      ? "Set PUBLIC_DATA_SERVICE_KEY in the shell environment. Never commit or echo the key."
      : undefined,
  }));
  process.exit(1);
}

function normalizeRouteNumber(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}
