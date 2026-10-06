import { createServer } from "node:http";
import { createReport } from "./report.ts";
import { env, loadEnv } from "./config.ts";
loadEnv();

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.method === "GET" && request.url === "/health") { response.end(JSON.stringify({ ok: true, service: "trust-check" })); return; }
  if (request.method !== "POST" || request.url !== "/report") { response.statusCode = 404; response.end(JSON.stringify({ error: "not found" })); return; }
  try {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const report = await createReport(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.end(JSON.stringify(report));
  } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: error instanceof Error ? error.message : "request failed" })); }
});
server.listen(Number(env("PORT", "8788")), "127.0.0.1");
