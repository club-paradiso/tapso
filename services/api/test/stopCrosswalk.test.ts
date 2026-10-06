import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  candidateBisStationId,
  classifyCrosswalk,
  nextStopNamesByStop,
  parseStationPage,
  runtimeEntries,
  summarizeCrosswalk,
  type CatalogStop,
  type StationEvidence,
} from "../src/stopCrosswalk.ts";

/**
 * SYNTHETIC stops and evidence. Ids follow the TAGO/BIS shapes so the rules can
 * run; no row is a claim that a stop exists or that a mapping was verified.
 */
const east: CatalogStop = { id: "JEB405000315", name: "시청[동]", lat: 33.4996, lng: 126.5312 };
const west: CatalogStop = { id: "JEB405000316", name: "시청[서]", lat: 33.4997, lng: 126.5309 };
const lone: CatalogStop = { id: "JEB406000020", name: "한라수목원", lat: 33.4700, lng: 126.4900 };

function classify(stops: CatalogStop[], evidence: Record<string, StationEvidence> = {}) {
  return classifyCrosswalk(stops, stops.map(() => 1), new Map(Object.entries(evidence)));
}

test("exact name with marker and coordinates within 30 m is VERIFIED_EXACT", () => {
  const [row] = classify([east], { [east.id]: { kind: "found", name: "시청[동]", latitude: 33.49962, longitude: 126.53118 } });
  assert.equal(row!.status, "VERIFIED_EXACT");
  assert.equal(row!.candidateBisStationId, "405000315");
  assert.ok((row!.coordinateDeltaM ?? 99) < 30);
});

test("no evidence is UNCHECKED, never verified and never missing", () => {
  const rows = classify([east, west, lone]);
  assert.deepEqual(rows.map((row) => row.status), ["UNCHECKED", "UNCHECKED", "UNCHECKED"]);
  assert.deepEqual(runtimeEntries(rows, [east, west, lone], "2026-10-06"), []);
});

test("a candidate with no official page is MISSING", () => {
  const [row] = classify([east], { [east.id]: { kind: "not_found" } });
  assert.equal(row!.status, "MISSING");
});

test("a failed read stays UNCHECKED rather than MISSING", () => {
  const [row] = classify([east], { [east.id]: { kind: "read_failed" } });
  assert.equal(row!.status, "UNCHECKED");
  assert.equal(row!.reason, "evidence_read_failed");
});

test("name mismatch: the JEB-stripping assumption is wrong for this stop", () => {
  const [row] = classify([east], { [east.id]: { kind: "found", name: "제주중앙여고", latitude: 33.4996, longitude: 126.5312 } });
  assert.equal(row!.status, "CONFLICT");
  assert.equal(row!.reason, "name_mismatch");
});

test("coordinate mismatch beyond 100 m is CONFLICT; between 30 and 100 m is AMBIGUOUS", () => {
  const far = classify([east], { [east.id]: { kind: "found", name: "시청[동]", latitude: 33.5010, longitude: 126.5312 } })[0]!;
  assert.equal(far.status, "CONFLICT");
  assert.equal(far.reason, "coordinate_mismatch");
  const near = classify([east], { [east.id]: { kind: "found", name: "시청[동]", latitude: 33.5001, longitude: 126.5312 } })[0]!;
  assert.equal(near.status, "AMBIGUOUS");
  assert.equal(near.reason, "coordinate_near_miss");
});

test("the opposite-side pole is CONFLICT, never verified", () => {
  // The candidate for the east pole's id resolves to a page naming the west pole.
  const [row] = classify([east, west], { [east.id]: { kind: "found", name: "시청[서]", latitude: 33.4996, longitude: 126.5312 } });
  assert.equal(row!.status, "CONFLICT");
  assert.equal(row!.reason, "opposite_direction_marker");
});

test("a page without a direction marker cannot single out one of two nearby poles", () => {
  const rows = classify([east, west], { [east.id]: { kind: "found", name: "시청", latitude: 33.4996, longitude: 126.5312 } });
  assert.equal(rows[0]!.status, "AMBIGUOUS");
  assert.equal(rows[0]!.reason, "sibling_pole_nearby");
  assert.equal(rows[0]!.siblingPolesNearby, 1);
});

test("a marker-less page for a lone pole is VERIFIED_BY_NAME_COORDINATE, which the phone still does not use", () => {
  const marked: CatalogStop = { ...lone, name: "한라수목원[북]" };
  const rows = classify([marked], { [marked.id]: { kind: "found", name: "한라수목원", latitude: 33.4700, longitude: 126.4900 } });
  assert.equal(rows[0]!.status, "VERIFIED_BY_NAME_COORDINATE");
  assert.deepEqual(runtimeEntries(rows, [marked], "2026-10-06"), []);
});

