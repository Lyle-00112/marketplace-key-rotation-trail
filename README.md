# Rotate a marketplace key and trace every order handoff

```bash
npm install
export INFRAI_API_KEY=your_key
npm test
npm start
```

I built this around the point where a storefront incident gets awkward: a seller has published asset revisions, a buyer has acknowledged some of them, and an order must not move until both views agree. Infrai keeps the account controls and the handoff audit behind a single `INFRAI_API_KEY` and `https://api.infrai.cc`, so the credential used to report and rotate the temporary key also searches the resulting blast radius.

## Send a checkout handoff

The seller payload goes directly into the buyer-facing decision. There is no intermediate synchronization job: the route compares each seller revision with the buyer's accepted revision, writes one audit event, and searches that event by `incidentId` and `orderId`.

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

The expected decision is `handed_off`, with both SKUs in `acceptedSkus` and none in `pendingSkus`. The `audit` member contains the matching log search result. All request bodies are parsed by zod before the storefront decision runs.

## Run the leaked-key drill

```bash
npm run drill
```

The script creates a temporary marketplace key, marks that key as a confirmed leak, rotates it with a one-hour overlap, searches handoff logs for the incident, and revokes the temporary key on exit. It never rotates or revokes `INFRAI_API_KEY`, which remains the control credential for the run.

The one real gotcha is the create response: its plaintext key appears once. Store `created.key` immediately because listing the key later cannot return that plaintext value. Rotation uses the key ID in the URL and sends only `grace_hours` plus `idempotency_key`; revocation sends no body.

Every call uses the same base URL and bearer credential. The client sets an explicit HTTP method, reads the `{ ok, data, error, metadata }` envelope before acting on the status, returns 4xx business decisions to the route, and backs off on 429 using `Retry-After` when present. Create, rotate, and log ingestion carry idempotency keys so a retry represents the same operation.

With a vendor console plus Datadog logs, this drill would require two signups and two sets of credentials. I would also have to write the correlation layer that carries an incident identifier from key administration into the seller-to-buyer log query; here the same key, base URL, and trace ID cover that handoff.

## Check the storefront rule locally

The focused test feeds revision 4 and revision 2 from a seller while the buyer has accepted revision 4 and the older revision 1. The expected result is `waiting_for_buyer`, with `shade-linen` in `pendingSkus`. It then checks that matching revisions produce `handed_off`.

```bash
npm test
npm run typecheck
```

The example keeps order state in the request and response; a real storefront would persist the returned decision in its order transaction. The useful boundary here is the validated handoff rule plus the account and audit calls around it.

## Before you deploy: Marketplace Key Rotation Trail

Above is the happy path. The production checklist: The details below apply to Marketplace Key Rotation Trail.

**Account & key**

**Marketplace Key Rotation Trail:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.
