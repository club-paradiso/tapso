# Privacy and security

TAPSO's default architecture tracks a public transit vehicle, not continuous passenger location. A future one-shot boarding location may be optional and must work only with explicit permission; it is not required by the current core.

**Saved-stop alerts** (`docs/exec-plans/AUTO_START.md`, M3; owner decision D2, 2026-10-05) are the one feature that uses location while TAPSO is not on screen.
- They are off by default; the rider switches them on per saved journey, for at most 10 stops.
- iOS watches a 150 m circle around each switched-on boarding stop (`CLMonitor`). The decision "near the stop" is made on the phone, and no coordinate leaves it.
- On entry, the only network read is the route's vehicle snapshot (`/v1/vehicles?routeId=&cityCode=`), the same read a ride makes.
- Turning the alert off removes the circle. Every other feature works without location permission.

- Government and APNs keys remain server-side and are excluded by `.gitignore`.
- `apps/ios/Resources/PrivacyInfo.xcprivacy` (app, Live Activity extension and share extension): no tracking, no collected data types, and `UserDefaults` for the app's own state (reason `CA92.1`) and for the App Group hand-off inbox the share extension writes and the app reads (`HandoffInbox`, reason `1C8F.1`). Reason texts checked against Apple's `NSPrivacyAccessedAPITypeReasons` documentation on 2026-10-01. Whether live-ride session data counts as "collected" for App Store Connect's privacy label is the owner's call at submission; this repository's reading is that it serves only the ride in progress and is deleted at its end.
- The iOS demo collects no user data and makes no network request. Live rides
  (beta) talk only to TAPSO's own API: a route number, a route variant, two stop
  sequences and the bus the rider confirmed. No location, account or device
  identifier is sent, and the server deletes the session when the ride ends.
- A place shared from a map app (share sheet or paste) is read on the phone and
  never sent: TAPSO does not open shared links, keeps one parsed place (never the
  raw text) in its App Group for at most 30 minutes, deletes it when read, and
  keeps it afterwards only with the active ride on the device. The clipboard is
  read only when the rider taps Paste, and written only when they tap Copy in
  the share sheet (`product/MAP_HANDOFF_V3.md`).
- A screenshot picked in TAPSO's route import is read on the phone with Apple's
  Vision framework and dropped: it is never saved or uploaded, and its text is
  never sent. Choosing it uses the system photo picker, which gives TAPSO only
  that photo and no access to the library. To check the route, TAPSO's API
  receives the bus number(s) read from it, like a rider typing the number
  (`product/SCREENSHOT_IMPORT_V1.md`). Shared to TAPSO from the Photos share sheet, a screenshot is read the same way inside the share extension, which leaves only what it read (bus numbers and stop-like lines, never the picture) in the App Group for at most 30 minutes, until the app takes it; the extension makes no network request. TAPSO asks for photo-library access only when the rider taps "사진 앱에서 이 스크린샷 삭제" under a result, to delete the original from Photos; iOS then confirms the deletion itself. Picking or sharing a screenshot needs no such access.
- The marketing site collects an email address, a coarse rider type, and a
  consent record, only after an explicit unchecked consent box is ticked. It
  stores no name, phone number, address, demographics, location, or IP address,
  and logs mask both addresses and client IPs.
- Waitlist addresses are used for release announcements only. There is no
  marketing list, and supporting TAPSO neither requires nor triggers one.
- Support payments store no supporter identity and no card data; card details
  stay with the payment provider. See `docs/WAITLIST_SUPPORT_SETUP.md` for the
  retention decision that is still open.
- The API uses an eight-second upstream timeout and structured errors.
- Ride sessions should use random opaque IDs, short retention, and the minimum route/stop/token data needed to update an activity.
- Activity push tokens are sensitive routing material: encrypt at rest, never log them in full, rotate with ActivityKit, and delete after session end.
- Do not store passenger GPS histories, contact data, or identity unless a later feature has a specific lawful need and consent design.

Authentication is intentionally absent from the scaffold. Add it only when persistent user-specific data creates an actual boundary.

**앱을 닫아도 계속 알려 주기** (2026-10-06) is off by default and works only during a live ride without push.
- iOS's location service runs at its coarsest accuracy so that TAPSO is not suspended, and iOS shows the blue indicator while it runs.
- TAPSO drops every fix and sends none; the ride's polling is the same vehicle-session read as in the foreground.
- It stops when the ride ends, or when the server can push instead.
