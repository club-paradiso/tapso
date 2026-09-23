/**
 * Pull every submitted raw capture back out of durable storage, so the whole
 * campaign can be replayed under whatever matcher `main` has today:
 *
 *   env -u UPSTASH_REDIS_REST_TOKEN node --env-file=.env.local --experimental-strip-types \
 *     scripts/field-validation/pull-campaign.ts --yes
 *   node --experimental-strip-types scripts/ride-capture/batch-analyze.ts work/field-validation/pulled
 *
 * Read-only against the store: it sends GET, SMEMBERS and MGET only. Raw
 * captures hold vehicle numbers and coordinates, so they are written only under
 * ignored `work/field-validation/pulled/`, one `<routeId>-<startedAt>.json` per
 * submission. Nothing is printed but counts. Each file's checksum is verified
 * against the hash recorded at submission.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readUpstashCredentials } from "../../services/api/src/apiConfig.ts";
import {
  FIELD_VALIDATION_CAMPAIGN_ID,
  loadStoredRaw,
  UpstashFieldValidationStore,
} from "../../services/api/src/fieldValidation.ts";

if (!process.argv.includes("--yes")) {
  console.error("Usage: node --experimental-strip-types scripts/field-validation/pull-campaign.ts --yes [--campaign=<id>]");
  process.exit(2);
}
const campaignFlag = process.argv.find((arg) => arg.startsWith("--campaign="));
const campaignId = campaignFlag ? campaignFlag.slice("--campaign=".length) : FIELD_VALIDATION_CAMPAIGN_ID;

const credentials = readUpstashCredentials(process.env);
if (!credentials) {
  console.error("FAIL  UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are both required");
  process.exit(1);
}

const store = new UpstashFieldValidationStore(credentials);
const out = path.resolve("work/field-validation/pulled");
await mkdir(out, { recursive: true });

const records = await store.listCampaign(campaignId);
let written = 0;
for (const record of records) {
  const raw = await loadStoredRaw(store, record.id);
  if (!raw) {
    console.error(`FAIL  submission ${record.id} has no stored raw capture`);
    continue;
  }
  const stem = `${raw.routeId.replace(/[^A-Za-z0-9_-]/g, "_")}-${raw.startedAt.replace(/[:.]/g, "-")}`;
  await writeFile(path.join(out, `${stem}.json`), JSON.stringify(raw));
  written += 1;
}
console.log(`campaign ${campaignId}: ${records.length} submissions, ${written} raw captures written to work/field-validation/pulled/`);
