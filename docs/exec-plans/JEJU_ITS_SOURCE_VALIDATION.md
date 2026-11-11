# Jeju ITS source validation

## Outcome

Establish which official Jeju feeds can support advisory route context. Keep the provider audit and response validation offline until the data is safe to publish. The live journey path keeps using TAGO and the existing vehicle matching policy.

## Milestones

1. **Completed, metadata and access.** Resolve official links and compare the provider contracts with unauthenticated network results. See [the dated audit](../audits/JEJU_OPEN_DATA_2026-11-11.md).
2. **Completed, offline contract.** Validate the documented real-time and hourly JSON envelopes, normalize fields, count duplicates, and keep the source processing time distinct from the observation and receipt times. Exercise success and rejection with synthetic data in the API test suite.
3. **Partial, pilot.** Read production TAPSO variant discovery for 365, 202, and 800 and compare the ordered TAGO stops for one variant each with the bundled catalog. Confirm direction-specific route shapes and authoritative road-link geometry before evaluating overlap.
4. **Blocked, production input.** Obtain provider-approved, secure ITS/C-ITS access and observe multiple successful samples. Verify transport, schema, observation timing and cadence, link coverage, request allowance, and event expiry. The schema tool alone cannot certify any live payload.
5. **Pending, product.** With proven coverage, test the advisory service separately from active rides. Add historical speed baselines only where comparable weekday/time observations support them. Review how the existing application can show the result without changing alert priority.

## Decisions and reproduction

The operation spelling and parameter names follow the provider's published details. The web example uses `Info`, and its common metadata conflicts with the DOCX. Treat case changes, null sentinels, and timezone as live-validation questions. The offline tool reports the documented source timestamp but cannot infer freshness. A provider result must be independently observed before a client consumes it.

Run the commands in the audit and the repository's standard API tests. For the next authorized sample, capture the retrieval time separately, run the offline validator, and compare with the official clock semantics before adding a request path. If the provider cannot supply an authenticated secure route, confirm an alternate officially supported source with equivalent link IDs and provenance.
