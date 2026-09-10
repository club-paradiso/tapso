import test from "node:test";
import assert from "node:assert/strict";
import { TagoTransitProvider } from "../src/tagoProvider.ts";
import { ProviderConfigurationError } from "../src/provider.ts";

test("requires credentials before making a TAGO request", async () => {
  const provider = new TagoTransitProvider({ serviceKey: "" });
  await assert.rejects(
    provider.vehicles({ routeId: "JEB405136521", standardRegionCode: "39" }),
    ProviderConfigurationError,
  );
});

test("normalizes verified Jeju TAGO route stops", async () => {
  let requestedURL: URL | undefined;
  const fakeFetch: typeof fetch = async (input) => {
    requestedURL = new URL(String(input));
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: {
          totalCount: 1,
          items: { item: [{
            gpslati: 33.49546,
            gpslong: 126.532944,
            nodeid: "JEB405002038",
            nodenm: "고산동산",
            nodeord: 15,
            routeid: "JEB405136521",
          }] },
        },
      },
    }), { status: 200 });
  };

  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  const stops = await provider.stops({ routeId: "JEB405136521", standardRegionCode: "39" });

  assert.equal(requestedURL?.pathname.endsWith("/BusRouteInfoInqireService/getRouteAcctoThrghSttnList"), true);
  assert.equal(requestedURL?.searchParams.get("cityCode"), "39");
  assert.equal(requestedURL?.searchParams.get("routeId"), "JEB405136521");
  assert.deepEqual(stops, [{
    stopId: "JEB405002038",
    name: "고산동산",
    sequence: 15,
    latitude: 33.49546,
    longitude: 126.532944,
  }]);
});

test("normalizes the verified Jeju TAGO live-location schema", async () => {
  let requestedURL: URL | undefined;
  const fakeFetch: typeof fetch = async (input) => {
    requestedURL = new URL(String(input));
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: {
          totalCount: 1,
          items: { item: [{
            gpslati: 33.50872,
            gpslong: 126.510128,
            nodeid: "JEB405000315",
            nodenm: "용문사거리[서]",
            nodeord: 23,
            routenm: 365,
            routetp: "급행버스",
            vehicleno: "70자1234",
          }] },
        },
      },
    }), { status: 200 });
  };

  const provider = new TagoTransitProvider({
    serviceKey: "test-key",
    fetchImplementation: fakeFetch,
    now: () => new Date("2026-09-10T08:10:00.000Z"),
  });
  const vehicles = await provider.vehicles({ routeId: "JEB405136521", standardRegionCode: "39" });

  assert.equal(requestedURL?.pathname.endsWith("/BusLcInfoInqireService/getRouteAcctoBusLcList"), true);
  assert.equal(requestedURL?.searchParams.get("cityCode"), "39");
  assert.equal(requestedURL?.searchParams.get("routeId"), "JEB405136521");
  assert.deepEqual(vehicles, [{
    vehicleId: "70자1234",
    routeId: "JEB405136521",
    observedAt: "2026-09-10T08:10:00.000Z",
    stopSequence: 23,
    latitude: 33.50872,
    longitude: 126.510128,
    receiveType: "TAGO_SNAPSHOT",
  }]);
});

test("treats a normal zero-count TAGO response as an empty snapshot", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: { totalCount: 0, items: "" },
    },
  }), { status: 200 });
  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  assert.deepEqual(
    await provider.vehicles({ routeId: "JEB405136524", standardRegionCode: "39" }),
    [],
  );
});

test("surfaces TAGO session-pool and provider errors", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    response: {
      header: { resultCode: "99", resultMsg: "가용한 세션이 존재하지 않습니다. (30/30)" },
      body: {},
    },
  }), { status: 200 });
  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  await assert.rejects(
    provider.vehicles({ routeId: "JEB405136521", standardRegionCode: "39" }),
    /TAGO provider error 99: 가용한 세션이 존재하지 않습니다/,
  );
});
