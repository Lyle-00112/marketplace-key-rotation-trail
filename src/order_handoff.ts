import { createHash } from "node:crypto";
import { z } from "zod";
import type { InfraiMarketplaceClient } from "./infrai_marketplace_client.js";

export const handoffBodySchema = z.object({
  incidentId: z.string().regex(/^inc_[a-zA-Z0-9_-]{3,64}$/),
  orderId: z.string().min(3).max(80),
  seller: z.object({
    sellerId: z.string().min(3).max(80),
    assets: z.array(z.object({
      sku: z.string().min(1).max(80),
      revision: z.number().int().positive(),
      ready: z.boolean(),
    })).min(1),
  }),
  buyer: z.object({
    buyerId: z.string().min(3).max(80),
    updates: z.array(z.object({
      sku: z.string().min(1).max(80),
      acceptedRevision: z.number().int().nonnegative(),
    })),
  }),
});

export type HandoffBody = z.infer<typeof handoffBodySchema>;

export type HandoffDecision = {
  orderId: string;
  state: "handed_off" | "waiting_for_buyer";
  acceptedSkus: string[];
  pendingSkus: string[];
};

export function decideHandoff(input: HandoffBody): HandoffDecision {
  const acceptedBySku = new Map(input.buyer.updates.map((update) => [update.sku, update.acceptedRevision]));
  const acceptedSkus = input.seller.assets
    .filter((asset) => asset.ready && acceptedBySku.get(asset.sku) === asset.revision)
    .map((asset) => asset.sku);
  const pendingSkus = input.seller.assets
    .filter((asset) => !acceptedSkus.includes(asset.sku))
    .map((asset) => asset.sku);

  return {
    orderId: input.orderId,
    state: pendingSkus.length === 0 ? "handed_off" : "waiting_for_buyer",
    acceptedSkus,
    pendingSkus,
  };
}

export async function recordHandoff(
  input: HandoffBody,
  client: InfraiMarketplaceClient,
): Promise<{ decision: HandoffDecision; audit: unknown }> {
  const decision = decideHandoff(input);
  const idempotencyKey = createHash("sha256")
    .update(`${input.incidentId}:${input.orderId}:${decision.state}`)
    .digest("hex");

  await client.infrai.logs.ingest({
    entries: [{
      timestamp: new Date().toISOString(),
      level: decision.state === "handed_off" ? "info" : "warn",
      service: "marketplace-order-handoff",
      environment: process.env.NODE_ENV ?? "development",
      trace_id: input.incidentId,
      message: `marketplace order ${decision.state}`,
      metadata: {
        order_id: input.orderId,
        seller_id: input.seller.sellerId,
        buyer_id: input.buyer.buyerId,
        accepted_skus: decision.acceptedSkus.join(","),
        pending_skus: decision.pendingSkus.join(","),
      },
    }],
    idempotency_key: idempotencyKey,
  });

  const audit = await client.infrai.logs.search({
    q: input.orderId,
    service: "marketplace-order-handoff",
    trace_id: input.incidentId,
    limit: 25,
  });
  return { decision, audit };
}
