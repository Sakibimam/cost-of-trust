import { describe, expect, test } from "bun:test";
import { GET } from "./route";
import { agentNames } from "./names";

const call = async (query: string) => {
  const started = performance.now();
  const response = await GET(new Request(`https://example.test/api/check?${query}`));
  return { response, body: await response.json() as Record<string, any>, ms: performance.now() - started };
};

describe("free preview /api/check", () => {
  test("Knight is not worth hiring and the answer is fast", async () => {
    const { response, body, ms } = await call("agent=Knight&valueAda=500");
    expect(response.status).toBe(200);
    expect(body.decision).toBe("do_not_hire");
    expect(body.history).toMatchObject({ paid: 42, refunded: 251, disputed: 0 });
    expect(body.options.map((o: { route: string }) => o.route)).toEqual(["single", "redundant", "staggered", "underwritten"]);
    expect(body.options.some((o: { selected: boolean }) => o.selected)).toBe(false);
    expect(ms).toBeLessThan(1000);
  });

  test("the dpa Research Agent with the most resolved escrows is picked and priced with the router's routes", async () => {
    const { body } = await call("agent=dpa%20research%20agent&valueAda=100&deadlineMinutes=15");
    expect(body.agent.identifier.endsWith("98d2187865ab")).toBe(true);
    expect(body.agent.otherMatches).toBe(1);
    expect(body.history).toMatchObject({ paid: 175, refunded: 51, medianSeconds: 109, p90Seconds: 194 });
    expect(body.options).toHaveLength(4);
    expect(body.withinDeadline).toMatchObject({ deadlineMinutes: 15, jobsMeasured: 178, jobsWithin: 177 });
    expect(body.sentence).toContain("175 of 226 past jobs delivered, median 109 s");
  });

  test("a clean agent with a tight deadline gets a backup decision and a selected option", async () => {
    const { body } = await call("agent=Web%20Single%20Answer&valueAda=100&deadlineMinutes=1");
    expect(body.decision).toBe("hire_with_backup_keeper");
    expect(body.selectedRoute).toBe("staggered");
    expect(body.options.filter((o: { selected: boolean }) => o.selected).map((o: { route: string }) => o.route)).toEqual(["staggered"]);
    expect(body.expectedCostAda).toBeGreaterThan(0);
    expect(body.sentence.startsWith("Hire Web Single Answer with a backup. Expected cost")).toBe(true);
  });

  test("an asset id resolves to the same agent as its name", async () => {
    const byName = (await call("agent=Knight&valueAda=5")).body;
    const byId = (await call(`agent=${byName.agent.identifier}&valueAda=5`)).body;
    expect(byId.agent.name).toBe("Knight");
    expect(byId.history).toEqual(byName.history);
  });

  test("an unknown name is a 404 with suggestions, and bad numbers are 400", async () => {
    const missing = await call("agent=Knigth%20Research&valueAda=5");
    expect(missing.response.status).toBe(404);
    expect(missing.body.suggestions.length).toBeGreaterThan(0);
    expect(missing.body.suggestions).toContain("Knight");
    expect((await call("agent=Knight&valueAda=abc")).response.status).toBe(400);
    expect((await call("agent=Knight&deadlineMinutes=0")).response.status).toBe(400);
    expect((await call("valueAda=5")).response.status).toBe(400);
  });

  test("the suggestion list is non-empty and unique", () => {
    const names = agentNames();
    expect(names.length).toBeGreaterThan(100);
    expect(new Set(names).size).toBe(names.length);
  });
});
