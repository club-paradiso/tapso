# Privacy and security

TAPSO's default architecture tracks a public transit vehicle, not continuous passenger location. A future one-shot boarding location may be optional and must work only with explicit permission; it is not required by the current core.

- Government and APNs keys remain server-side and are excluded by `.gitignore`.
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
