import express from "express";
import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { createInfraiMarketplaceClient, InfraiError } from "./infrai_marketplace_client.js";
import { handoffBodySchema, recordHandoff } from "./order_handoff.js";

export function buildStorefrontService(apiKey: string) {
  const app = express();
  const client = createInfraiMarketplaceClient(apiKey);
  app.use(express.json({ limit: "32kb" }));

  app.post("/orders/handoff", async (request, response) => {
    try {
      const body = handoffBodySchema.parse(request.body);
      const result = await recordHandoff(body, client);
      response.status(result.decision.state === "handed_off" ? 200 : 202).json(result);
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({ error: "invalid handoff", issues: error.issues });
        return;
      }
      const status = error instanceof InfraiError && error.status >= 400 && error.status < 500
        ? error.status
        : 502;
      response.status(status).json({ error: error instanceof Error ? error.message : "handoff failed" });
    }
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
  const port = Number(process.env.PORT ?? 3000);
  buildStorefrontService(apiKey).listen(port, () => {
    console.log(`Storefront handoff listening on http://localhost:${port}`);
  });
}
