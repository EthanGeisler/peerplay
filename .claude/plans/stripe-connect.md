# Stripe Connect Integration Plan

## 1. Summary

Replace the mock payment system with real Stripe Connect so that developers receive payments directly into their own Stripe accounts. Players pay via Stripe Checkout (hosted payment page), BoilerDeck takes a 1% platform fee via `application_fee_amount`, and licenses are only granted after webhook confirmation of successful payment. Free games (priceCents === 0) bypass Stripe entirely and grant a license immediately, preserving the current instant-checkout UX for them.

---

## 2. Affected Layers

| Layer | Changes Needed | Key Files | Dependencies |
|-------|---------------|-----------|--------------|
| **Shared package** | Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as required env vars (currently optional), add `STRIPE_CONNECT_RETURN_URL` and `STRIPE_CONNECT_REFRESH_URL` env vars | `server/packages/shared/src/config.ts` | None |
| **Prisma schema** | Add `stripeCheckoutSessionId` to Payment model, add `stripePayoutsEnabled` to Developer model | `server/prisma/schema.prisma` | None |
| **Payment package** | Rewrite `checkout()` to create Stripe Checkout Session (paid) or direct license grant (free). Rewrite `handleWebhook()` to verify Stripe signature and fulfill on `checkout.session.completed`. | `server/packages/payment/src/service.ts`, `server/packages/payment/src/routes.ts` | Shared config, Prisma schema |
| **Auth package** | Rewrite Stripe onboard stub to create real Connect Express account + account link. Add return/refresh URL endpoints. Add webhook handler for `account.updated`. | `server/packages/auth/src/developer.routes.ts` | Shared config, Prisma schema |
| **Server entry** | Adjust raw body parsing for webhook route, add Connect webhook route | `server/src/index.ts` | Payment + Auth packages |
| **Web Storefront** | Change checkout flow: redirect to Stripe Checkout URL instead of instant purchase. Add success/cancel pages. Update types. | `web/src/stores/libraryStore.ts`, `web/src/pages/GameDetail.tsx`, new `web/src/pages/CheckoutSuccess.tsx`, `web/src/types.ts`, `web/src/App.tsx` | Payment API changes |
| **Dev Portal** | Add Stripe onboarding UI to SetupDeveloper and Dashboard. Show onboarding status, payout readiness. | `dev-portal/src/pages/SetupDeveloper.tsx`, `dev-portal/src/pages/Dashboard.tsx`, `dev-portal/src/stores/authStore.ts` | Auth API changes |
| **VPS/Infra** | Add Stripe env vars to VPS `.env`, configure Stripe webhook endpoint in Stripe Dashboard, install `stripe` npm package | VPS `.env`, `server/package.json` | Stripe account setup |

---

## 3. Implementation Order

### Step 1: Install Stripe SDK and update config
- **What:** Add `stripe` npm package to server. Make `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` required in production. Add new env vars for Connect return/refresh URLs.
- **Files:**
  - `server/package.json` (add `stripe` dependency)
  - `server/packages/shared/src/config.ts` (add env vars)
- **Prereqs:** None
- **Complexity:** Small

### Step 2: Prisma schema migration
- **What:** Add `stripeCheckoutSessionId` (String?, unique) to Payment model. Add `stripePayoutsEnabled` (Boolean, default false) to Developer model.
- **Files:**
  - `server/prisma/schema.prisma`
- **Prereqs:** None
- **Complexity:** Small
- **Migration name:** `add-stripe-checkout-session-and-payouts`

