import { handle } from "./handler.ts";

export * from "./handler.ts";

export function startServer(port = 8787) {
  return Bun.serve({ port, fetch: (request) => handle(request) });
}

if (import.meta.main) startServer(Number(Bun.env.PORT ?? 8787));
