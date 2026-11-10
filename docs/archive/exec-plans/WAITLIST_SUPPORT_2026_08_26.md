# ExecPlan: production waitlist and TAPSO support flow

Status: implementation complete for the waitlist; support payment implemented but
`NOT ENABLED` pending merchant onboarding.

## 1. User-visible outcome and non-goals

### Outcome

- A visitor submits the TAPSO waitlist form and the registration is persisted
  server-side. No mail app is opened, on any platform.
- The visitor receives a branded transactional confirmation email.
- The form reports honest state: success, already registered, invalid input,
  rate limited, or backend unavailable. It never claims success without a
  persisted record.
- The Figma `CTA Row / Preorder + Support` (`27:34` desktop, `27:40` mobile)
  ships: `사전예약 하기` stays primary/mint, `후원하기` is secondary.
- `후원하기` opens an accessible support sheet with configurable KRW amounts.
- The support payment backend exists, is tested, and is off by default.

### Non-goals

- Redesigning the hero, Journey Card, Dynamic Island preview, feature ribbon,
  or navigation.
- Migrating `apps/web` off React + Vite.
- Enabling real payment capture. No merchant account exists.
- Introducing user accounts, marketing automation, or a CRM.
- Changing transit, matching, iOS, or Live Activity behavior.

## 2. Verified constraints and assumptions

- VERIFIED: `apps/web` is React 19 + TypeScript + Vite 7, deployed to Vercel
  with `apps/web` as the project root (`apps/web/vercel.json`,
  `framework: "vite"`, `outputDirectory: "dist"`).
- VERIFIED: `services/api` binds `127.0.0.1`, declares zero npm dependencies,
  has no Dockerfile, no host, and no deployment configuration. `README.md`
  labels it a scaffold. It is not a deployed backend.
- VERIFIED: the repository has no database, no ORM, no migration tooling, and
  no email provider wired anywhere.
- VERIFIED: no Supabase, Resend, or payment-provider environment variable is
  present in this workspace. Only `VERCEL_TOKEN` exists.
- VERIFIED: a Supabase project exists on the account but is `INACTIVE`, is
  named `lucanomics's Project`, and has no link to this repository. It is not
  treated as the TAPSO database.
- VERIFIED (Figma `kkx04GvqOzHje7Dw5ikO9X`, page `03 Web`): the waitlist card
  `9:51` is 520x353 with 28px padding and a 16px column gap; the CTA row
  `27:34` is 464x56 with a 12px gap and two `flex: 1 0 0` buttons; the mobile
  CTA row `27:40` is 350x56 with the same 12px gap.
- VERIFIED (Figma `5:26`): Button styles are Primary (mint) and Secondary
  (white + 1px `--border`), radius `--tapso-radius-md` = 18, height 56, label
  15px bold. Pressed is 82% opacity, Disabled is 45% opacity, and Secondary
  Disabled additionally uses `--mist`. Its Figma description requires one
  Primary per screen and requires Disabled to explain its cause in adjacent
  copy.
- VERIFIED (Figma `9:64`, hidden): a `Waitlist Success` state exists — white
  card, 1px mint border, radius 24, padding 24, gap 12, 34px emoji, 18px bold
  title, 13px muted body, 48px mint action, radius 16.
- VERIFIED (Vercel docs, `functions/functions-api-reference`): Vercel Functions
  use the Web Handler signature and receive a standard `Request`. The
  `api/` directory example under `functions/runtimes/wasm` uses
  `export async function GET(request: Request)`.
- VERIFIED (Toss Payments docs and developer community): confirmation is
  `POST https://api.tosspayments.com/v1/payments/confirm` with
  `{ paymentKey, orderId, amount }` and HTTP Basic auth built from
  `secretKey + ":"` base64-encoded.
- VERIFIED: the Toss `tosspayments-webhook-transmission-signature` header is
  sent only for `payout.changed` and `seller.changed`. `PAYMENT_STATUS_CHANGED`
  carries no signature.
- ASSUMPTION: Supabase Postgres is the intended persistence layer. Every
  storage call goes through one narrow PostgREST boundary, so replacing it is a
  single-file change.
- REALITY LABEL `BLOCKED_BY_CREDENTIALS`: no Supabase project, Resend domain, or
  Toss merchant account is configured. Persistence, email delivery, and payment
  are implemented and unit-tested against injected fakes but have never
  executed against a live provider from this repository.
- REALITY LABEL `UNVERIFIED`: `supportCheckout.ts` loads the Toss browser SDK.
  It cannot be exercised without a merchant client key.

## 3. Milestones and observable completion criteria

1. **Backend placement** — serverless handlers live in `apps/web/api/`, are
   typechecked by `tsc -b`, and carry no runtime npm dependency. DONE.
2. **Persistence** — `supabase/migrations/0001_waitlist_support.sql` creates
   `waitlist_entries`, `support_payments`, `support_webhook_events`, and
   `rate_limit_hits`, enables RLS with no anon grants, and enforces a unique
   index on `email_normalized`. DONE.
