# TAPSO — Claude Desktop / Claude Code Ultimate Handoff Prompt

Copy everything from `BEGIN PROMPT` through `END PROMPT` into a new Claude Desktop or Claude Code session. Open the repository folder below as the working folder before starting.

---

## BEGIN PROMPT

> **Note, 2026-09-29.** Some facts below are superseded; where this prompt and the repository disagree, the repository wins. The GitHub repository is `club-paradiso/tapso` (`git remote -v`); the bundle identifiers below are unchanged. The test counts under *Verified build and test state* are historical; CI is the authority on what passes now. Transit and matcher validation state lives in `docs/HANDOFF.md` and `docs/exec-plans/HUMAN_LABOR_ELIMINATION.md`, not here; no readiness level up to `READY_FOR_CONFIRMATION_ASSISTED` needs a bus ride.

You are taking over a real, partially completed production-oriented iOS repository named **TAPSO (탑서)**. Work directly in the existing repository; do not start over, create a replacement app, or merely describe next steps.

### Repository

- Absolute path: `/Users/seonjaekim/Documents/Codex/2026-08-20/new-chat`
- GitHub: `https://github.com/lucanomics/tapso`
- Expected branch at handoff: `main`
- Expected clean HEAD: the latest `main` merge commit; `git log --oneline -6` is the authority
- Existing merged PRs:
  - #1: Dynamic Island primary ride surface
  - #2: Jeju Dynamic Island visual polish
  - #3: TestFlight demo readiness
  - #4: verified TestFlight account blockers
  - #5: Claude Desktop release handoff
  - a follow-up PR resolving the Apple team identity and recording the paid-membership blocker

First run `git status --short --branch`, `git log --oneline -6`, and `git remote -v`. Preserve unrelated user work. For changes, create a branch prefixed with `codex/` or `claude/`, run verification, review the diff and secret exposure, then commit, push, open a PR, wait for CI, and merge only when checks pass and permissions allow.

### Mandatory project guidance

Read these files before modifying code or release settings:

1. `AGENTS.md`
2. `.agent/PLANS.md`
3. `docs/HANDOFF.md`
4. `docs/TESTFLIGHT.md`
5. `docs/KNOWN_ISSUES.md`
6. `docs/DEVICE_TEST_PLAN.md`
7. `docs/exec-plans/INITIAL_BUILD.md`
8. `apps/ios/project.yml`

Treat the active ExecPlan as a living document. Keep documentation truthful and aligned with verified behavior.

### Product goal

TAPSO is an iPhone-first Jeju bus companion. A rider starts a trip, TAPSO matches the physical bus, tracks the vehicle rather than continuously tracking the passenger, and keeps remaining stops visible through ActivityKit, Dynamic Island, and the Lock Screen. Dynamic Island is a primary product surface.

The current user request is to finish the **internal TestFlight demo release**, not to redesign the app again. Preserve the original, cute Jeju visual identity already implemented: basalt buddy, tangerine accents, sea-foam motion, compact remaining-stop gauge, route badge, and the 8 → 2 → 1 → 0 escalation. Do not copy proprietary Jihaseom assets or styling.

### What is already implemented

- Native SwiftUI iOS app, ActivityKit Live Activity, and WidgetKit extension.
- Framework-independent Swift transit core with destination progress, journey state, freshness handling, and explainable vehicle matching.
- Deterministic demo journey through 8 → 0 stops.
- Dynamic Island compact, minimal, expanded, and Lock Screen layouts.
- Fail-closed checking state for inconsistent phase/count/freshness data.
- One-shot 2/1/0 alert policy, duplicate-activity cleanup, and relaunch reattachment.
- TypeScript API/provider/APNs abstractions and deterministic tests.
- Original TAPSO app icon in the asset catalog.
- Release metadata and TestFlight instructions.

Important release values:

