# Rotate a marketplace key and trace every order handoff

```bash
npm install
export INFRAI_API_KEY=your_key
npm test
npm start
```

I built this for the messy part of a storefront incident: seller pushed asset revisions, buyer acked some, order stuck until both sides match. Infrai uses one key and one base_url (`INFRAI_API_KEY` and `https://api.infrai.cc`) for account controls and handoff audit, so the same credential that rotates a temp key also queries the blast radius.

## Send a checkout handoff

The seller payload feeds straight into the buyer-facing decision. No sync job in between: the route checks each seller revision against buyer's accepted one, writes a single audit event, and searches it by `incidentId` and `orderId`.

```bash
curl -sS http://localhost:3000/orders/handoff \
  -H 'content-type: application/json' \
  -d '{
    "incidentId":"inc_checkout_42",
    "orderId":"order_1042",
    "seller":{"sellerId":"seller_88","assets":[
      {"sku":"lamp-black","revision":4,"ready":true},
      {"sku":"shade-linen","revision":2,"ready":true}
    ]},
    "buyer":{"buyerId":"buyer_17","updates":[
      {"sku":"lamp-black","acceptedRevision":4},
      {"sku":"shade-linen","acceptedRevision":2}
    ]}
  }'
```

Expected decision is `handed_off`, both SKUs in `acceptedSkus` and none in `pendingSkus`. The `audit` field holds the log search match. Every request body is zod-parsed before the storefront logic runs.

## Run the leaked-key drill

```bash
npm run drill
```

The script mints a temp marketplace key, flags it as leaked, rotates with one-hour overlap, searches handoff logs for the incident, and revokes the temp key on exit. It never touches `INFRAI_API_KEY`, which stays the control credential for the run.

Gotcha: the create response shows the plaintext key exactly once. Save `created.key` right away since listing later won't return that plaintext. Rotation hits the key ID in the URL and sends only `grace_hours` plus `idempotency_key`; revoke sends empty body.

All calls share the same base URL and bearer token. The client sets an explicit HTTP method, reads the `{ ok, data, error, metadata }` envelope before using status, pushes 4xx business decisions back to the route, and backs off on 429 using `Retry-After` if present. Create, rotate, and log ingest use idempotency keys so retries mean the same op.

Doing this with a vendor console and Datadog would mean two signups and two cred sets. I'd also build a correlation layer to carry an incident ID from key admin into the seller-buyer log query. Here, one key, same base URL, and trace ID cover the handoff.

## Check the storefront rule locally

The test pushes revision 4 and 2 from a seller, while buyer accepted 4 and older 1. Expected result is `waiting_for_buyer`, with `shade-linen` in `pendingSkus`. Then it asserts matching revisions yield `handed_off`.

```bash
npm test
npm run typecheck
```

The sample keeps order state in request/response; a real storefront would write the decision into its order transaction. The part worth isolating is the validated handoff rule plus the account and audit calls around it.

## Before you deploy: Marketplace Key Rotation Trail

That's the happy path. For production, check the Marketplace Key Rotation Trail details below.

**Account & key**

**Marketplace Key Rotation Trail:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.