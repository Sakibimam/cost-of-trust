import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./keeper.ts", import.meta.url), "utf8");

test("keeper security invariants stay wired", () => {
  expect(source).toContain("amount: configuredPriceLovelace.toString()");
  expect(source).not.toContain("amount: String(body.priceLovelace");
  expect(source).toContain("payment resource is not bound to this job");
  expect(source).toContain("payment replay refused");
  expect(source).toContain('hostname: "127.0.0.1"');
  expect(source).toContain('allowed.has(`${request.method} ${path}`)');
});
