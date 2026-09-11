import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

test("HTTP pilot discovers official IDs and accepts route-code aliases in TAGO mode", async () => {
  const realFetch = globalThis.fetch;
  process.env.NODE_ENV = "test";
  process.env.TRANSIT_PROVIDER = "tago";
  process.env.PUBLIC_DATA_SERVICE_KEY = "synthetic-server-key";
  const upstreamRequests: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    upstreamRequests.push(url);
    let item: object;
    if (url.pathname.endsWith("getCtyCodeList")) item = { citycode: 999, cityname: "Synthetic city" };
    else if (url.pathname.endsWith("getRouteNoList")) item = { routeid: "SYNTHETIC_R", routeno: "365" };
    else if (url.pathname.endsWith("getRouteAcctoThrghSttnList")) item = { nodeid: "SYNTHETIC_S", nodenm: "Synthetic stop", nodeord: 1 };
    else throw new Error("unexpected operation");
    return new Response(JSON.stringify({ response: { header: { resultCode: "00" }, body: { totalCount: 1, pageNo: 1, items: { item } } } }));
  };
  const { server } = await import("../src/server.ts");
  globalThis.fetch = realFetch;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const cities = await (await realFetch(base + "/v1/cities")).json();
    assert.deepEqual(cities.items, [{ cityCode: "999", name: "Synthetic city" }]);
    const routes = await (await realFetch(base + "/v1/routes?cityCode=999&routeNo=365")).json();
    assert.equal(routes.items[0].routeId, "SYNTHETIC_R");
    const stops = await realFetch(base + "/v1/stops?cityCode=999&routeId=SYNTHETIC_R");
    assert.equal(stops.status, 200);
    assert.equal((await stops.json()).items[0].stopId, "SYNTHETIC_S");
    const legacy = await realFetch(base + "/v1/stops?stdgCd=999&routeId=SYNTHETIC_R");
    assert.equal(legacy.status, 200);
    const regionAlias = await realFetch(base + "/v1/stops?regionCode=999&routeId=SYNTHETIC_R");
    assert.equal(regionAlias.status, 200);
    const missingRoute = await realFetch(base + "/v1/routes?cityCode=999");
    assert.equal(missingRoute.status, 400);
    assert.equal(upstreamRequests.length, 3);
    assert.equal(upstreamRequests[2].searchParams.get("cityCode"), "999");
    assert.equal(upstreamRequests[2].searchParams.get("routeId"), "SYNTHETIC_R");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    delete process.env.PUBLIC_DATA_SERVICE_KEY;
    delete process.env.TRANSIT_PROVIDER;
  }
});
