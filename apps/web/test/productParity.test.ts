/**
 * The marketing site shows the native product; these tests keep it from
 * drifting away from it. Copy is compared with the iOS string table, and the
 * moment table with `RideGuidancePolicy` as written in Swift.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IOS_COPY, t } from "../src/demo/rideCopy.ts";
import { RIDE_MOMENTS, presentMoment, spokenSummary, type RideMoment } from "../src/demo/rideMoments.ts";

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

function parseStrings(path: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of readFileSync(path, "utf8").matchAll(/^"([^"]+)"\s*=\s*"((?:[^"\\]|\\.)*)";/gm)) {
    map.set(match[1]!, match[2]!.replace(/\\"/g, '"'));
  }
  return map;
}

/** Reads `case .a, .b: .value` arms of one `switch moment` in a Swift function. */
function parseSwiftSwitch(source: string, functionName: string): Map<string, string> {
  const start = source.indexOf(`func ${functionName}(`);
  assert.ok(start >= 0, `${functionName} not found in RideGuidance.swift`);
  const body = source.slice(start, source.indexOf("\n    }\n", start));
  const map = new Map<string, string>();
  for (const arm of body.matchAll(/case ((?:\.\w+(?:, )?)+): (?:return )?(\S+)/g)) {
    for (const name of arm[1]!.split(", ")) map.set(name.replace(".", ""), arm[2]!.replace(/^\./, "").replace(/"/g, ""));
  }
  return map;
}

const iosStrings = parseStrings(repo("apps/ios/Resources/ko.lproj/Localizable.strings"));
const guidance = readFileSync(repo("packages/transit-core/Sources/TapsoTransit/RideGuidance.swift"), "utf8");

test("every product string the site quotes is the iOS app's own Korean string", () => {
  for (const [key, value] of Object.entries(IOS_COPY)) {
    assert.ok(iosStrings.has(key), `${key} is not an iOS string key`);
    assert.equal(value, iosStrings.get(key), `${key} drifted from Localizable.strings`);
  }
});

test("format placeholders fill in order", () => {
  assert.equal(t("check.searching.detail", "365"), "정류장으로 오는 365번을 확인하고 있어요");
  assert.equal(t("boarding.stopsToDestination", 8), "내릴 곳까지 8정거장");
});

test("the web moment table matches RideGuidancePolicy in Swift", () => {
  const count = parseSwiftSwitch(guidance, "countPresentation");
  const color = parseSwiftSwitch(guidance, "colorRole");
  const milestone = parseSwiftSwitch(guidance, "milestone");
  const swiftRole: Record<string, string> = {
    journeyActive: "active",
    journeyPrepare: "prepare",
    journeyNext: "next",
    journeyArrival: "arrival",
    journeyChecking: "checking",
    journeyDegraded: "degraded",
  };
  for (const moment of RIDE_MOMENTS) {
    const p = presentMoment(moment);
    assert.equal(p.count, count.get(moment), `count presentation for ${moment}`);
    assert.equal(p.colorRole, swiftRole[color.get(moment) ?? ""], `colour role for ${moment}`);
    assert.equal(p.milestone, milestone.has(moment) && milestone.get(moment) !== "nil", `milestone for ${moment}`);
  }
});

test("alerts belong only to two stops, next stop and arrival", () => {
  const alerting = RIDE_MOMENTS.filter((m) => presentMoment(m).milestone);
  assert.deepEqual(alerting, ["prepare", "nextStop", "arrived"]);
});

test("the Lock Screen escalates basalt → coral at the next stop → tangerine on arrival", () => {
  const surfaces = Object.fromEntries(RIDE_MOMENTS.map((m) => [m, presentMoment(m).surface]));
  assert.equal(surfaces.riding, "basalt");
  assert.equal(surfaces.prepare, "basalt");
  assert.equal(surfaces.nextStop, "coral");
  assert.equal(surfaces.passedDestination, "coral");
  assert.equal(surfaces.arrived, "tangerine");
  for (const m of ["delayed", "vehicleLost", "offline", "checking"] as RideMoment[]) {
    assert.equal(surfaces[m], "basalt", `${m} must stay calm`);
  }
});

test("vehicle identity and data freshness stay two independent signals", () => {
  const signals = RIDE_MOMENTS.map((m) => presentMoment(m));
  assert.ok(signals.some((p) => p.vehicle === "confirmed" && p.data !== "live"), "right bus, late data");
  assert.ok(signals.some((p) => p.vehicle !== "confirmed" && p.data === "live"), "live data, bus missing");
  assert.equal(presentMoment("offline").vehicle, "confirmed", "offline keeps the vehicle confirmed");
});

test("the spoken summary follows the app's a11y.ride shapes", () => {
  assert.equal(
    spokenSummary(presentMoment("riding"), "365", "제주시청(아라방면)", 6),
    "365번, 제주시청(아라방면)까지 6정거장 남음. 내릴 때 알려드릴게요. 지금은 편하게 가셔도 돼요.",
  );
  assert.match(spokenSummary(presentMoment("delayed"), "365", "X", 5), /마지막 확인 기준 5정거장 남음/);
  assert.doesNotMatch(spokenSummary(presentMoment("checking"), "365", "X", 5), /정거장 남음/);
});