test("no coordinates on either side is AMBIGUOUS", () => {
  const unlocated: CatalogStop = { id: "JEB405000999", name: "어딘가", lat: null, lng: null };
  const [row] = classify([unlocated], { [unlocated.id]: { kind: "found", name: "어딘가", latitude: 33.4, longitude: 126.4 } });
  assert.equal(row!.status, "AMBIGUOUS");
  assert.equal(row!.reason, "no_coordinates_to_compare");
  const [pageless] = classify([east], { [east.id]: { kind: "found", name: "시청[동]" } });
  assert.equal(pageless!.status, "AMBIGUOUS");
});

test("a TAGO id outside the JEB405/JEB406 form gets no candidate at all", () => {
  for (const id of ["405000315", "JEB305000315", "JEB40500031", "jeb405000315", "JEB405000315X"]) {
    assert.equal(candidateBisStationId(id), null, id);
  }
  const [row] = classify([{ ...east, id: "SEOUL123" }]);
  assert.equal(row!.status, "MISSING");
  assert.equal(row!.reason, "invalid_tago_id_form");
});

test("duplicate full names are counted but an id-plus-position match still verifies", () => {
  const twin: CatalogStop = { id: "JEB406000315", name: "시청[동]", lat: 33.30, lng: 126.30 };
  const rows = classify([east, twin], { [east.id]: { kind: "found", name: "시청[동]", latitude: 33.4996, longitude: 126.5312 } });
  assert.equal(rows[0]!.duplicateFullName, 1);
  assert.equal(rows[0]!.status, "VERIFIED_EXACT");
  assert.equal(rows[1]!.status, "UNCHECKED");
});

test("runtime entries carry only VERIFIED_EXACT rows, with the coordinates the phone re-checks", () => {
  const rows = classify([east, west], {
    [east.id]: { kind: "found", name: "시청[동]", latitude: 33.4996, longitude: 126.5312 },
    [west.id]: { kind: "found", name: "시청", latitude: 33.4997, longitude: 126.5309 },
  });
  const entries = runtimeEntries(rows, [east, west], "2026-10-06");
  assert.deepEqual(entries, [{
    tagoStopID: "JEB405000315", bisStationID: "405000315", status: "VERIFIED_EXACT", name: "시청[동]",
    latitude: 33.4996, longitude: 126.5312, verifiedOn: "2026-10-06",
  }]);
});

test("the committed catalog: every stop has the JEB405/JEB406 form and candidates never collide", () => {
  const catalog = JSON.parse(readFileSync(new URL("../data/jeju-transit-catalog.json", import.meta.url), "utf8")) as {
    stops: CatalogStop[];
    routes: { stops: number[] }[];
  };
  const counts = catalog.stops.map(() => 0);
  for (const route of catalog.routes) for (const index of new Set(route.stops)) counts[index]! += 1;
  const summary = summarizeCrosswalk(classifyCrosswalk(catalog.stops, counts));
  assert.equal(summary.structure.validTagoIdForm, catalog.stops.length);
  assert.equal(summary.structure.candidateCollisions, 0);
  assert.equal(summary.byStatus.UNCHECKED, catalog.stops.length, "no evidence is committed, so nothing is verified");
  assert.equal(summary.byStatus.VERIFIED_EXACT, 0);
});

// ---- Direction rule and page parser (probe evidence, 2026-10-06) ----


/**
 * Excerpts of the official passenger station page as recorded by the probe
 * workflow on 2026-10-06 (public page, no personal data), reduced to the
 * elements the parser reads. Not a full copy of the page.
 */
function officialPageExcerpt(stationId: string, name: string | null, after: string): string {
  return `<html><head><title>제주버스정보시스템</title></head><body>
    <input type="hidden" id="pagenm"/><input type="hidden" name="routeId" value=""/>
    <input type="hidden" name="stationId" value="${stationId}"/>
    <table><colgroup><col width="11%"></colgroup><tbody><tr>
    ${name === null ? "" : `<td colspan="3" class="station-name"> ${name} </td>`}
    <td></td><td class="text-center"><i class="fas fa-redo-alt btn-refre"></i></td></tr>
    <tr><td>${name ?? ""} ${stationId} | ${after}</td></tr></tbody></table>
    <script>var locale = "ko_KR"; function showTab1() { var dataUrl = "/data/search/getNewArriveScheduleByStationId"; }</script>
    </body></html>`;
}

