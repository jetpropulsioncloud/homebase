# HomeBase Live

A privacy-conscious, mobile-first household bills application.

**Status:** runnable *starter project*. Nothing in this zip is connected to your actual banks, apartment portal, or phones. You must supply accounts, credentials, and an HTTPS deployment before those features become live. Payment logic is tested; provider integrations have **not** been end-to-end tested with real credentials.

## Start here — see the app before connecting anything

**Try it now:** open [`homebase-demo.html`](homebase-demo.html) in Chrome, Edge, or another modern browser. It works without Node.js, an API key, or a bank connection. The file is also included at `public/demo.html` so a hosted Next.js site can serve it at `/demo.html`.

The demo is **an actual interactive bill tracker**: it supports mobile-sized layouts, adding/editing/deleting bills, marking monthly payments, changing the budget and shared split, an activity log, and importing/exporting a JSON backup. It starts with the confirmed $1,800 rent and a tentative $60 internet plan. Unknown amounts and due dates are deliberately blank. **Demo data lives only in the current device/browser's localStorage; it does not sync with Sam's device, monitor banks, or send notifications.** Export a backup if you want to preserve demo changes. Anyone using the same browser profile may see the data. Don't enter bank credentials into the demo.

**For the live shared version**, follow the Supabase/Plaid/Vercel setup below. This is developer starter code, not an app deployed to either store, and there is no live banking connected until you configure and test the integrations.

---

## What works once configured

- Separate passwordless sign-ins and a shared household with a private invitation code.
- **Realtime** Supabase-synced bills, monthly payment statuses and notifications on both phones.
- Rent, internet, electricity, water, insurance starters. $1,800 rent is confirmed; $60 internet is **unconfirmed**. All due days and other amounts are **unknown** initially.
- A live monthly budget, shared cost splits, recurring bill editing and paid/unpaid actions.
- Bank connection with **Plaid Link** using read-only Transactions data, encrypted server-side tokens, signed webhooks and incremental `/transactions/sync` processing.
- Conservatively matching payments. Confirmed merchant + exact amount + posted transaction + safe billing date => paid. Pending, variable, unconfirmed or near-month-end transactions => review. Approve or dismiss in Bills.
- Daily reminders at seven, three, one, zero and two days overdue (when the bill has a confirmed due day). Vercel Cron, app notifications and optional Web Push.
- PWA install on Android and iPhone. For iOS push, add it to the Home Screen first (iOS 16.4+).

**Not implemented:** paying bills, accessing provider utility bills directly, automatic account balances, smart invoice extraction, bank reconnection after authorization expiry, budget transaction categorization, email notifications, native App Store deployment, guaranteed instantaneous bank refresh, historical audit exports, full production compliance review. There is no universal API for every landlord, water provider, insurer or utility; this version infers payment from bank transaction history instead.

## 1 — Set up Supabase

1. Create a project at https://supabase.com/dashboard.
2. In **SQL Editor**, run `supabase/schema.sql` in full. It enables table-level row security, household membership checks, notification triggers, and Realtime replication.
3. In **Authentication → Providers**, enable Email sign-in. Use magic links rather than email OTP codes for this frontend.
4. In **Authentication → URL Configuration**, add the deployed HomeBase HTTPS domain (and `http://localhost:3000` for testing) to **Redirect URLs**.
5. Retrieve `Project URL`, `anon/publishable key`, and **service_role** key in Project Settings → API.

**NEVER** commit service-role credentials, encryption keys or Plaid secrets to GitHub, or use them in any `NEXT_PUBLIC_` variable. The public browser key can be public *only* because RLS is enabled.

## 2 — Set up Plaid

1. Sign up at https://dashboard.plaid.com/signup. **Sandbox** uses fake banks and fake transactions.
2. Choose the Transactions product. Add your Plaid Client ID and secret to `.env.local`.
3. `PLAID_ENV=sandbox` for testing; `PLAID_ENV=production` only once your Plaid team has Production access and is ready for real connections. Never assume Production is free or granted automatically; review your own plan.
4. On a live HTTPS deployment, set `NEXT_PUBLIC_APP_URL=https://YOUR-APP.vercel.app` (or your own domain). Plaid webhook URL automatically becomes `https://YOUR-APP.vercel.app/api/plaid/webhook`.
5. For banks requiring OAuth, register your callback URL with Plaid, then set `PLAID_REDIRECT_URI=https://YOUR-APP.vercel.app/` and whitelist that URL in Plaid's dashboard. Link sessions resume on return.
6. The **Connect bank** button uses Plaid's real Link page; the backend exchanges `public_token` for an encrypted token and reads Transactions. Webhook signatures are checked with Plaid's JWK before processing.

