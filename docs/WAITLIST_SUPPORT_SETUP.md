# Waitlist and support setup

Everything in this document is operator work that code cannot do for you. Until
it is done, the site still builds, deploys, and renders — the waitlist endpoint
answers `503 unavailable` and the form tells the visitor so rather than
pretending a registration was stored ("지금은 사전예약을 받을 수 없어요. 입력한 내용은
저장되지 않았어요.", `apps/web/src/lib/waitlistMessages.ts`).

Reality labels:

| Capability | Status |
|---|---|
| Waitlist API, validation, rate limiting, state machine | `IMPLEMENTED` — 90 tests in `apps/web/test` |
| Waitlist persistence against a live Supabase project | `BLOCKED_BY_CREDENTIALS` |
| Confirmation email delivery through Resend | `BLOCKED_BY_CREDENTIALS` |
| Support payment capture | `NOT ENABLED` — no merchant account exists |
| Toss browser SDK glue (`src/lib/supportCheckout.ts`) | `UNVERIFIED` — needs a real client key |

## Architecture

```
browser (React + Vite, apps/web/src)
   |  fetch
   v
Vercel Functions (apps/web/api)         <- same Vercel project, no extra host
   |                    |
   |  PostgREST         |  REST
   v                    v
Supabase Postgres     Resend / Toss Payments
```

`services/api` is untouched. It binds to `127.0.0.1`, has no host and no
deployment pipeline, so standing it up for one marketing form would have added
infrastructure without adding capability. See `docs/DECISIONS.md`.

## 1. Create the Supabase project (required for the waitlist)

1. Create a project in the region closest to Jeju — `ap-northeast-2` (Seoul).
2. Open **SQL Editor** and run `apps/web/supabase/migrations/0001_waitlist_support.sql`.
3. Confirm four tables exist with RLS enabled and no policies:
   `waitlist_entries`, `support_payments`, `support_webhook_events`,
   `rate_limit_hits`. No policy plus RLS on means anon and authenticated see
   nothing; only the service role key can read or write.
4. From **Project Settings → API**, copy the project URL and the
   `service_role` key.

> The free tier pauses a project after a period of inactivity. A paused project
> makes the waitlist return `503` and registrations submitted during that window
> are lost. If that matters, use a plan that does not pause.

## 2. Create the Resend sender (required for confirmation email)

1. Add and verify your sending domain in Resend. An unverified domain returns
   403 and every registration will be recorded with
   `confirmation_email_status = 'failed'`.
2. Create an API key with send permission only.
3. Choose the `From` address, e.g. `TAPSO 탑서 <hello@your-domain>`.
4. Set `WAITLIST_REPLY_TO` to a mailbox a person reads. The confirmation email
   tells visitors to reply there to request deletion, so it must work.

## 3. Set Vercel environment variables

On the `apps/web` Vercel project, add these for Production and Preview.
Names only — the values never belong in Git.

| Name | Scope | Required |
|---|---|---|
| `SUPABASE_URL` | server | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | server, secret | yes |
| `RESEND_API_KEY` | server, secret | yes |
| `WAITLIST_FROM_EMAIL` | server | yes |
| `WAITLIST_REPLY_TO` | server | recommended |
| `PRIVACY_CONSENT_VERSION` | server | optional |

Then redeploy. Vercel picks up the `api/` directory automatically for a Vite
project; no `vercel.json` change is needed.

## 4. Verify the waitlist end to end

```bash
curl -sS -X POST https://<domain>/api/waitlist \
  -H 'content-type: application/json' \
  -d '{"email":"you@your-domain","riderType":"resident","privacyConsent":true,"formRenderedAt":0}'
```

Expect `{"status":"created","emailDelivery":"sent"}`, one new row in
`waitlist_entries` with `confirmation_email_status = 'sent'`, and the
confirmation in your inbox. Run it again and expect
`{"status":"already_registered"}` with no second row.

Then submit the real form in a browser at 390px and at 1440px. The endpoint is
the same, but only the browser path exercises consent, the honeypot, and the
fill-duration check.

### Retrying deferred confirmations

A registration survives an email outage. To find the ones that need another
attempt:

```sql
select id, email, created_at, confirmation_error
from waitlist_entries
where confirmation_email_status <> 'sent'
order by created_at;
```

There is no automatic retry job. Resending is currently a manual step.

## 5. Support payment — still NOT ENABLED

Nothing below has been done, and none of it is required to ship the waitlist.

1. Complete Toss Payments merchant onboarding (사업자 등록 required). This is a
   contractual and financial step; do not start it on TAPSO's behalf without
   deciding the business structure first.
2. **Decide the legal and accounting meaning of `후원` before taking any money.**
   The code deliberately uses the neutral word "support" and promises no
   receipt, no tax deduction, and no charitable status, because none has been
   established. Do not add that language to the UI without verified advice.
   User-facing wording lives in `SupportDialog.tsx` (the sheet) and
   `apps/web/src/sections/Support.tsx` with `src/lib/supportStatus.ts` (the
   page section, which says outright that no receipt or deduction is issued).
3. Set `TOSS_CLIENT_KEY` and `TOSS_SECRET_KEY` to **test** keys, set
   `SUPPORT_ENABLED=true` on a Preview deployment only, and complete one test
   payment. Confirm a `support_payments` row reaches `status = 'paid'`.
4. Generate a long random `SUPPORT_WEBHOOK_TOKEN` and register the webhook URL
   with Toss as `https://<domain>/api/support/webhook?t=<token>` for the
   `PAYMENT_STATUS_CHANGED` event. Toss sends no signature for this event, so
   the server treats the body as a hint and re-reads the payment from the Toss
   API before recording anything. The token is TAPSO's own shared secret, not a
   Toss feature.
5. Only after a test payment works end to end, swap in live keys.

Until step 3, the page's support section reads "결제 준비 중" (it asks
`/api/support/config`, and anything but `live` counts as not open) and its
button opens a sheet whose continue button is disabled with an explanation. That is intentional: the site must never invite a payment it cannot
take.

## Data handling

- Stored per registration: address, normalized address, coarse rider type,
  consent version, consent timestamp, email delivery state, timestamps.
- Not stored: name, phone number, postal address, demographics, location, IP
  address. The rate limiter hashes nothing personal into a durable row beyond a
  bucket key, and logs mask both addresses and IPs.
- `support_payments` holds no supporter identity at all — no email, no name, no
  card data. Card details never reach TAPSO; they stay with the provider.
- Supporting TAPSO does not require joining the waitlist, and joining the
  waitlist does not subscribe anyone to marketing.

**Operator decision still open:** the consent copy limits use to release
announcements and promises deletion on request, but no maximum retention period
has been set. Decide one, then either add a scheduled deletion job or document
the manual review interval. Do not state a period in the UI before deciding it.