test("the page parser reads the exact name and the facing direction", () => {
  assert.deepEqual(parseStationPage(officialPageExcerpt("405000007", "노형주공아파트[동]", "S중앙병원 방향 도착예정"), "405000007"),
    { kind: "found", name: "노형주공아파트[동]", direction: "S중앙병원" });
  assert.deepEqual(parseStationPage(officialPageExcerpt("406000002", "롯데호텔", "켄싱턴리조트 중문점입구/롯데호텔 입구[남] 방향 도착예정"), "406000002"),
    { kind: "found", name: "롯데호텔", direction: "켄싱턴리조트 중문점입구/롯데호텔 입구[남]" });
});

test("a direction whose own name contains \"방향\" is read whole (audit 2026-10-07)", () => {
  assert.deepEqual(parseStationPage(officialPageExcerpt("405002800", "제주버스터미널(노형로 방향)", "월구마을/동성마을(노형로 방향) 방향 도착예정"), "405002800"),
    { kind: "found", name: "제주버스터미널(노형로 방향)", direction: "월구마을/동성마을(노형로 방향)" });
});

test("a terminal page has no direction line", () => {
  assert.deepEqual(parseStationPage(officialPageExcerpt("405002000", "제주버스터미널(종점)", "종점 도착예정"), "405002000"),
    { kind: "found", name: "제주버스터미널(종점)" });
});

test("an id the site does not know answers 200 with no name: not_found", () => {
  assert.deepEqual(parseStationPage(officialPageExcerpt("405009999", null, "종점 도착예정"), "405009999"), { kind: "not_found" });
});

test("a page that does not echo the requested id is never evidence", () => {
  assert.deepEqual(parseStationPage(officialPageExcerpt("405000314", "용문사거리[동]", "용담1동주민센터[남] 방향"), "405000315"), { kind: "read_failed" });
  assert.deepEqual(parseStationPage("<html>error</html>", "405000315"), { kind: "read_failed" });
});

test("exact name plus the official facing direction verifies a pole without coordinates", () => {
  const stops: CatalogStop[] = [
    { id: "JEB405000314", name: "용문사거리[동]", lat: 33.508658, lng: 126.510227 },
    { id: "JEB405000315", name: "용문사거리[서]", lat: 33.508808, lng: 126.510051 },
    { id: "JEB405000500", name: "용담1동주민센터[남]", lat: 33.5100, lng: 126.5110 },
    { id: "JEB405000501", name: "용문마을[서]", lat: 33.5080, lng: 126.5090 },
  ];
  const routes = [{ stops: [0, 2] }, { stops: [1, 3] }];
  const rows = classifyCrosswalk(stops, [1, 1, 1, 1], new Map<string, StationEvidence>([
    ["JEB405000314", { kind: "found", name: "용문사거리[동]", direction: "용담1동주민센터[남]" }],
    ["JEB405000315", { kind: "found", name: "용문사거리[서]", direction: "용담1동주민센터[남]" }],
  ]), nextStopNamesByStop(stops, routes));
  assert.equal(rows[0]!.status, "VERIFIED_EXACT");
  assert.equal(rows[0]!.reason, "exact_name_and_direction");
  // The west pole's page facing the east pole's next stop does not fit this pole.
  assert.equal(rows[1]!.status, "AMBIGUOUS");
  assert.equal(rows[1]!.reason, "direction_mismatch");
});

test("a same-named, same-marker stop elsewhere is not verified by name alone", () => {
  const stops: CatalogStop[] = [
    { id: "JEB405000900", name: "마을회관[동]", lat: 33.30, lng: 126.30 },
    { id: "JEB405000901", name: "다음정류장", lat: 33.301, lng: 126.30 },
  ];
  const [row] = classifyCrosswalk(stops, [1, 1], new Map<string, StationEvidence>([
    ["JEB405000900", { kind: "found", name: "마을회관[동]", direction: "다른 마을 정류장" }],
  ]), nextStopNamesByStop(stops, [{ stops: [0, 1] }]));
  assert.equal(row!.status, "AMBIGUOUS");
  const [noDirection] = classifyCrosswalk(stops, [1, 1], new Map<string, StationEvidence>([
    ["JEB405000900", { kind: "found", name: "마을회관[동]" }],
  ]), nextStopNamesByStop(stops, [{ stops: [0, 1] }]));
  assert.equal(noDirection!.status, "AMBIGUOUS");
  assert.equal(noDirection!.reason, "no_coordinates_to_compare");
});

test("next-stop names come from every variant through the pole", () => {
  const stops: CatalogStop[] = [{ id: "A", name: "A" }, { id: "B", name: "B" }, { id: "C", name: "C" }];
  assert.deepEqual(nextStopNamesByStop(stops, [{ stops: [0, 1] }, { stops: [0, 2] }, { stops: [2, 0] }]), [["B", "C"], [], ["A"]]);
});
