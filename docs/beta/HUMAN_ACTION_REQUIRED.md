# Human actions required for beta

Only steps that need the owner's own account, money, hardware or legal authority. Each lists what to do, why,
where, the evidence of completion that contains no secret, and the check to run afterwards. Never paste a private
key, token or password into a GitHub comment, issue, PR or chat.

Status as of 2026-10-20. ⛔ blocks the pilot; 🟠 blocks TestFlight; 🟡 before external testers.

## 1. ⛔ Decide PR #145

- **What:** close #145 once PR #146 is merged, or tell Claude to keep it open.
- **Why:** #145 would revert the reliability work of #138–#144 (see `docs/exec-plans/TAPSO_BETA_READINESS.md` §2).
  Its additive parts are already in #146.
- **Where:** GitHub, PR #145.
- **Evidence:** #145 is closed, or you have left a comment saying it should stay open.

## 2. ⛔ Field pilot hardware

- **What:** one Dynamic Island iPhone, plus a non-Dynamic Island iPhone if available. Both on iOS 17 or later,
  paired with a Mac that has Xcode.
- **Why:** gates 4 and 5 need device evidence. A simulator cannot ride a bus.
- **Where:** Xcode › Settings › Accounts. A free Personal Team can install a Debug or Beta build directly; the
  provisioning profile lasts 7 days.
- **Evidence:** the build identity line (version, build, git SHA, configuration). It is shown in the feedback
  sheet of a Beta build.
- **Check:** run `docs/DEVICE_TEST_PLAN.md` §"Beta field protocol" and commit results to
  `artifacts/device-validation/`.

## 3. 🟠 Apple Developer Program (paid)

- **What:** enrol, or confirm enrolment, of the account that will own TAPSO.
- **Why:** TestFlight, distribution signing and APNs keys need a paid team. The last recorded team is the free
  `89CGFQ24U5` (2026-08-21).
- **Where:** developer.apple.com/account › Membership.
- **Evidence:** the Team ID (10 characters, not secret) and "Apple Developer Program" shown on the Membership page.
- **Then:** tell Claude the Team ID. Claude updates `DEVELOPMENT_TEAM` in `apps/ios/project.yml` in a PR.

## 4. 🟠 Identifiers and capabilities on the paid team

- **What:** register these App IDs:
  - `com.lucanomics.tapso`, with App Groups and Push Notifications;
  - `com.lucanomics.tapso.LiveActivity`;
  - `com.lucanomics.tapso.Share`, with App Groups.

  Also register the App Group `group.com.lucanomics.tapso`.
- **Why:** the app and the Share extension use the App Group; push-type Live Activities need the Push
  Notifications capability. Keep these IDs, or decide new ones before the first upload: they cannot be renamed.
- **Where:** Certificates, Identifiers & Profiles › Identifiers.
- **Evidence:** a screenshot of the identifier list with capabilities ticked (no keys in it).
- **Then:** Claude adds `aps-environment` to `Tapso.entitlements` in a PR. That is not done yet on purpose: without
  the capability it breaks signing.

## 5. 🟠 APNs authentication key

- **What:** create an APNs key (.p8), with the "Apple Push Notifications service" checkbox.
- **Why:** the server signs Live Activity pushes with it (`services/api/src/apns.ts`).
- **Where:** Certificates, Identifiers & Profiles › Keys. Download the .p8 once and store it in a password manager.
- **Then:** in Vercel › project `tapso-api` › Settings › Environment Variables (Production), set:

  | Variable | Value |
  |---|---|
  | `APNS_TEAM_ID` | Team ID |
  | `APNS_KEY_ID` | Key ID |
  | `APNS_BUNDLE_ID` | `com.lucanomics.tapso` |
  | `APNS_ENVIRONMENT` | `development` for Xcode-installed builds; `production` for TestFlight |
  | `APNS_PRIVATE_KEY` | the PEM text of the .p8 |

  Redeploy.
- **Evidence:** `GET https://tapso-api.vercel.app/health` shows `"liveActivityPush":{"enabled":true,...}`, and
  the Railway collector's log line `live_activity_ticker` no longer says `push_unavailable`.
- **Check:** `docs/DEVICE_TEST_PLAN.md` case "Lock Screen updates with the app closed".

## 6. 🟠 App Store Connect record and TestFlight

- **What:**
  - create the app record (bundle `com.lucanomics.tapso`, SKU `tapso-ios-2026`);
  - accept the Paid Apps agreement if prompted;
  - add internal testers.
- **Why:** this is where internal TestFlight distribution happens.
- **Where:** appstoreconnect.apple.com › Apps, and Users and Access.
- **Evidence:** the app record exists, and a build uploaded with Xcode › Product › Archive (Beta configuration)
  shows "Ready to Test".
- **Fill in from `docs/TESTFLIGHT.md`:** beta description, "What to Test", privacy policy URL and support
  contact (step 7).

## 7. 🟡 Privacy policy URL and support contact

- **What:** publish the policy (`docs/PRIVACY.md` is the source) at a stable URL, and choose a support email.
- **Why:** both are required for external TestFlight. The URL in `docs/TESTFLIGHT.md` points at a repository
  path that does not exist (`lucanomics/tapso`).
- **Evidence:** the URL opens without signing in.

## 8. 🟡 Native review of Chinese and Japanese

- **What:** a native speaker of each language reviews:
  - `apps/ios/Resources/zh-Hans.lproj/Localizable.strings`;
  - `apps/ios/Resources/ja.lproj/Localizable.strings`;
  - the guide texts in `packages/transit-core/Sources/TapsoTransit/TouristStopGuides.swift`.
- **Why:** they are machine-translated; external testers are the first real readers.
- **Evidence:** a PR or issue with the reviewer's corrections; then change the file header comment.

## 9. 🟡 Upstash settings

- **What:** confirm that eviction is off on the production Redis database.
- **Why:** with eviction on, Redis can silently drop sessions or feedback under memory pressure.
- **Where:** Upstash console › database › Configuration.
- **Evidence:** a screenshot of the setting.

## 10. Optional: let Claude's environment reach the API

- **What:** add `tapso-api.vercel.app` and `tapso-nu.vercel.app` to Allowed domains in the cloud environment's
  Network access settings.
- **Why:** it lets future sessions run `services/api/scripts/smoke.ts` against production directly. Today that
  check runs only in GitHub Actions.
