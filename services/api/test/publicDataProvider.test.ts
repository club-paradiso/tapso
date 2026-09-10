import test from "node:test";
import assert from "node:assert/strict";
import { PublicDataUltraPrecisionProvider } from "../src/publicDataProvider.ts";
import { ProviderConfigurationError, ProviderResponseError } from "../src/provider.ts";

test("requires credentials before making a live request", async () => {
  const provider = new PublicDataUltraPrecisionProvider({ serviceKey: "" });
  await assert.rejects(
    provider.vehicles({ routeId: "route-201", standardRegionCode: "50110" }),
    ProviderConfigurationError,
  );
});

test("normalizes an official-schema realtime item", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: { items: { item: [{
        vhclNo: "JEJU-123", rteId: "route-201", gthrDt: "20260820120000",
        lat: "33.499", lot: "126.531", oprDrct: "1", oprSpd: "31", agdr: "182.5",
        evtCd: "1", rcvType: "GNSS",
      }] } },
    },
  }), { status: 200 });
  const provider = new PublicDataUltraPrecisionProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  const vehicles = await provider.vehicles({ routeId: "route-201", standardRegionCode: "50110" });
  assert.equal(vehicles[0].vehicleId, "JEJU-123");
  assert.equal(vehicles[0].latitude, 33.499);
  assert.equal(vehicles[0].headingDegrees, 182.5);
  assert.equal(vehicles[0].receiveType, "GNSS");
  assert.equal(vehicles[0].observedAt, "2026-08-20T12:00:00+09:00");
});

test("normalizes route-stop identity and sequence without inventing required fields", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    response: {
      header: { resultCode: "00" },
      body: { items: { item: [{
        sttnId: "STOP-1", sttnNm: "제주버스터미널", sttnSeq: "7", lat: "33.499", lot: "126.531",
      }] } },
    },
  }), { status: 200 });
  const provider = new PublicDataUltraPrecisionProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  const stops = await provider.stops({ routeId: "route-201", standardRegionCode: "50110" });
  assert.deepEqual(stops[0], {
    stopId: "STOP-1",
    name: "제주버스터미널",
    sequence: 7,
    directionCode: undefined,
    latitude: 33.499,
    longitude: 126.531,
  });
});

test("fails closed when a route-stop response omits required identity", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    response: { header: { resultCode: "00" }, body: { items: { item: [{ sttnSeq: "1" }] } } },
  }), { status: 200 });
  const provider = new PublicDataUltraPrecisionProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  await assert.rejects(
    provider.stops({ routeId: "route-201", standardRegionCode: "50110" }),
    ProviderResponseError,
  );
});