### Step 3: Rewrite payment service for Stripe Checkout
- **What:** Split `checkout()` into two paths:
  - **Free games (priceCents === 0):** Keep current behavior -- create Payment (COMPLETED) + License (ACTIVE) atomically, return immediately. No Stripe involved.
  - **Paid games:** Create a PENDING Payment record, then create a Stripe Checkout Session with `mode: 'payment'`, `payment_intent_data.application_fee_amount` (1% fee), `payment_intent_data.transfer_data.destination` (developer's `stripeAccountId`), `success_url`, `cancel_url`, `metadata` (paymentId, gameId, userId). Return the Checkout Session URL to the frontend. Do NOT create a License yet.
- **What (webhook):** Implement `handleWebhook()` to:
  1. Verify signature with `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)`
  2. Handle `checkout.session.completed`: look up Payment by `stripeCheckoutSessionId`, update Payment to COMPLETED, create License (ACTIVE), store `stripePaymentIntentId`
  3. Handle `checkout.session.expired`: update Payment to FAILED
  4. Return 200 to Stripe
- **Files:**
  - `server/packages/payment/src/service.ts` (rewrite both functions)
  - `server/packages/payment/src/routes.ts` (update checkout response shape, ensure raw body on webhook route)
- **Prereqs:** Steps 1-2
- **Complexity:** Large

### Step 4: Fix raw body parsing for webhooks
- **What:** The current `server/src/index.ts` already has `express.raw()` for the webhook path, but verify it actually passes a Buffer (not parsed JSON) to the route handler. The current line `app.post("/api/payments/webhook", express.raw({ type: "application/json" }))` should work, but the route handler in `routes.ts` needs to receive `req.body` as a Buffer. Confirm `express.json()` does not also parse it (it shouldn't since `express.raw` runs first on that path).
- **Files:**
  - `server/src/index.ts` (verify, possibly adjust)
  - `server/packages/payment/src/routes.ts` (ensure `req.body` is treated as Buffer)
- **Prereqs:** Step 3
- **Complexity:** Small

### Step 5: Implement Stripe Connect developer onboarding
- **What:** Replace the stub in `developer.routes.ts`:
  1. `GET /api/developer/stripe/onboard`: If developer has no `stripeAccountId`, create an Express account via `stripe.accounts.create({ type: 'express' })`, save the account ID to the Developer record. Then create an Account Link via `stripe.accountLinks.create()` with `return_url` and `refresh_url`. Return the link URL.
  2. `GET /api/developer/stripe/onboard/return`: Return page endpoint -- check account status via `stripe.accounts.retrieve()`, update `stripeOnboarded` and `stripePayoutsEnabled` based on `charges_enabled` and `payouts_enabled`. Redirect to dev portal dashboard.
  3. `GET /api/developer/stripe/onboard/refresh`: Generate a new Account Link (in case the previous one expired) and redirect to it.
- **Files:**
  - `server/packages/auth/src/developer.routes.ts` (rewrite onboard endpoint, add return/refresh endpoints)
- **Prereqs:** Steps 1-2
- **Complexity:** Medium

### Step 6: Add Connect webhook for account updates
- **What:** Handle `account.updated` Stripe event to keep `stripeOnboarded` / `stripePayoutsEnabled` in sync. This catches cases where a developer completes onboarding asynchronously or gets their account restricted.
- **Files:**
  - `server/packages/auth/src/developer.routes.ts` (add webhook handler)
  - `server/src/index.ts` (add raw body route for `/api/developer/stripe/webhook`, mount it)
- **Prereqs:** Step 5
- **Complexity:** Medium
- **Note:** This could share the same webhook endpoint as payments (single `/api/stripe/webhook` with event routing), or be a separate endpoint. Recommend a single endpoint to simplify Stripe Dashboard config. If consolidating, move webhook handling to a shared location or the payment package.

**Decision: Single webhook endpoint.** Use one `POST /api/payments/webhook` endpoint. The handler inspects `event.type` and routes to payment fulfillment or account update logic accordingly. This means the account update logic lives in (or is called from) the payment service.

### Step 7: Guard paid game publishing against Stripe onboarding
- **What:** When a developer tries to publish a paid game (priceCents > 0), verify their `stripeOnboarded` is true and `stripeAccountId` exists. If not, return a 400 error telling them to complete Stripe onboarding first. Free games can be published without Stripe.
- **Files:**
  - `server/packages/catalog/src/service.ts` or `server/packages/catalog/src/routes.ts` (wherever game status is set to PUBLISHED)
- **Prereqs:** Step 5
- **Complexity:** Small

### Step 8: Update web storefront checkout flow
- **What:** Change the checkout flow from "instant purchase" to "redirect to Stripe":
  1. **`libraryStore.ts`:** Change `checkout()` to:
     - For free games: API returns `{ free: true, licenseId, ... }` -- re-fetch licenses as before
     - For paid games: API returns `{ checkoutUrl: "https://checkout.stripe.com/..." }` -- redirect `window.location.href` to that URL
  2. **`types.ts`:** Update `ApiCheckoutResult` to include `checkoutUrl?: string` and `free?: boolean`
  3. **`GameDetail.tsx`:** Handle the redirect. The purchase button calls `checkout()` which either re-fetches licenses (free) or redirects (paid). Remove the `checkoutLoading` spinner for paid games since user leaves the page.
  4. **New `CheckoutSuccess.tsx`:** Success page at `/#/checkout/success?game=<slug>`. Shows "Payment confirmed!" message, re-fetches licenses, links to game detail/library. Stripe redirects here after successful payment.
  5. **New `CheckoutCancel.tsx`:** Cancel page at `/#/checkout/cancel`. Shows "Payment cancelled" with link back to store.
  6. **`App.tsx`:** Add routes for `/checkout/success` and `/checkout/cancel`
- **Files:**
  - `web/src/stores/libraryStore.ts`
  - `web/src/types.ts`
  - `web/src/pages/GameDetail.tsx`
  - `web/src/pages/CheckoutSuccess.tsx` (new)
  - `web/src/pages/CheckoutCancel.tsx` (new)
  - `web/src/App.tsx` (add routes)
- **Prereqs:** Step 3
- **Complexity:** Medium

**Important: Stripe Checkout `success_url` and HashRouter.** Stripe's `success_url` doesn't understand hash routes. The success URL must be a real URL like `http://204.168.133.38/#/checkout/success?session_id={CHECKOUT_SESSION_ID}`. Since the hash part is not sent to the server (it's client-side), this should work: Stripe redirects the browser to the full URL including the hash fragment. Test this explicitly.

### Step 9: Update dev portal for Stripe onboarding
- **What:**
  1. **`SetupDeveloper.tsx`:** After developer profile creation, show a "Connect with Stripe" button that calls `GET /api/developer/stripe/onboard` and redirects to the returned URL.
  2. **`Dashboard.tsx`:** Show Stripe onboarding status. If not onboarded, show a banner/card with "Complete Stripe Setup" CTA. If onboarded, show a green checkmark. Add a stat card for revenue (future, placeholder for now).
  3. **`authStore.ts`:** The Developer interface already has `stripeOnboarded`. Add `stripePayoutsEnabled` to match the new schema field. Load these from `/developer/profile`.
- **Files:**
  - `dev-portal/src/pages/SetupDeveloper.tsx`
  - `dev-portal/src/pages/Dashboard.tsx`
  - `dev-portal/src/stores/authStore.ts`
- **Prereqs:** Step 5
- **Complexity:** Medium

### Step 10: Seed data and local testing setup
- **What:** Update seed script so the seeded developer has `stripeAccountId: null`, `stripeOnboarded: false`. This is already the default, but verify. Add a note in the seed file that local dev testing requires Stripe test mode keys in `.env`.
- **Files:**
  - `server/prisma/seed.ts` (verify/update)
  - `server/.env.example` (add Stripe vars)
- **Prereqs:** Steps 1-2
- **Complexity:** Small

### Step 11: VPS deployment
- **What:**
  1. Add Stripe env vars to VPS `.env`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plus Connect return/refresh URLs pointing to `http://204.168.133.38/dev/#/dashboard`
  2. Run `npm install` on VPS to get `stripe` package
  3. Run Prisma migration on VPS
  4. Register webhook endpoint `http://204.168.133.38/api/payments/webhook` in Stripe Dashboard for events: `checkout.session.completed`, `checkout.session.expired`, `account.updated`
  5. Rebuild frontends, restart API
- **Prereqs:** All previous steps
- **Complexity:** Medium

---

## 4. Data Model Changes

### Payment model -- add field:
```prisma
stripeCheckoutSessionId String? @unique @map("stripe_checkout_session_id")
```

### Developer model -- add field:
```prisma
stripePayoutsEnabled Boolean @default(false) @map("stripe_payouts_enabled")
```

### Migration name: `add-stripe-checkout-session-and-payouts`

### Seed data: No changes required (defaults are already correct). Verify seed developer has `stripeOnboarded: false` and `stripeAccountId: null` (already the case).

---

## 5. API Changes

### Modified: `POST /api/payments/checkout`
- **Auth:** Required (authenticate middleware)
- **Request body:** `{ gameId: string }` (unchanged)
- **Response (free game):** `201 Created`
  ```json
  {
    "free": true,
    "paymentId": "uuid",
    "licenseId": "uuid",
    "gameId": "uuid",
    "gameTitle": "Pixel Racing"
  }
  ```
- **Response (paid game):** `201 Created`
  ```json
  {
    "free": false,
    "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
    "paymentId": "uuid",
    "gameId": "uuid",
    "gameTitle": "Space Explorer"
  }
  ```
- **Error (developer not onboarded):** `400 Bad Request`
  ```json
  { "message": "This game's developer has not completed payment setup" }
  ```
- **Package:** `payment`

### Modified: `POST /api/payments/webhook`
- **Auth:** None (Stripe sends this). Signature verified via `stripe-signature` header.
- **Body:** Raw buffer (already configured in `index.ts`)
- **Events handled:**
  - `checkout.session.completed` -- fulfill order (Payment COMPLETED, create License)
  - `checkout.session.expired` -- mark Payment FAILED
  - `account.updated` -- update Developer `stripeOnboarded` / `stripePayoutsEnabled`
- **Response:** `200 { received: true }`
- **Package:** `payment`

### Modified: `GET /api/developer/stripe/onboard`
- **Auth:** Required (authenticate + requireRole DEVELOPER)
- **Response (not yet onboarded):**
  ```json
  { "url": "https://connect.stripe.com/setup/s/..." }
  ```
- **Response (already onboarded):**
  ```json
  { "status": "already_onboarded" }
  ```
- **Package:** `auth`

### New: `GET /api/developer/stripe/onboard/return`
- **Auth:** Required (authenticate + requireRole DEVELOPER)
- **Behavior:** Checks account status with Stripe, updates Developer record, redirects to dev portal dashboard
- **Response:** `302 Redirect` to dev portal
- **Package:** `auth`

### New: `GET /api/developer/stripe/onboard/refresh`
- **Auth:** Required (authenticate + requireRole DEVELOPER)
- **Behavior:** Creates new Account Link (for expired links), redirects to Stripe
- **Response:** `302 Redirect` to Stripe
- **Package:** `auth`

### Modified: `GET /api/developer/profile`
- **Response:** Now includes `stripePayoutsEnabled` field in addition to existing `stripeOnboarded`
- **Package:** `auth`

---

## 6. Frontend Changes

### Web Storefront

**`web/src/types.ts`:**
- Update `ApiCheckoutResult`:
  ```typescript
  export interface ApiCheckoutResult {
    free: boolean;
    checkoutUrl?: string;   // only for paid games
    paymentId: string;
    licenseId?: string;     // only for free games (granted immediately)
    gameId: string;
    gameTitle: string;
  }
  ```

**`web/src/stores/libraryStore.ts`:**
- Update `checkout()`:
  - If response has `free: true`, re-fetch licenses as before
  - If response has `checkoutUrl`, set `window.location.href = result.checkoutUrl` to redirect to Stripe
  - No longer need to re-fetch licenses for paid games (webhook handles fulfillment)

**`web/src/pages/GameDetail.tsx`:**
- `handlePurchase` now handles redirect case. The `checkoutLoading` state still applies (shows "Processing..." until redirect or free purchase completes).
- No major structural changes needed -- the redirect happens inside `checkout()`.

**`web/src/pages/CheckoutSuccess.tsx` (new):**
- Read `session_id` from URL query params (via HashRouter, this is in the hash portion)
- Show "Payment successful! Your game has been added to your library."
- Call `fetchLicenses()` on mount to refresh the library
- Link to library page and back to game detail
- Handle race condition: webhook might not have fired yet when user arrives. Poll `fetchLicenses()` with a short retry (e.g., 3 attempts, 2s apart) until the new license appears, or show "Processing your purchase..." with a spinner.

**`web/src/pages/CheckoutCancel.tsx` (new):**
- Simple page: "Purchase cancelled. No charge was made."
- Link back to store

**`web/src/App.tsx`:**
- Add `<Route path="/checkout/success" element={<CheckoutSuccess />} />`
- Add `<Route path="/checkout/cancel" element={<CheckoutCancel />} />`

### Dev Portal

**`dev-portal/src/stores/authStore.ts`:**
- Add `stripePayoutsEnabled: boolean` to `Developer` interface
- No other changes (already loads developer profile on login)

**`dev-portal/src/pages/Dashboard.tsx`:**
- Add a Stripe status banner at the top (above stats row):
  - If `!developer.stripeOnboarded`: Yellow banner -- "Complete Stripe setup to receive payments for your games." with a "Connect with Stripe" button that calls `GET /api/developer/stripe/onboard` and redirects to the returned URL.
  - If `developer.stripeOnboarded && !developer.stripePayoutsEnabled`: Orange banner -- "Your Stripe account is connected but payouts are not yet enabled. Please complete verification in your Stripe dashboard."
  - If both true: Green badge -- "Stripe Connected" (subtle, not a banner)

**`dev-portal/src/pages/SetupDeveloper.tsx`:**
- After successful developer registration, show a second step: "Connect with Stripe to start receiving payments." with a button. This is optional (they can do it later from the Dashboard), but good UX to present it immediately.
- The button calls `GET /api/developer/stripe/onboard` and redirects.

### Electron Client
- No changes needed now. The client doesn't handle purchases -- it only downloads games the user already owns (via license verification).

---

## 7. Infrastructure Changes

### New environment variables (add to both local `.env` and VPS `.env`):

```env
# Stripe (required in production)
STRIPE_SECRET_KEY=sk_test_...              # existing but currently optional
STRIPE_WEBHOOK_SECRET=whsec_...            # existing but currently optional
STRIPE_CONNECT_RETURN_URL=http://204.168.133.38/api/developer/stripe/onboard/return
STRIPE_CONNECT_REFRESH_URL=http://204.168.133.38/api/developer/stripe/onboard/refresh
```

### Config changes (`server/packages/shared/src/config.ts`):
```typescript
STRIPE_SECRET_KEY: z.string().min(1),                          // make required
STRIPE_WEBHOOK_SECRET: z.string().min(1),                      // make required
STRIPE_CONNECT_RETURN_URL: z.string().url().optional(),        // new
STRIPE_CONNECT_REFRESH_URL: z.string().url().optional(),       // new
```

**Note:** Keep Stripe keys optional in the Zod schema but add a runtime check in the payment service -- this avoids breaking local dev if someone doesn't have Stripe keys set up. The checkout function should throw a clear error ("Stripe is not configured") if keys are missing when a paid checkout is attempted.

### Stripe Dashboard configuration:
1. Enable Stripe Connect in the Stripe Dashboard
2. Set platform branding (BoilerDeck name, logo)
3. Register webhook endpoint: `http://204.168.133.38/api/payments/webhook`
4. Subscribe to events: `checkout.session.completed`, `checkout.session.expired`, `account.updated`
5. Note the webhook signing secret and add to VPS `.env`

### nginx:
- No changes needed. The `/api/` proxy already forwards all subpaths to the Node server.

### VPS deploy commands:
```bash
ssh root@204.168.133.38 "cd /opt/boilerdeck && git pull origin main && npm install"
ssh root@204.168.133.38 "cd /opt/boilerdeck && npx prisma migrate deploy --schema server/prisma/schema.prisma"
ssh root@204.168.133.38 "cd /opt/boilerdeck && npx vite build web && npx vite build dev-portal"
ssh root@204.168.133.38 "systemctl restart boilerdeck"
```

---

## 8. Testing Checkpoints

### After Step 2 (schema migration):
```bash
cd /c/Users/eface/peerplay && npm run db:migrate
# Verify: npx prisma studio -- check Payment has stripeCheckoutSessionId column, Developer has stripePayoutsEnabled
```

### After Step 3 (payment service rewrite):
```bash
# Free game checkout (should still work instantly):
curl -X POST http://localhost:3001/api/payments/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <player-token>" \
  -d '{"gameId":"<free-game-id>"}'
# Expect: { "free": true, "licenseId": "...", ... }

# Paid game checkout (requires Stripe test keys in .env):
curl -X POST http://localhost:3001/api/payments/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <player-token>" \
  -d '{"gameId":"<paid-game-id>"}'
# Expect: { "free": false, "checkoutUrl": "https://checkout.stripe.com/...", ... }
```

### After Step 4 (webhook):
```bash
# Use Stripe CLI for local webhook testing:
stripe listen --forward-to localhost:3001/api/payments/webhook
# Then trigger a test checkout via Stripe CLI or browser
# Verify: Payment status updated to COMPLETED, License created
```

### After Step 5 (Connect onboarding):
```bash
# As developer user:
curl http://localhost:3001/api/developer/stripe/onboard \
  -H "Authorization: Bearer <developer-token>"
# Expect: { "url": "https://connect.stripe.com/setup/..." }
```

### After Step 8 (web storefront):
- Open `http://localhost:5173` in browser
- Log in as player
- Click "Buy Now" on a paid game -- should redirect to Stripe Checkout
- Complete purchase with test card `4242 4242 4242 4242` -- should redirect to success page
- Check library -- game should appear
- Click "Get for Free" on a free game -- should add to library instantly (no redirect)

### After Step 9 (dev portal):
- Open `http://localhost:5174` in browser
- Log in as developer
- Should see Stripe onboarding banner on Dashboard
- Click "Connect with Stripe" -- should redirect to Stripe Connect onboarding flow

---

## 9. Risks & Gotchas

### HashRouter + Stripe success_url
Stripe's `success_url` supports `{CHECKOUT_SESSION_ID}` template variable. But the storefront uses HashRouter (`/#/checkout/success`). The hash fragment IS sent in redirects (browsers preserve it), so `http://204.168.133.38/#/checkout/success?session_id={CHECKOUT_SESSION_ID}` should work. However, test this explicitly -- if Stripe strips the hash, the fallback is to use a real server-side redirect route (`GET /api/checkout/success?session_id=...`) that redirects to the hash URL.

**Update:** Stripe's `success_url` template variable `{CHECKOUT_SESSION_ID}` is replaced server-side before the redirect, so the URL becomes `http://204.168.133.38/#/checkout/success?session_id=cs_test_abc123`. The `?session_id=...` after the hash is parsed by the client-side router as a query param within the hash route. This should work with React Router's `useSearchParams()`. Verify in testing.

### Webhook idempotency
Stripe may send the same webhook event multiple times. The webhook handler must be idempotent:
- Check if Payment is already COMPLETED before creating a License
- Use `stripeCheckoutSessionId` uniqueness to prevent duplicate processing
- Wrap fulfillment in a transaction

### Webhook race condition with success page
The user may arrive at the success page before the webhook fires (Stripe sends webhooks asynchronously). The success page should poll for the license rather than assuming it exists immediately.

### Developer not onboarded
If a developer hasn't completed Stripe onboarding, their games cannot be purchased. Two enforcement points:
1. **Publish guard (Step 7):** Prevent publishing paid games without Stripe setup
2. **Checkout guard (Step 3):** Even if a game is somehow published, the checkout endpoint should check the developer's `stripeAccountId` exists before creating a Checkout Session

### Raw body for webhook verification
Stripe webhook signature verification requires the raw request body (not JSON-parsed). The current `server/src/index.ts` already has `express.raw()` registered for the webhook path BEFORE `express.json()`. This should work, but verify that `req.body` is a Buffer in the webhook handler, not a parsed object.

### Stripe Connect Express account limitations
- Express accounts are managed by the platform (BoilerDeck). The developer interacts with a Stripe-hosted dashboard for their payouts.
- Stripe takes its own processing fee (typically 2.9% + 30c) ON TOP of BoilerDeck's 1% platform fee. This means the developer actually receives ~96% of the sale price, not 99%. The "99/1 revenue split" in marketing refers to BoilerDeck's cut vs developer's cut, but Stripe processing fees are separate. This should be disclosed clearly.
- Alternative: absorb Stripe fees into the 1% platform fee. This only works if Stripe fees are less than 1% of the sale price, which they won't be for games under ~$100. Recommend keeping them separate and being transparent.

### Local development without Stripe keys
Keep Stripe keys optional in the config schema. The payment service should check for their presence and throw a clear error if a paid checkout is attempted without them. Free game checkout should work without Stripe keys. This lets devs work on unrelated features without needing Stripe test keys.

### CORS for Stripe redirects
Stripe Checkout is a full-page redirect, not an API call, so CORS is not an issue. The redirect back to the success/cancel URL is a normal browser navigation.

### Existing mock payments in the database
After migration, existing Payment records will have `stripeCheckoutSessionId: null` and `status: COMPLETED`. This is fine -- they represent the mock purchases from before Stripe integration. No data migration needed.

### Port 3000 conflict
No impact -- Stripe communicates over HTTPS to stripe.com. The local Stripe CLI (`stripe listen`) uses its own port.

### Test mode vs live mode
All development and initial deployment should use Stripe test mode keys (`sk_test_...`, `pk_test_...`). Switch to live mode only after end-to-end testing is complete. Test mode and live mode use separate webhook signing secrets.
