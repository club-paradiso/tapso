# Device validation evidence

Physical-iPhone results for `docs/DEVICE_TEST_PLAN.md` §"Beta field protocol". The free-team pilot follows
`docs/beta/FREE_TEAM_FIELD_TEST.md`.

- One file per case and session: `<YYYY-MM-DD>-<case>.md` (for example `2026-10-21-R-2.md`), from `TEMPLATE.md`.
- Release gates read only two prefixes: `live-activity-push-<date>.md` (B-7/B-8, gate 5) and `hybrid-<date>.md`
  (gate 4). Do not use those prefixes for anything else.
- Sanitize before committing:
  - plates show at most the last four digits, masked as `••1234`;
  - no faces, phone numbers, names or tokens;
  - no coordinates or location history;
  - screen recordings stay out of Git; the file says where they are kept.
- A case passes only from what was seen on the phone. A simulator run, a CI screenshot or "the code handles it" is
  never a pass.