Transactions may be pending or unavailable initially. Plaid generally refreshes bank data 1–4 times a day depending on institution, and can support on-demand refresh on eligible plans; pressing “Check for new charges” in HomeBase only retrieves Plaid's *currently available* information. It does not force the bank to update.

### How a payment is detected

1. The bank produces a transaction, such as `$1,800 DEMO PROPERTY`.
2. Plaid's **SYNC_UPDATES_AVAILABLE** webhook signals an update.
3. HomeBase requests incremental transactions, finds the bill's known merchant aliases, verifies posted (not pending) status, amount, and billing month, and marks a high-confidence transaction paid.
4. Variable amounts, missing dates, end-of-month timing, estimated bills or pending charges show **Needs review**. Clicking **Yes, paid** or **Not this bill** resolves it.
5. Both members see the updated status through Supabase Realtime and receive in-app alerts, plus push if subscribed.

**Important:** A posted transaction is evidence of bank activity, not guaranteed settlement of a landlord or provider's ledger. A payment can be returned, misclassified or applied to a different month. Use the provider's account when the exact paid status matters. HomeBase does not initiate transfers or payments.

## 3 — Local setup

Requirements: Node.js 20+ and npm.

```bash
unzip homebase-live.zip
cd homebase-live
cp .env.example .env.local
npm install
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`.

Open http://localhost:3000. Add your Supabase and Plaid sandbox keys in `.env.local` and restart the server. Sign in with your email, enter your name, create your household, copy the 24-character invite code and send it privately to Sam. She signs in separately and joins with it.

Use `npm test` for pure matching rules and `npm run typecheck` to inspect TypeScript errors *after `npm install`*.

## 4 — Push notifications

Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

Copy public/private values to `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, and set `VAPID_SUBJECT=mailto:YOUR-EMAIL`. Keep the private key server-side. Push is optional; in-app notification cards work without it.

In **Activity**, choose **Enable notifications** on **each device**. You must grant permission. On iPhone, first launch the installed Home Screen web app, then tap Enable notifications there.

## 5 — Deploy on Vercel

1. Keep this project private for production work, or use a public repository only with anonymized sample data and no secrets.
2. Import that repository on https://vercel.com and select Next.js.
3. Add the `.env.local` variables (except local-only ones) under the Vercel project settings. Set `NEXT_PUBLIC_APP_URL` to the final HTTPS site.
4. Create `CRON_SECRET` with `openssl rand -hex 32` and add it to Vercel.
5. Deploy. `vercel.json` schedules a once-daily reminder check around 12:00 UTC (7–8 AM Eastern, depending on daylight saving time). Cron timing on Hobby is approximate. Plaid's webhooks update payments between reminders.
6. Add your production URL to Supabase's Auth redirect allowlist and Plaid's webhook/OAuth settings.
7. Install the app on both phones. Only after sandbox validation should you connect real accounts with a Plaid Production/Trial account. The Settings screen can revoke and disconnect any bank linked under your own login.

**Costs:** Vercel and Supabase have entry-level free options with limits. Plaid Sandbox is free; eligible US/Canada new developers may get a Trial plan for up to 10 live institution connections, while paid access charges according to the actual pricing agreement. SMS and other future APIs could incur additional costs.

## Security and operational limitations

- The server encrypts Plaid access tokens with AES-256-GCM. Rotate secrets only with a deliberate token migration procedure or existing connections will stop working.
- Sensitive tables are service-role-only; household tables are protected with RLS. Never bypass authorization checks when extending API routes.
- Webhooks require valid Plaid JWT + body SHA-256, and only synced Item IDs already in the database are processed.
- The bank-sync worker is idempotent for normal webhook retries but **does not currently have a database-level single-item concurrency lock or atomic cursor transaction**. Before production beyond two users, add locking and transactional sync, plus structured failure/retry monitoring.
- Chargebacks, reversals and deletions may require human review; the code flags previously matched removed transactions for review.
- Shared billing month estimates and merchant matching should be reviewed before relying on bill statuses for late fees.
- Invite codes can be copied by household members. Share yours privately. The household creator can rotate an invitation code in Settings; an old code then stops working.
- No banking credentials are stored in HomeBase or in the browser; Plaid hosts account authorization. End users must give explicit permission before bank access.
- This is a personal starter, **not a security-audited consumer fintech product**. Perform penetration testing, privacy disclosures, backup planning and production security review before collecting third-party data at scale.

## Files

`app/page.tsx` UI + authentication + Realtime.

`supabase/schema.sql` database + RLS + RPC.

`app/api/plaid/*` link, token exchange, manual sync, webhook, status.

`lib/bank-sync.ts` incremental bank update processor.

`lib/matcher.mjs` deterministic matching logic and `tests/matcher.test.mjs` unit tests.

`app/api/cron/reminders` daily notice scheduler; `app/api/push/subscribe` push registration.

`public/sw.js` service worker; `public/manifest.webmanifest` installable app metadata.