3. **Waitlist endpoint** — `POST /api/waitlist` validates, normalizes,
   rate-limits, upserts, sends confirmation email, and returns a typed status
   union. DONE.
4. **Email** — Resend transport behind an injectable interface; delivery
   failure downgrades to `deferred` and never destroys the registration. DONE.
5. **Frontend states** — idle, invalid, submitting, success, duplicate, error,
   unavailable; the typed email survives a failure. DONE.
6. **Support UX** — Figma CTA row shipped; accessible dialog with focus trap,
   Escape, focus restore, amount presets, and custom amount. DONE.
7. **Support backend** — intent, confirm, and webhook handlers with an explicit
   payment state machine, server-side amount authority, and webhook
   idempotency. DONE, disabled by configuration.
8. **Verification** — `npm --prefix apps/web test`, `npm --prefix apps/web run
   build`, and `npm --prefix services/api test` all pass. DONE.

## 4. Decisions and alternatives considered

- **Chosen: Vercel Functions co-located in `apps/web/api/`.** The marketing
  site already deploys from `apps/web`; this adds zero infrastructure.
  *Rejected:* extending `services/api`, which is an undeployed localhost
  scaffold. Standing it up would mean choosing a host, a runtime, a deployment
  pipeline, and a CORS boundary for one form.
  *Rejected:* migrating to Next.js for API routes. The repository is explicit
  about adapting to the existing stack.
- **Chosen: Web Handler signature (`export async function POST(request:
  Request)`).** It gives exact raw-body access for webhook verification and
  makes every handler directly unit-testable with a plain `Request`, with no
  `IncomingMessage`/`ServerResponse` mocking and no `@vercel/node` dependency.
- **Chosen: zero runtime dependencies.** Supabase is reached through PostgREST
  and Resend through its REST API, both with `fetch`. This matches
  `services/api`, which also ships no dependencies, and keeps the marketing
  site's bundle untouched.
  *Rejected:* `@supabase/supabase-js` and `resend`. Two SDKs and their
  transitive trees for four HTTP calls.
- **Chosen: Toss Payments** as the payment provider behind a
  `SupportPaymentProvider` interface. It is the KRW-native choice for a
  Korean-facing service.
  *Rejected:* Stripe. Materially worse Korean payment-method coverage.
- **Chosen: the webhook is a notification, never evidence.** Toss sends no
  signature on `PAYMENT_STATUS_CHANGED`, so the handler re-queries
  `GET /v1/payments/{paymentKey}` with the server secret key and reconciles
  from that authoritative response.
  *Rejected:* verifying a signature scheme Toss does not document for this
  event. Inventing header names would be worse than useless.
- **Chosen: an optional unguessable webhook URL token** (`?t=...`) as
  defense-in-depth. This is a TAPSO-defined shared secret placed in the
  operator-configured webhook URL, documented as ours and not as a Toss
  feature.
- **Chosen: server-side amount authority.** The intent row stores the amount;
  confirm rejects any client-supplied amount that disagrees with the stored
  intent.
- **Chosen: no `marketing_consent` column.** The waitlist's stated purpose is
  the release notification itself. A consent flag we would never read is
  personal data we should not store.
- **Chosen: no supporter email on `support_payments`.** There is no product
  reason yet, and supporting TAPSO must not require joining the waitlist.
- **Chosen: Postgres-backed sliding-window rate limiting** via a
  `SECURITY DEFINER` RPC, with an in-memory burst limiter in front of it.
  Serverless instances do not share memory, so memory alone is not a control.
- **Chosen: a honeypot field and a minimum fill duration** instead of a
  CAPTCHA. Abuse on an unlaunched waitlist does not justify the UX cost.
- **Chosen: support ships disabled with an explanatory disabled button**,
  following the Figma Button guidance that a Disabled state must explain its
  cause in adjacent copy.

## 5. Reproduction commands and evidence

```bash
npm --prefix apps/web ci
npm --prefix apps/web test
npm --prefix apps/web run build
npm --prefix services/api test
```

Figma-to-DOM markers introduced or updated by this change:

| DOM | Figma node |
|---|---|
| `.waitlist-form-card` | `9:51` |
| email `Field` | `9:53` / mobile `10:61` |
| rider `Field` | `9:57` |
| `.cta-row` | `27:34` / mobile `27:40` |
| `.figma-submit` (`사전예약 하기`) | `9:61` / mobile `10:65` |
| `.figma-support` (`후원하기`) | `27:35` / mobile `27:41` |
| `.waitlist-result` success | `9:64` |
| `.waitlist-privacy` | `10:68` |

`.support-dialog` has no Figma node. It is built from the existing Button
(`5:26`) and Field (`6:6`) components and the shipped token set; it is listed
in section 6 as design debt rather than given a fabricated node id.

### Measured against Figma

Chromium at deviceScaleFactor 2, against `npm run preview`:

| Viewport | Horizontal overflow | Preorder | Support | Gap | Layout |
|---|---|---|---|---|---|
| 320px | none | 280 | 280 | — | stacked |
| 360px | none | 320 | 320 | — | stacked |
| 390px | none | 169 | 169 | 12 | row |
| 430px | none | 189 | 189 | 12 | row |
| 700px | none | 324 | 324 | 12 | row |
| 768px | none | 295 | 295 | — | stacked |
| 900px | none | 172 | 172 | 12 | row |
| 1024px | none | 201 | 201 | 12 | row |
| 1440px | none | 225 | 225 | 12 | row |

Figma specifies 226/226 with a 12px gap inside a 464px row at 1440. The shipped
row is 462px and each button 225px: the card's 1px CSS border consumes 2px of
content width, which a Figma inside-stroke does not. Gap, height (56), radius
(18), fill, border, and font size match exactly.

Two defects were found by this pass and fixed:

1. `사전예약 하기 →` clipped at 768px, where the card narrows to `min(46vw,
   520px)` and each button fell to 141px against a 156px intrinsic need. The
   CTA row now stacks between 701px and 880px rather than shrinking the label.
2. The primary button rendered 2px narrower than the secondary. A bordered and
   an unbordered child resolve to different border-box sizes under `flex: 1 1
   0`, so the primary now carries a transparent 1px border.

### Interaction evidence

- Waitlist states driven in Chromium: invalid (both fields, `aria-invalid` plus
  `aria-describedby` resolving to visible ⚠ text), submitting, success,
  success-with-deferred-email, duplicate, rate limited, and backend
  unavailable. The typed address survives duplicate and error.
- With no credentials configured, the real endpoint answers `503` and the form
  shows `지금은 신청을 저장하지 못했어요.` — never a fabricated success.
- Support dialog: `:modal` true, background content unreachable by Tab, Escape
  closes, focus returns to `후원하기`, `body` overflow restored, no viewport
  overflow at 390px or 1440px, and the disabled continue button resolves its
  `aria-describedby` to the sentence explaining why.
- Provider return: `?support=success` with a payment key renders the confirmed
  amount only after `/api/support/confirm` answers `paid`; a hand-typed
  `?support=success` with no key renders
  `결제 결과를 확인하지 못했어요.` The query string is cleared before anything
  else runs, so a refresh cannot replay it.
- Bundle: `SupportDialog` (4.15 kB) and `supportCheckout` (0.82 kB) are separate
  lazy chunks. The Toss SDK is never requested unless the server reports
  `mode: "live"`.

## 6. Progress, unexpected findings, risks, and exact next action

### Progress

- [x] Repository and deployment architecture analysis.
- [x] Figma inspection of `9:51`, `10:58`, `9:64`, and `5:26`.
- [x] Migration, storage boundary, validation, rate limiting, email.
- [x] Waitlist endpoint and frontend states.
- [x] Support CTA, dialog, endpoints, state machine, webhook reconciliation.
- [x] Tests and build verification: 90 Node tests in `apps/web/test`, 5 in
      `services/api`, `tsc -b` clean, Vite production build clean.
- [x] Responsive and interaction QA at 320/360/390/430/700/768/900/1024/1440.
- [ ] Operator provisioning (Supabase project, Resend domain, Toss merchant).

### Unexpected findings

- The Figma file still carries `Noto Sans KR` font metadata on several waitlist
  text nodes even though the shipped site standardized on Pretendard. The
  implementation keeps Pretendard and does not follow that stale metadata.
- The desktop waitlist card had a fixed 353px height. The required consent row
  makes the card content-driven, so 353px became a floor. The mobile frame has
  no card at all, so that floor is released below 700px; leaving it in place put
  roughly 50px of dead space under the mobile form.
- The hidden Figma success state `9:64` still describes the mailto handoff
  (`메일 앱에서 보내기를 누르면 사전예약이 완료돼요`). Its geometry is reused;
  its copy is replaced, because the mail handoff no longer exists.
- Toss documents no webhook signature for `PAYMENT_STATUS_CHANGED`, which
  forced the re-query design rather than a signature check.

### Risks

- Supabase free-tier projects pause after inactivity. A paused project makes
  `POST /api/waitlist` return `503 unavailable`. The form states this honestly
  rather than claiming success, but registrations are lost for that window.
- Resend requires a verified sending domain. Until then `emailDelivery` will
  report `deferred` and rows will hold `confirmation_email_status = 'failed'`
  for later retry.
- The Toss browser SDK glue is unverified against a real client key.

### Design debt to add to Figma

- A consent row inside `9:51` and `10:58`. Korean PIPA practice calls for an
  explicit unchecked box, and the shipped form has one; Figma does not.
- A support sheet component. `.support-dialog` currently has no node.
- A stacked variant of `CTA Row` for the 320-389px and 701-880px bands.
- Refreshed copy on the hidden success state `9:64`, which still describes the
  removed mailto handoff.

### Exact next action

Provision the operator resources listed in `docs/WAITLIST_SUPPORT_SETUP.md`,
set the Vercel environment variables, redeploy, and submit one real address to
confirm a row lands in `waitlist_entries` and a confirmation email arrives.
