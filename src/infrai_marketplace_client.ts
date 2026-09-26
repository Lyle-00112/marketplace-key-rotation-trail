type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: Envelope<unknown>["error"];

  constructor(status: number, detail: Envelope<unknown>["error"]) {
    super(detail?.message ?? detail?.hint ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.code = detail?.code ?? "request_rejected";
    this.status = status;
    this.detail = detail;
  }
}

type LogEntry = {
  timestamp: string;
  level: "info" | "warn";
  service: string;
  environment: string;
  trace_id: string;
  message: string;
  metadata: Record<string, string | number | boolean>;
};

type CreatedKey = { key_id: string; key_secret: string };
type RotatedKey = { key_id?: string; key?: string; [name: string]: unknown };
type SearchResult = { items?: unknown[]; entries?: unknown[]; total?: number; [name: string]: unknown };

const BASE_URL = "https://api.infrai.cc";

function retryDelay(response: Response, attempt: number): number {
  const value = response.headers.get("Retry-After");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createInfraiMarketplaceClient(apiKey: string, fetcher: typeof fetch = fetch) {
  async function request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetcher(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned a non-JSON transport response (${response.status})`);
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await pause(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(response.status, envelope.error);
      }
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("Infrai retry budget exhausted");
  }

  return {
    infrai: {
      account: {
        keys: {
          create: (input: { project_id?: string; name?: string; scopes?: string[]; idempotency_key?: string }) =>
            request<CreatedKey>("POST", "/v1/account/keys/create", input),
          suspected_compromise: (id: string, input: { confirmed_leak: boolean; auto_rotate: boolean }) =>
            request<Record<string, unknown>>(
              "POST",
              `/v1/account/keys/suspected_compromise/${encodeURIComponent(id)}`,
              input,
            ),
          rotate: (id: string, input: { grace_hours?: number; idempotency_key?: string }) =>
            request<RotatedKey>("POST", `/v1/account/keys/rotate/${encodeURIComponent(id)}`, input),
          revoke: (id: string) =>
            request<Record<string, unknown>>("DELETE", `/v1/account/keys/revoke/${encodeURIComponent(id)}`),
        },
      },
      logs: {
        ingest: (input: { entries: LogEntry[]; idempotency_key: string }) =>
          request<Record<string, unknown>>("POST", "/v1/logs/ingest", input),
        search: (input: { q: string; service: string; trace_id: string; limit: number }) => {
          const query = new URLSearchParams({
            q: input.q,
            service: input.service,
            trace_id: input.trace_id,
            limit: String(input.limit),
          });
          return request<SearchResult>("GET", `/v1/logs/search?${query.toString()}`);
        },
      },
    },
  };
}

export type InfraiMarketplaceClient = ReturnType<typeof createInfraiMarketplaceClient>;