- App name: `TAPSO`
- Platform: iOS
- Primary language: Korean
- Version: `0.1.0`
- Build: `1` — increment before retrying an upload that Apple has already received
- App bundle ID: `com.lucanomics.tapso`
- Live Activity extension bundle ID: `com.lucanomics.tapso.LiveActivity`
- SKU: `tapso-ios-demo-2026`
- Privacy URL: `https://github.com/lucanomics/tapso/blob/main/docs/PRIVACY.md`
- `ITSAppUsesNonExemptEncryption = false`
- Automatic signing is enabled.

### Verified build and test state

Before this handoff, the following passed:

- Swift transit-core: 38 tests.
- TypeScript API: 5 tests.
- iOS Simulator suite: 8 tests.
- iPhone 17 Pro Simulator build, install, launch, and visual inspection.
- Unsigned generic-device Release archive.
- GitHub CI on the merged release-readiness and account-blocker PRs.

The last unsigned archive may still exist at:

`/tmp/TapsoTestFlightReadiness-2.xcarchive`

It contains app version `0.1.0 (1)`, the 1024×1024 icon, the app bundle, and the Live Activity extension. It is intentionally unsigned and cannot be uploaded.

Use these verification commands after relevant changes:

```bash
swift test --package-path packages/transit-core
npm --prefix services/api test
xcodegen generate --spec apps/ios/project.yml --project apps/ios
xcodebuild -project apps/ios/Tapso.xcodeproj -scheme Tapso \
  -destination 'platform=iOS Simulator,name=iPhone 17' build test
```

If the exact simulator name is unavailable, discover a valid installed simulator and document the substitution. Because the repository is in a FileProvider-managed location, keep sources downloaded and put DerivedData/archive output under `/tmp`.

### Apple account status — resolved, do not re-litigate

The earlier ambiguity was reconciled on 2026-08-21 using read-only local checks. **Both** the account owner's description and the Apple UI were accurate; they described different things.

Verified facts:

- Xcode holds exactly one Apple ID account, and it resolves to exactly one team: `89CGFQ24U5`, `Luca Kim (Personal Team)`, `teamType = Personal Team`, `isFreeProvisioningTeam = true`.
- The single keychain signing identity is an **Apple Development** certificate with subject `OU=89CGFQ24U5`, `O=Luca Kim`, valid 2026-07-09 → 2027-07-09. There is no Apple Distribution certificate.
- No provisioning profiles are installed.
- The project uses `DEVELOPMENT_TEAM = 89CGFQ24U5`, which is that free Personal Team.

Reproduce without credentials:

```bash
security find-identity -v -p codesigning
plutil -extract IDEProvisioningTeamByIdentifier xml1 -o - \
  ~/Library/Preferences/com.apple.dt.Xcode.plist
```

Interpretation, now settled: the owner does own their Apple ID and its team. That team is simply a **free Personal Team**, not a paid membership. Separately, the same Apple ID holds a `Marketing` seat in another organization with a different Account Holder, which is why App Store Connect showed the owner as the signed-in person while the selected provider carried a different organization name. `Marketing` grants no Certificates, Identifiers & Profiles access, so that organization correctly never appears as a signing team in Xcode.

The blocker is therefore **an absent paid Apple Developer Program membership** — not a wrong account, not a mis-selected provider, and not something further investigation can resolve. A free Personal Team cannot create App Store distribution signing or upload to TestFlight.

Required safe handling:

1. Ask the user to log in themselves when credentials or 2FA are required.
2. Do not accept legal agreements, buy or renew a membership, change account ownership, create API keys, or alter user roles on the user's behalf. Legal and financial acceptance must be performed by the user.
3. Do not create or distribute TAPSO under the other organization unless the user explicitly confirms it is authorized for this product.
4. Never treat the parenthetical code in a certificate display name as the Team ID; read the subject `OU`.
5. Do not overwrite `DEVELOPMENT_TEAM` until a paid Team ID is positively identified. Enrollment produces a Team ID different from `89CGFQ24U5`.

### Immediate objective

Resume from the account/signing boundary and take the work as far as safely possible:

