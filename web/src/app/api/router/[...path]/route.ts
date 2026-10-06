import { handle } from "@/server/router/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function route(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(request, `/${path.join("/")}`);
}

export { route as GET, route as POST, route as OPTIONS };
