# TestFlight demo release

## App record

- App name: `TAPSO`
- Platform: iOS
- Primary language: Korean
- Bundle ID: `com.lucanomics.tapso`
- Live Activity extension: `com.lucanomics.tapso.LiveActivity`
- Share extension: `com.lucanomics.tapso.Share`
- App Group (app and share extension): `group.com.lucanomics.tapso` — available to a free Personal Team as well (`VERIFIED`, Account Help › Supported capabilities (iOS)), so device builds keep working without the paid team
- SKU: `tapso-ios-demo-2026`
- Version: `0.1.0`
- Build: increment `CURRENT_PROJECT_VERSION` for every upload
- Privacy policy URL: to be published at a stable public URL before external testing (`docs/beta/HUMAN_ACTION_REQUIRED.md` step 7). Source: `docs/PRIVACY.md`.

The bundle identifiers must be registered under a paid Apple Developer Program team that owns the App Store Connect record. Automatic signing is enabled.

## Team prerequisite (current blocker)

Verified read-only on 2026-08-21: no paid team is currently reachable from the build host. Xcode holds one Apple ID account resolving to one team, `89CGFQ24U5` / `Luca Kim (Personal Team)`, with `isFreeProvisioningTeam = true`. The only installed signing identity is an Apple Development certificate; there is no Apple Distribution certificate and there are no provisioning profiles. A free Personal Team cannot produce App Store distribution signing and cannot upload to TestFlight.

Reproduce the check without credentials:

```bash
security find-identity -v -p codesigning
plutil -extract IDEProvisioningTeamByIdentifier xml1 -o - \
  ~/Library/Preferences/com.apple.dt.Xcode.plist
```

Exactly one of the following must be completed by the account owner before the rest of this document applies.

**Option A — own paid membership (keeps TAPSO under the repository owner).** Enroll the owner's Apple ID in the Apple Developer Program as Individual/Sole Proprietor. This is a paid annual purchase and a legal-agreement acceptance, so it must be performed by the owner. Enrollment creates a new paid team whose Team ID will differ from the Personal Team `89CGFQ24U5`; `DEVELOPMENT_TEAM` in `apps/ios/project.yml` must then be updated to the new value.

**Option B — authorized organization team.** The separate organization in which this Apple ID holds a `Marketing` seat has a different Account Holder and a pending updated Apple Developer Program License Agreement. That Account Holder would have to accept the agreement and grant `Admin`, `App Manager`, or `Developer` with Certificates, Identifiers & Profiles access. `Marketing` grants none of that, which is why the organization does not appear as a signing team in Xcode. Do not distribute TAPSO under that organization without the repository owner's explicit authorization.

The build host must also have several GB of free disk before archiving; see `KNOWN_ISSUES.md`.

## Beta metadata

### Beta description

탑서는 제주 버스에서 내릴 곳을 고르고 탈 버스를 직접 확인하면, 남은 정류장과 내릴 준비 시점을 앱·잠금 화면·Dynamic Island에서 알려 주는 iPhone 앱입니다. 승객 위치를 계속 추적하지 않고, 승객이 확인한 버스를 따라갑니다. 이 베타는 제주 공공 버스 정보를 씁니다.

### What to test

1. 정류장·장소 이름으로 내릴 곳을 찾습니다. 주요 관광지 30곳은 영어·중국어·일본어 이름으로도 찾을 수 있습니다.
2. 탈 정류장과 방향을 고르고, 다가오는 버스의 번호판 끝자리를 보고 `이 버스 확인하기`를 누릅니다.
3. 버스가 오는 동안 화면과 잠금 화면이 `버스가 오고 있어요`와 `N정거장 전`을 보여주는지, 탄 뒤에는 남은 정거장이 맞게 줄어드는지 확인합니다.
4. 2정거장 전(`내릴 준비`), 다음 정류장(`다음에 내려요`), 도착이 서로 다른 화면과 알림으로 오는지 확인합니다.
5. 문제가 있으면 홈 아래 또는 여정 메뉴의 `의견 보내기 (베타)`로 알려 주세요. 접수 번호가 보이면 전송된 것입니다.

알아 두실 점: 앱을 완전히 닫으면 Apple 푸시가 켜지기 전까지 잠금 화면이 갱신되지 않을 수 있습니다. 앱을 열어 두거나 `앱을 나가도 계속 알려 주기`를 켜 주세요. 하차는 항상 차내 안내방송과 정류장 표시로 함께 확인해 주세요.

### Beta review notes

- No account or test credentials are required.
- TAPSO follows the bus the rider confirms. It does not send the rider's location to TAPSO's servers. Location is optional, When-In-Use, and used on the device only (`docs/PRIVACY.md`). The opt-in "keep going when closed" mode uses the background location capability to stay running and discards every fix (`RideKeepAlive`).
- Live rides talk only to TAPSO's API, using Jeju public bus data (TAGO). Automatic bus selection is off; the rider confirms the bus.
- Beta builds include an in-app feedback form. A report is stored for 30 days with app version, device model and language; the ride record is attached only if the tester ticks the box.
- A Dynamic Island-capable iPhone provides the intended experience; other supported iPhones show the Lock Screen Live Activity.
- The Debug-only synthetic sample ride is not in Beta or Release builds (release gate 2).

### Feedback email

Set this to an address monitored by the release owner in App Store Connect. Do not commit private contact details to the repository.

## Upload checklist

1. Satisfy the **Team prerequisite** above and confirm the latest Apple Developer agreements are accepted for that exact team.
2. Confirm the signing account can reach Certificates, Identifiers & Profiles for that team, and update `DEVELOPMENT_TEAM` in `apps/ios/project.yml` if the verified paid Team ID differs from the value currently checked in.
3. Register the app and both extension bundle identifiers and the App Group, then select that paid team in Xcode.
4. Create the App Store Connect record using the values above.
5. Archive with `Release`, validate, and upload through Xcode Organizer.
6. Confirm build processing and export-compliance status. The app declares `ITSAppUsesNonExemptEncryption = NO` because this demo contains no encryption implementation.
7. Add the processed build to an internal testing group and paste the beta metadata above.
8. Complete the signed physical-device cases in `DEVICE_TEST_PLAN.md` before inviting external testers.

## Reality boundary

Internal TestFlight distribution of the deterministic demo does not require public-transit or APNs credentials. A self-advancing background demo or live pilot does require ActivityKit push tokens, a production APNs gateway, a durable session worker, official public-data credentials, and field validation.
