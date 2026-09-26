import assert from "node:assert/strict";
import test from "node:test";
import { decideHandoff, handoffBodySchema } from "../src/order_handoff.js";

test("holds the order until the buyer accepts every ready seller revision", () => {
  const input = handoffBodySchema.parse({
    incidentId: "inc_checkout_42",
    orderId: "order_1042",
    seller: {
      sellerId: "seller_88",
      assets: [
        { sku: "lamp-black", revision: 4, ready: true },
        { sku: "shade-linen", revision: 2, ready: true },
      ],
    },
    buyer: {
      buyerId: "buyer_17",
      updates: [
        { sku: "lamp-black", acceptedRevision: 4 },
        { sku: "shade-linen", acceptedRevision: 1 },
      ],
    },
  });

  assert.deepEqual(decideHandoff(input), {
    orderId: "order_1042",
    state: "waiting_for_buyer",
    acceptedSkus: ["lamp-black"],
    pendingSkus: ["shade-linen"],
  });
});

test("hands off when buyer updates match every seller asset revision", () => {
  const input = handoffBodySchema.parse({
    incidentId: "inc_checkout_43",
    orderId: "order_1043",
    seller: {
      sellerId: "seller_88",
      assets: [{ sku: "lamp-black", revision: 4, ready: true }],
    },
    buyer: {
      buyerId: "buyer_18",
      updates: [{ sku: "lamp-black", acceptedRevision: 4 }],
    },
  });

  assert.equal(decideHandoff(input).state, "handed_off");
});
