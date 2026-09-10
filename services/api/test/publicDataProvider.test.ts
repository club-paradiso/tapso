import test from "node:test";
import assert from "node:assert/strict";
import { TagoTransitProvider } from "../src/publicDataProvider.ts";
import { ProviderConfigurationError, ProviderResponseError } from "../src/provider.ts";
import { matchVehicle } from "../src/matching.ts";

// All items and identifiers in this suite are synthetic, shaped by official TAGO docs.
const route = { routeId: "SYNTHETIC_ROUTE", cityCode: "999" };
const vehicle = { vehicleno: "SYNTHETIC_BUS", nodeid: "SYNTHETIC_STOP", nodenm: "Synthetic stop", nodeord: 2, gpslati: 33.4, gpslong: 126.5 };
const envelope = (items: unknown, totalCount = 1, pageNo = 1) => ({ response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." }, body: { items, totalCount, pageNo } } });
const reply = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 });
const providerFor = (payload: unknown) => new TagoTransitProvider({ serviceKey: "synthetic-key", fetchImplementation: async () => reply(payload) });

test("rejects missing and Encoding credentials before sending requests", async () => {
  for (const serviceKey of ["", "synthetic%2Bkey%3D"]) {
    const provider = new TagoTransitProvider({ serviceKey, fetchImplementation: async () => { throw new Error("must not call"); } });
    await assert.rejects(provider.vehicles(route), ProviderConfigurationError);
  }
});

test("uses official TAGO location endpoint and encodes the Decoding key exactly once", async () => {
  const provider = new TagoTransitProvider({ serviceKey: "synthetic+key/=", now: () => new Date("2026-09-10T03:00:00Z"), fetchImplementation: async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://apis.data.go.kr");
    assert.equal(url.pathname, "/1613000/BusLcInfoInqireService/getRouteAcctoBusLcList");
    assert.equal(url.searchParams.get("serviceKey"), "synthetic+key/=");
    assert.equal(url.searchParams.get("cityCode"), route.cityCode);
    assert.equal(url.searchParams.get("routeId"), route.routeId);
    assert.equal(url.searchParams.get("_type"), "json");
    assert.equal(url.searchParams.has("stdgCd"), false);
    assert.equal(options?.redirect, "error");
    return reply(envelope({ item: vehicle }));
  } });
  const [result] = await provider.vehicles(route);
  assert.equal(result.vehicleId, vehicle.vehicleno);
  assert.equal(result.stopSequence, 2);
  assert.equal(result.stopName, vehicle.nodenm);
  assert.equal(result.latitude, 33.4);
  assert.equal(result.longitude, 126.5);
  assert.equal(result.timestampSource, "unavailable");
  assert.equal(result.observedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(result.receivedAt, "2026-09-10T03:00:00.000Z");
  assert.equal(matchVehicle({ routeId: route.routeId, boardingStopSequence: 2, now: result.receivedAt!, candidates: [result] }).status, "unavailable");
});

test("sorts stops by numeric nodeord and preserves updowncd", async () => {
  const provider = providerFor(envelope({ item: [
    { nodeid: "SYNTHETIC_B", nodenm: "B", nodeord: "10", updowncd: 1 },
    { nodeid: "SYNTHETIC_A", nodenm: "A", nodeord: "2", updowncd: 0 },
  ] }, 2));
  const stops = await provider.stops(route);
  assert.deepEqual(stops.map(s => [s.stopId, s.sequence, s.directionCode]), [["SYNTHETIC_A", 2, "0"], ["SYNTHETIC_B", 10, "1"]]);
});

test("discovers city and route IDs from responses and follows pagination", async () => {
  const paths: string[] = [];
  const provider = new TagoTransitProvider({ serviceKey: "synthetic-key", fetchImplementation: async input => {
    const url = new URL(String(input)); paths.push(url.pathname);
    if (url.pathname.endsWith("getCtyCodeList")) return reply(envelope({ item: { citycode: 999, cityname: "Synthetic city" } }));
    assert.equal(url.searchParams.get("routeNo"), "365");
    const page = Number(url.searchParams.get("pageNo"));
    return reply(envelope({ item: { routeid: `SYNTHETIC_${page}`, routeno: 365, startnodenm: "A", endnodenm: "B" } }, 2, page));
  } });
  const [city] = await provider.cities();
  assert.equal(city.cityCode, "999");
  const routes = await provider.routes(city.cityCode, "365");
  assert.deepEqual(routes.map(r => r.routeId), ["SYNTHETIC_1", "SYNTHETIC_2"]);
  assert.ok(paths[0].endsWith("getCtyCodeList"));
  assert.ok(paths[1].endsWith("getRouteNoList"));
});

test("treats successful empty data as empty but rejects malformed or failed responses", async () => {
  assert.deepEqual(await providerFor(envelope("", 0)).vehicles(route), []);
  for (const payload of [
    {}, { response: { header: {}, body: {} } },
    { response: { header: { resultCode: "30", resultMsg: "secret echoed by upstream" } } },
    envelope({ item: [vehicle, null] }, 2),
    envelope({ item: { ...vehicle, nodeord: "bad" } }),
    envelope({ item: { ...vehicle, vehicleno: "" } }),
    envelope("", 1),
    envelope({ item: vehicle }, 2, 2),
  ]) await assert.rejects(providerFor(payload).vehicles(route), ProviderResponseError);
});

test("does not leak keys, URLs or upstream error bodies through failures", async () => {
  const secret = "synthetic+private/key=";
  const calls: (typeof fetch)[] = [
    async input => { throw new Error(String(input)); },
    async () => new Response(secret, { status: 403 }),
    async () => new Response(`<error>${secret}</error>`),
    async () => reply({ response: { header: { resultCode: secret, resultMsg: secret } } }),
  ];
  for (const fetchImplementation of calls) {
    const provider = new TagoTransitProvider({ serviceKey: secret, fetchImplementation });
    await assert.rejects(provider.vehicles(route), error => {
      assert.ok(error instanceof ProviderResponseError);
      assert.equal(String(error).includes(secret), false);
      assert.equal(String(error).includes(encodeURIComponent(secret)), false);
      assert.equal(String(error).includes("serviceKey="), false);
      return true;
    });
  }
});
