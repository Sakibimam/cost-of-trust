# Masumi backup demo

This lane runs two MIP-003 URL-title agents and a buyer that purchases the primary through Masumi V2, waits for its buyer checkpoint, and purchases the fallback only when the primary has not submitted a result. The fallback run leaves the primary escrow to Masumi's timeout refund path.

Set `MPS_API_TOKEN` from `coworker/.env.local` and `KAIOS_KEY` from `recourse/.env.live` in the shell. The demo never prints either secret.

```sh
bun run masumi-backup/register.ts
PORT=4511 AGENT_ROLE=primary bun run masumi-backup/agents/server.ts
PORT=4512 AGENT_ROLE=backup bun run masumi-backup/agents/server.ts
```

Use `bun run masumi-backup/buyer.ts healthy` or `bun run masumi-backup/buyer.ts stall`.
