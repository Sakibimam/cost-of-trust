import { preview } from "./preview";

export const runtime = "nodejs";

const headers = { "access-control-allow-origin": "*", "cache-control": "public, max-age=60, s-maxage=3600" };

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { status, body } = preview({ agent: params.get("agent"), valueAda: params.get("valueAda"), deadlineMinutes: params.get("deadlineMinutes") });
  return Response.json(body, { status, headers: status === 200 ? headers : { "access-control-allow-origin": "*" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS" } });
}
