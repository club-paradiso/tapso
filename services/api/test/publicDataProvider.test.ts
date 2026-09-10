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

test("loads route master records without guessing a route id", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/B551982/rte/mst_info");
    assert.equal(url.searchParams.get("stdgCd"), "50110");
    assert.equal(url.searchParams.get("rteId"), null);
    return new Response(JSON.stringify({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: { items: { item: [{
        rteId: "OFFICIAL-365", rteNo: "365", rteTpNm: "간선",
        stStaNm: "제주한라대학교", edStaNm: "제주대학교",
        fstTm: "0600", lstTm: "2200",
      }] } },
    }), { status: 200 });
  };

  const provider = new PublicDataUltraPrecisionProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  assert.deepEqual(await provider.routeMasters("50110"), [{
    routeId: "OFFICIAL-365",
    routeNumber: "365",
    routeType: "간선",
    originName: "제주한라대학교",
    destinationName: "제주대학교",
    firstDepartureTime: "0600",
    lastDepartureTime: "2200",
  }]);
});

test("normalizes an official-schema realtime item in the legacy nested envelope", async () => {
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

test("normalizes route-stop identity and sequence from the live top-level envelope", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
    body: { items: { item: [{
      sttnId: "STOP-1", sttnNm: "제주버스터미널", sttnSeq: "7", lat: "33.499", lot: "126.531",
    }] } },
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

test("treats K3 NODATA_ERROR as an empty provider result", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    header: { resultCode: "K3", resultMsg: "NODATA_ERROR" },
    body: { totalCount: 0, pageNo: 0, numOfRows: 0 },
  }), { status: 200 });
  const provider = new PublicDataUltraPrecisionProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });

  assert.deepEqual(
    await provider.stops({ routeId: "TEST", standardRegionCode: "50110" }),
    [],
  );
  assert.deepEqual(
    await provider.vehicles({ routeId: "TEST", standardRegionCode: "50110" }),
    [],
  );
});

test("surfaces top-level provider error codes instead of hiding the gateway response", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    header: { resultCode: "30", resultMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" },
    body: {},
  }), { status: 200 });
  const provider = new PublicDataUltraPrecisionProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });

  await assert.rejects(
    provider.vehicles({ routeId: "route-201", standardRegionCode: "50110" }),
    /Transit provider error 30: SERVICE_KEY_IS_NOT_REGISTERED_ERROR/,
  );
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
