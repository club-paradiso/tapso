import { randomUUID } from "node:crypto";

import { UpstashCaptureJournal } from "./captureJournal.ts";
import { upstashCommand } from "./upstashRest.ts";

const confirmed = process.argv.includes("--yes");
if (!confirmed) {
  console.error("REFUSED: pass --yes to run the live capture-journal verification");
  process.exit(2);
}

const restUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
const restToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
if (!restUrl || !restToken) {
  console.error("REFUSED: live Upstash credentials are not configured");
  process.exit(2);
}
if (!restUrl.startsWith("https://")) {
  console.error("REFUSED: Upstash REST URL must use HTTPS");
  process.exit(2);
}

const runId = randomUUID();
const prefix = `tapso:verify:capture-journal:${runId}:`;
const sessionId = `verify-${randomUUID()}`;
const ownerA = `owner-a-${randomUUID()}`;
const ownerB = `owner-b-${randomUUID()}`;

const connection = { restUrl, restToken };
const journal = new UpstashCaptureJournal(connection, prefix);

const openKey = `${prefix}journals:open`;
const journalKey = (part: string) => `${prefix}journal:${sessionId}:${part}`;
const exactKeys = [
  journalKey("header"),
  journalKey("state"),
  journalKey("snapshots"),
  journalKey("markers"),
  journalKey("events"),
  journalKey("lease"),
  journalKey("lease-check"),
];

const command = (parts: string[]) =>
  upstashCommand(connection, parts, "the live journal verifier", () => new Error("live journal verification command failed"));

const checks: Array<{ name: string; ok: boolean }> = [];
const check = (name: string, ok: unknown) => {
  const passed = ok === true;
  checks.push({ name, ok: passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) throw new Error(name);
};

const syntheticHeader = {
  capture: {
    schemaVersion: 1,
    routeId: "VERIFY_ROUTE",
    cityCode: "00",
    boardingStopSequence: 1,
    destinationStopSequence: 2,
    startedAt: "2026-01-01T00:00:00.000Z",
    configuredIntervalSeconds: 5,
    notes: ["synthetic live capture-journal verification"],
    captureEngine: "railway-background",
  },
  mode: "field",
  destinationKnown: true,
} as any;

const firstSnapshot = {
  capturedAt: "2026-01-01T00:00:00.000Z",
  vehicles: [],
} as any;

let cleanupOk = false;
try {
  await journal.begin(sessionId, ownerA, syntheticHeader, {
    state: { phase: "active" },
    snapshots: [firstSnapshot],
    markers: [],
    events: [],
  });

  check("begin opens exactly this synthetic journal", (await journal.listOpen()).length === 1 && (await journal.listOpen())[0] === sessionId);

  const opened = await journal.load(sessionId);
  check(
    "begin/load round-trip preserves header, state and first snapshot",
    opened?.header.capture.routeId === "VERIFY_ROUTE" &&
      opened.state.phase === "active" &&
      opened.snapshots.length === 1 &&
      opened.markers.length === 0 &&
      opened.events.length === 0,
  );

  check(
    "same owner fenced append succeeds",
    await journal.append(sessionId, ownerA, "snapshots", {
      capturedAt: "2026-01-01T00:00:05.000Z",
      vehicles: [],
    }),
  );

  check(
    "same owner fenced state write succeeds",
    await journal.setState(sessionId, ownerA, { phase: "post_alight", alightedAtMs: 5_000 }),
  );

  const afterOwnerWrite = await journal.load(sessionId);
  check(
    "same owner writes are durable",
    afterOwnerWrite?.snapshots.length === 2 &&
      afterOwnerWrite.state.phase === "post_alight" &&
      afterOwnerWrite.state.alightedAtMs === 5_000,
  );

  check("different owner cannot acquire a live lease", !(await journal.acquire(sessionId, ownerB)));
  check(
    "different owner append is fenced out",
    !(await journal.append(sessionId, ownerB, "events", {
      at: "2026-01-01T00:00:06.000Z",
      kind: "synthetic-foreign-owner",
    })),
  );
  check(
    "different owner state write is fenced out",
    !(await journal.setState(sessionId, ownerB, { phase: "completed", endedAt: "2026-01-01T00:00:06.000Z" })),
  );

  const afterForeignWrite = await journal.load(sessionId);
  check(
    "fenced-out owner changed no evidence or phase",
    afterForeignWrite?.events.length === 0 && afterForeignWrite.state.phase === "post_alight",
  );

  check("same owner can reacquire/renew its lease", await journal.acquire(sessionId, ownerA));

  const ttl = Number(await command(["TTL", journalKey("lease")]));
  check("lease has a real positive Redis TTL", Number.isFinite(ttl) && ttl > 0 && ttl <= 30);

  await command(["DEL", journalKey("lease")]);
  check(
    "writer re-takes an absent/lapsed lease through the exact Lua path",
    await journal.append(sessionId, ownerA, "events", {
      at: "2026-01-01T00:00:07.000Z",
      kind: "synthetic-resume",
    }),
  );

  const renewedOwner = await command(["GET", journalKey("lease")]);
  check("Lua re-take restores the expected owner", renewedOwner === ownerA);

  await journal.close(sessionId);
  check("close removes the journal from the open set", (await journal.listOpen()).length === 0);
  check("close removes the readable journal", (await journal.load(sessionId)) === undefined);

  const remaining = Number(await command(["EXISTS", ...exactKeys]));
  check("close removes every exact evidence/lease key", remaining === 0);
} catch {
  // The individual failing check was already printed. Keep error output
  // credential-free and let the non-zero exit code carry failure to Railway.
} finally {
  try {
    await command(["SREM", openKey, sessionId]);
    await command(["DEL", ...exactKeys]);
    const [openCount, keyCount] = await Promise.all([
      command(["SCARD", openKey]),
      command(["EXISTS", ...exactKeys]),
    ]);
    cleanupOk = Number(openCount) === 0 && Number(keyCount) === 0;
  } catch {
    cleanupOk = false;
  }
  console.log(`${cleanupOk ? "PASS" : "FAIL"} cleanup removed all synthetic verification data`);
}

const allPassed = cleanupOk && checks.length === 16 && checks.every((entry) => entry.ok);
console.log(allPassed ? "RESULT PASS 16/16" : `RESULT FAIL ${checks.filter((entry) => entry.ok).length}/16`);
process.exit(allPassed ? 0 : 1);
