const port = Number(process.env.SINK_PORT ?? 3919);
const evidence = new URL("../evidence/", import.meta.url).pathname;
await Bun.$`mkdir -p ${evidence}`;

Bun.serve({
  port,
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/report") return new Response("not found", { status: 404 });
    const report = await request.json() as { raw_report?: string; report_context?: string; sigs?: string[] };
    if (!/^[0-9a-f]+$/i.test(report.raw_report ?? "") || !/^[0-9a-f]+$/i.test(report.report_context ?? "") || !Array.isArray(report.sigs)) return Response.json({ error: "invalid report envelope" }, { status: 422 });
    const saved = { raw_report: report.raw_report, report_context: report.report_context, sigs: report.sigs };
    await Bun.write(`${evidence}/raw_report.json`, JSON.stringify(saved, null, 2));
    await Bun.write(`${evidence}/report_context.json`, JSON.stringify({ report_context: report.report_context }, null, 2));
    await Bun.write(`${evidence}/sigs.json`, JSON.stringify({ sigs: report.sigs }, null, 2));
    return Response.json({ accepted: true });
  },
});
console.log(`report sink listening on ${port}`);