1. Confirm `main` is clean and synced.
2. Re-read the handoff and release docs.
3. Confirm a paid Apple Developer Program team now exists (Option A enrollment by the owner, or Option B an authorized organization role). If neither is in place, stop here — this is the only real gate.
4. Read the verified paid Team ID from Xcode or the Developer Portal without changing project files yet.
5. Confirm the latest Apple Developer Program agreement is accepted for that exact team.
6. Confirm the account has permission to create App IDs, provisioning profiles, app records, and upload builds. Also confirm the build host has several GB of free disk.
7. Register these identifiers under the verified paid team if they do not already exist:
   - `com.lucanomics.tapso`
   - `com.lucanomics.tapso.LiveActivity`
8. Create the App Store Connect app record using the prepared metadata only after showing the final values to the user and receiving action-time confirmation.
9. Create a release branch, update `DEVELOPMENT_TEAM` only if necessary, regenerate the Xcode project, and review the diff.
10. Produce a signed App Store archive and run Apple's validation.
11. Upload build `0.1.0 (1)` if it has never reached Apple; otherwise increment `CURRENT_PROJECT_VERSION` first.
12. Wait for App Store Connect processing and resolve export-compliance questions truthfully.
13. Add the processed build to an internal TestFlight group. Do not invite external testers or transmit private email addresses without explicit confirmation.
14. Run a physical Dynamic Island device pass if a compatible registered iPhone is available; otherwise retain the `REQUIRES_PHYSICAL_DEVICE` label.
15. Update the ExecPlan, TestFlight docs, handoff, and known issues with only what was actually verified.
16. Commit, push, open a PR, wait for CI, and merge once the work is truly complete.

### Archive guidance

Use a fresh DerivedData and archive path under `/tmp`. A typical starting point after the correct paid team is selected is:

```bash
xcodegen generate --spec apps/ios/project.yml --project apps/ios

xcodebuild \
  -project apps/ios/Tapso.xcodeproj \
  -scheme Tapso \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/Tapso-TestFlight.xcarchive \
  -derivedDataPath /tmp/Tapso-TestFlight-DerivedData \
  -allowProvisioningUpdates \
  archive
```

Do not assume this command will sign correctly. Inspect the resulting archive, embedded provisioning profiles, entitlements, Team ID, bundle IDs, version/build, and signing identities before validation or upload. Prefer Xcode Organizer for the final validation/upload if command-line credentials or export options are unclear.

### Reality boundaries that remain

- The shipped demo uses deterministic synthetic transit data; it does not claim live Jeju bus data.
- The Live Activity updates locally. It does not automatically advance indefinitely while the app is suspended or terminated.
- Production APNs, push-to-start/update infrastructure, official transit credentials, durable ride workers, and real Jeju field calibration remain separate follow-up work.
- Physical-device Dynamic Island, notification, haptic, battery, and accessibility behavior is not verified unless you actually run the device test plan.
- Do not weaken matching/freshness safeguards or fabricate success to make the demo appear more complete.

### Interaction rules

- Lead with evidence when the Apple UI conflicts with the user's description.
- Do not ask the user for passwords or 2FA codes; let them enter those directly.
- Pause at legal, financial, permission-changing, app-record submission, tester invitation, and irreversible external actions for explicit confirmation.
- Do not upload or distribute under an organization that the user has not clearly authorized.
- Preserve the current Jeju design unless a verified defect requires a change.
- Do not expose Apple IDs, private emails, tokens, provisioning profiles, or signing material in Git, logs, screenshots, PR text, or documentation.
- Never claim TestFlight success until the build appears as processed in App Store Connect and is assigned to the intended testing group.

### Definition of completion for this continuation

Report exact evidence for each state:

- correct paid team identified
- app and extension IDs registered
- signed archive produced
- Apple validation passed
- build uploaded
- build processed
- internal TestFlight group assigned
- physical-device checks passed or explicitly still required
- Git branch/commit/PR/CI/merge state

If a paid membership, authorized organization role, legal agreement, registered device, or user confirmation is unavailable, stop only at that exact external blocker. Leave the repository clean, update the truthful handoff, and give the user the smallest precise action needed to resume.

Begin now by inspecting the repository and reading the mandatory project guidance. Do not redo completed design work.

## END PROMPT
