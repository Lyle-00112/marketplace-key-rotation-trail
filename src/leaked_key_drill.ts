import { randomUUID } from "node:crypto";
import { createInfraiMarketplaceClient } from "./infrai_marketplace_client.js";

async function runDrill(): Promise<void> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the drill");

  const client = createInfraiMarketplaceClient(apiKey);
  const incidentId = `inc_${randomUUID().replaceAll("-", "")}`;
  const created = await client.infrai.account.keys.create({
    name: `marketplace-drill-${incidentId}`,
    scopes: ["logs:write", "logs:read"],
    idempotency_key: `create:${incidentId}`,
  });

  // Store created.key_secret now: the plaintext value is shown only in this response.
  console.log(JSON.stringify({ incidentId, temporaryKeyId: created.key_id, plaintextCaptured: Boolean(created.key_secret) }));

  try {
    await client.infrai.account.keys.suspected_compromise(created.key_id, {
      confirmed_leak: true,
      auto_rotate: false,
    });
    const rotated = await client.infrai.account.keys.rotate(created.key_id, {
      grace_hours: 1,
      idempotency_key: `rotate:${incidentId}`,
    });
    const audit = await client.infrai.logs.search({
      q: incidentId,
      service: "marketplace-order-handoff",
      trace_id: incidentId,
      limit: 100,
    });
    console.log(JSON.stringify({ incidentId, rotated: Boolean(rotated), audit }, null, 2));
  } finally {
    await client.infrai.account.keys.revoke(created.key_id);
  }
}

runDrill().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
