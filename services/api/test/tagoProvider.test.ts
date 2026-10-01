import test from "node:test";
import assert from "node:assert/strict";
import { TagoTransitProvider } from "../src/tagoProvider.ts";
import {
  ProviderConfigurationError,
  ProviderResponseError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from "../src/provider.ts";

/**
 * Synthetic test fixtures, not observations: every provider response below is
 * constructed by the test, and nothing here is evidence that a bus was seen.
 * Values that look real (public TAGO route and stop ids, stop names and
 * coordinates, and vehicle numbers carried over from earlier fixtures) are
 * used only as inputs.
 */

test("requires credentials before making a TAGO request", async () => {
  const provider = new TagoTransitProvider({ serviceKey: "" });
  await assert.rejects(
    provider.vehicles({ routeId: "JEB405136521", cityCode: "39" }),
    ProviderConfigurationError,
  );
});

test("discovers official TAGO city and route IDs", async () => {
  const paths: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname.endsWith("getCtyCodeList")) {
      return new Response(JSON.stringify({ response: {
        header: { resultCode: "00" },
        body: { items: { item: { citycode: 39, cityname: "제주도" } } },
      } }));
    }
    return new Response(JSON.stringify({ response: {
      header: { resultCode: "00" },
      body: { totalCount: 1, pageNo: 1, items: { item: {
        routeid: "JEB405136521", routeno: 365,
        startnodenm: "제주대학교", endnodenm: "제주한라대학교(종점)",
      } } },
    } }));
  };
  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  assert.deepEqual(await provider.cities(), [{ cityCode: "39", name: "제주도" }]);
  assert.deepEqual(await provider.routes("39", "365"), [{
    routeId: "JEB405136521",
    routeNumber: "365",
    startStopName: "제주대학교",
    endStopName: "제주한라대학교(종점)",
  }]);
  assert.equal(paths[0].endsWith("getCtyCodeList"), true);
  assert.equal(paths[1].endsWith("getRouteNoList"), true);
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
          pageNo: 1,
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
  const stops = await provider.stops({ routeId: "JEB405136521", cityCode: "39" });

  assert.equal(requestedURL?.pathname.endsWith("/BusRouteInfoInqireService/getRouteAcctoThrghSttnList"), true);
  assert.equal(requestedURL?.searchParams.get("cityCode"), "39");
  assert.equal(requestedURL?.searchParams.get("routeId"), "JEB405136521");
  assert.deepEqual(stops, [{
    stopId: "JEB405002038",
    name: "고산동산",
    sequence: 15,
    directionCode: undefined,
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
          pageNo: 1,
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
  const vehicles = await provider.vehicles({ routeId: "JEB405136521", cityCode: "39" });

  assert.equal(requestedURL?.pathname.endsWith("/BusLcInfoInqireService/getRouteAcctoBusLcList"), true);
  assert.equal(requestedURL?.searchParams.get("cityCode"), "39");
  assert.equal(requestedURL?.searchParams.get("routeId"), "JEB405136521");
  assert.deepEqual(vehicles, [{
    vehicleId: "70자1234",
    routeId: "JEB405136521",
    observedAt: "1970-01-01T00:00:00.000Z",
    receivedAt: "2026-09-10T08:10:00.000Z",
    timestampSource: "unavailable",
    stopId: "JEB405000315",
    stopName: "용문사거리[서]",
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
    await provider.vehicles({ routeId: "JEB405136524", cityCode: "39" }),
    [],
  );
});

test("retries one transient malformed TAGO envelope before failing the request", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE." } },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: { totalCount: 0, items: "" },
      },
    }), { status: 200 });
  };
  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  assert.deepEqual(
    await provider.vehicles({ routeId: "JEB405130206", cityCode: "39" }),
    [],
  );
  assert.equal(calls, 2);
});

test("retries one transient TAGO HTTP 5xx response", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("temporary", { status: 502 });
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: { totalCount: 0, items: "" },
      },
    }), { status: 200 });
  };
  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  assert.deepEqual(
    await provider.vehicles({ routeId: "JEB405130206", cityCode: "39" }),
    [],
  );
  assert.equal(calls, 2);
});

test("redacts TAGO provider messages", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "99", resultMsg: "가용한 세션이 존재하지 않습니다. (30/30)" },
        body: {},
      },
    }), { status: 200 });
  };
  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  await assert.rejects(
    provider.vehicles({ routeId: "JEB405136521", cityCode: "39" }),
    (error: Error) => {
      assert.match(error.message, /^TAGO provider error 99$/);
      assert.doesNotMatch(error.message, /세션/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("rejects a TAGO response without a result code", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    response: {
      header: { resultMsg: "NORMAL SERVICE." },
      body: { totalCount: 0, items: "" },
    },
  }), { status: 200 });
  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  await assert.rejects(
    provider.vehicles({ routeId: "JEB405136521", cityCode: "39" }),
    /TAGO resultCode is missing/,
  );
});

/*
 * Reliability taxonomy (Product V3, section 37): a timeout, an unreachable or
 * erroring provider and a malformed answer are three different situations for
 * a rider, and none of them is "no bus". Each stays a ProviderResponseError so
 * every existing failure path (session degradation, collectors) still catches
 * it.
 */

