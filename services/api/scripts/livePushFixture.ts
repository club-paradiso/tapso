/**
 * The Live Activity push payload the server would send at a prepare moment,
 * produced by `liveActivityRequest` itself, so the iOS test that decodes its
 * `content-state` as the app's `ContentState` checks the real encoder.
 *
 *   node --experimental-strip-types services/api/scripts/livePushFixture.ts
 *
 * SYNTHETIC: invented token, IDs and times; the demo route's stop names.
 * `test/livePushFixture.test.ts` fails when the committed file drifts.
 */

import { generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { liveActivityRequest, swiftDate } from "../src/apns.ts";

const AT = Date.parse("2026-10-01T08:01:00.000Z");

export const LIVE_PUSH_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/transit/live-activity-push.json");

export function livePushFixture(): string {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const request = liveActivityRequest({
    token: "0".repeat(64),
    event: "update",
    timestampMs: AT,
    staleDateMs: AT + 120_000,
    contentState: {
      phase: "approachingDestination",
      currentStopName: "동문로터리",
      nextStopName: "제주여자상업고등학교",
      remainingStops: 2,
      freshness: "fresh",
      updatedAt: swiftDate(AT),
      destinationPassed: false,
      isOffline: false,
    },
  }, { enabled: true, environment: "development", keyId: "SYNTHETIC0", teamId: "SYNTHETIC0", bundleId: "com.lucanomics.tapso", privateKey });
  return `${JSON.stringify({ synthetic: true, request: `POST ${request.path} (APNs)`, headers: request.headers, body: JSON.parse(request.body) }, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await writeFile(LIVE_PUSH_FIXTURE, livePushFixture());
  console.log("wrote SYNTHETIC fixtures/transit/live-activity-push.json");
}
