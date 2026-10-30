/**
 * Where each status item comes from. Lives under test/, outside the shipped source: nothing in the page imports this
 * file, so repository paths never reach the public bundle. `statusHonesty.test.ts`
 * checks that every item has an entry and that every path exists.
 *
 * `code` and `tests` are repository paths. `ops` names a dated observation of the
 * running service; it is not a path. `notChecked` is what the item's level does
 * not cover, and must stay true until new evidence replaces it.
 */
export type StatusEvidence = {
  code: readonly string[];
  tests: readonly string[];
  ops?: string;
  notChecked: string;
};

export const STATUS_EVIDENCE: Record<string, StatusEvidence> = {
  "destination-search": {
    code: [
      "apps/ios/TapsoApp/CatalogSearchViews.swift",
      "apps/ios/TapsoApp/PlaceLookupViews.swift",
      "docs/exec-plans/JEJU_PRODUCTION_V1.md",
    ],
    tests: ["scripts/release-gates/jeju-v1.ts"],
    ops: "README current status: catalog 794f3bcb831d783e, 989 variants, 4,338 stops from TAGO; release gate 3 passes",
    notChecked: "Search screens on a real iPhone; address and building lookup runs through Apple Maps on the phone.",
  },
  "route-boarding": {
    code: ["services/api/src/apiRouter.ts", "docs/product/LIVE_JOURNEY_V3.md"],
    tests: ["services/api/test/apiRouter.test.ts", "apps/ios/Tests/TapsoAPIClientTests.swift"],
    ops: "GET https://tapso-api.vercel.app/health on 2026-10-30: sessionStore redis, enabled, namespace production; post-deploy smoke 19/19 and session lifecycle 8/8 on 2026-10-20",
    notChecked: "The selection screens on a real iPhone.",
  },
  "lock-screen": {
    code: ["apps/ios/LiveActivity", "docs/LIVE_ACTIVITY_SPEC.md"],
    tests: ["apps/ios/Tests/SnapshotEvidenceTests.swift", "apps/ios/Tests/RidePresentationTests.swift"],
    ops: "CI job ios renders the Lock Screen and Dynamic Island on an iPhone simulator in ko, en, zh-Hans and ja",
    notChecked: "Real Dynamic Island hardware; no entry under artifacts/device-validation/.",
  },
  "map-apps": {
    code: ["apps/ios/ShareExtension", "docs/product/MAP_HANDOFF_V3.md"],
    tests: ["apps/ios/Tests/MapHandoffFlowTests.swift"],
    notChecked: "The share extension from KakaoMap, NAVER Map and Apple Maps on a real iPhone (README: UNVERIFIED).",
  },
  "last-bus-passed-stop": {
    code: ["docs/product/JEJU_SAFETY_LAYER_V3.md", "docs/DATA_SOURCES.md"],
    tests: ["apps/ios/Tests/RidePresentationTests.swift"],
    ops: "README: TAGO publishes no first or last departure for the 58 checked Jeju variants (VERIFIED 2026-10-01), so the card says the last bus is unknown",
    notChecked: "Both flows on a real iPhone; no real last-bus time exists to show.",
  },
  "vehicle-progress": {
    code: ["services/api/src/matching.ts", "services/api/src/matchingReadiness.ts", "docs/VEHICLE_MATCHING.md"],
    tests: ["services/api/test", "docs/validation/MATCHER_SAFETY_EVIDENCE_V4.md"],
    ops: "/health on 2026-10-30: matching mode shadow, automaticMatchingEnabled false, demonstrated READY_FOR_SHADOW; docs/ROADMAP.md item 8: zero observed boardings",
    notChecked: "Any real boarding; the position count has not been compared with a bus the rider actually took.",
  },
  "language-access-privacy": {
    code: ["docs/PRIVACY.md", "docs/beta/LOCALIZATION_AUDIT.md", "scripts/ios/check_localization.py"],
    tests: ["scripts/ios/check_localization.py"],
    notChecked: "Native review of zh-Hans and ja (docs/KNOWN_ISSUES.md); VoiceOver on a device (docs/ROADMAP.md item 9).",
  },
  "background-push": {
    code: ["docs/exec-plans/LIVE_ACTIVITY_PUSH.md", "docs/LIVE_ACTIVITY_SPEC.md"],
    tests: ["services/api/test"],
    ops: "/health on 2026-10-30: apns.enabled false, missing APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_ENVIRONMENT, APNS_PRIVATE_KEY",
    notChecked: "Any push delivered to a real device.",
  },
  "real-iphone": {
    code: ["docs/DEVICE_TEST_PLAN.md", "docs/beta/FREE_TEAM_FIELD_TEST.md"],
    tests: [],
    ops: "artifacts/device-validation/ holds only README.md and TEMPLATE.md",
    notChecked: "Everything; this item exists to produce that evidence.",
  },
  release: {
    code: ["docs/TESTFLIGHT.md", "docs/beta/HUMAN_ACTION_REQUIRED.md"],
    tests: [],
    ops: "docs/TESTFLIGHT.md: only a free Personal Team is reachable; docs/ROADMAP.md item 10: distribution BLOCKED_BY_PAID_MEMBERSHIP",
    notChecked: "No App Store Connect record, privacy policy URL or build upload.",
  },
};