test("a TAGO request that times out twice is PROVIDER_TIMEOUT, never 'no bus'", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  await assert.rejects(
    provider.vehicles({ routeId: "JEB405136521", cityCode: "39" }),
    (error: Error) => {
      assert.ok(error instanceof ProviderTimeoutError);
      assert.ok(error instanceof ProviderResponseError, "existing catch paths still see a provider failure");
      assert.equal((error as ProviderTimeoutError).code, "PROVIDER_TIMEOUT");
      assert.match(error.message, /^TAGO request timed out$/);
      return true;
    },
  );
  assert.equal(calls, 2, "a timeout is transient and retried once");
});

test("a TAGO transport failure is PROVIDER_UNAVAILABLE", async () => {
  const fakeFetch: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const provider = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: fakeFetch });
  await assert.rejects(
    provider.stops({ routeId: "JEB405136521", cityCode: "39" }),
    (error: Error) => {
      assert.ok(error instanceof ProviderUnavailableError);
      assert.equal((error as ProviderUnavailableError).code, "PROVIDER_UNAVAILABLE");
      return true;
    },
  );
});

test("a TAGO HTTP error that persists is PROVIDER_UNAVAILABLE, a malformed body is PROVIDER_RESPONSE_INVALID", async () => {
  const httpError: typeof fetch = async () => new Response("down", { status: 503 });
  const unavailable = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: httpError });
  await assert.rejects(
    unavailable.vehicles({ routeId: "JEB405136521", cityCode: "39" }),
    (error: Error) => (error as ProviderUnavailableError).code === "PROVIDER_UNAVAILABLE",
  );

  const malformed: typeof fetch = async () => new Response(JSON.stringify({ response: { header: { resultCode: "00" } } }));
  const invalid = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: malformed });
  await assert.rejects(
    invalid.vehicles({ routeId: "JEB405136521", cityCode: "39" }),
    (error: Error) => {
      assert.equal(error.constructor, ProviderResponseError);
      assert.equal((error as ProviderResponseError).code, "PROVIDER_RESPONSE_INVALID");
      return true;
    },
  );
});

/**
 * `getRouteInfoIem` in the shape data.go.kr documents for dataset 15098529
 * (REPORTED-OFFICIAL). SYNTHETIC values; route ids reuse the earlier fixtures.
 */
function routeInfoFetch(item: Record<string, unknown> | undefined, seen: URL[] = []): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    seen.push(url);
    return new Response(JSON.stringify({ response: {
      header: { resultCode: "00", resultMsg: "OK" },
      body: { items: item === undefined ? "" : { item } },
    } }));
  };
}

test("reads a route's published service day: first and last departure from the starting stop, and headways", async () => {
  const seen: URL[] = [];
  const provider = new TagoTransitProvider({
    serviceKey: "test-key",
    fetchImplementation: routeInfoFetch({
      routeid: "JEB405136521", routeno: 365, routetp: "간선버스",
      startnodenm: "제주대학교", endnodenm: "제주한라대학교(종점)",
      startvehicletime: "0600", endvehicletime: "2230",
      intervaltime: 29, intervalsattime: "23", intervalsuntime: 29,
    }, seen),
  });
  assert.deepEqual(await provider.routeServiceHours("39", "JEB405136521"), {
    routeId: "JEB405136521",
    routeNumber: "365",
    routeType: "간선버스",
    startStopName: "제주대학교",
    endStopName: "제주한라대학교(종점)",
    firstDeparture: "06:00",
    lastDeparture: "22:30",
    headwayMinutes: { weekday: 29, saturday: 23, sunday: 29 },
  });
  const url = seen[0]!;
  assert.ok(url.pathname.endsWith("/BusRouteInfoInqireService/getRouteInfoIem"));
  assert.equal(url.searchParams.get("cityCode"), "39");
  assert.equal(url.searchParams.get("routeId"), "JEB405136521");
  assert.equal(url.searchParams.get("pageNo"), null, "the operation is not paged");
});

test("service hours stay absent when TAGO leaves them out or sends what it does not document", async () => {
  const read = (item: Record<string, unknown>) =>
    new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: routeInfoFetch({ routeid: "R1", ...item }) })
      .routeServiceHours("39", "R1");

  assert.deepEqual(await read({}), { routeId: "R1", headwayMinutes: {} }, "every field is optional");
  // A number loses its leading zero in JSON; it is still HHMM.
  assert.equal((await read({ startvehicletime: 600, endvehicletime: 30 }))?.firstDeparture, "06:00");
  assert.equal((await read({ endvehicletime: 30 }))?.lastDeparture, "00:30");
  for (const time of ["2510", "2460", "1260", "6:00", "06:00", "", "abc", 12345]) {
    assert.equal((await read({ endvehicletime: time }))?.lastDeparture, undefined, `${time} is not a documented HHMM`);
  }
  for (const interval of [0, -5, "0", "x", 1441, 12.5]) {
    assert.deepEqual((await read({ intervaltime: interval }))?.headwayMinutes, {}, `${interval} is not a headway`);
  }
});

test("a route TAGO does not know has no service day", async () => {
  const empty = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: routeInfoFetch(undefined) });
  assert.equal(await empty.routeServiceHours("39", "R1"), undefined);
  const other = new TagoTransitProvider({ serviceKey: "test-key", fetchImplementation: routeInfoFetch({ routeid: "R2", endvehicletime: "2200" }) });
  assert.equal(await other.routeServiceHours("39", "R1"), undefined, "another route's hours are never borrowed");
});
