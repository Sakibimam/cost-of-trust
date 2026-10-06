import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { env, loadEnv } from "./config.ts";
import { createReport } from "./report.ts";
loadEnv();

const run = (args: string[]) => new Promise<string>((resolve, reject) => {
  const child = spawn("sokosumi", ["--preprod", ...args, "--json"], { env: process.env });
  let out = "", err = ""; child.stdout.on("data", (x) => out += x); child.stderr.on("data", (x) => err += x);
  child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(err || `sokosumi exited ${code}`)));
});

async function once(): Promise<void> {
  const coworker = env("SOKOSUMI_COWORKER_ID"); if (!coworker) throw new Error("SOKOSUMI_COWORKER_ID is required");
  const raw = await run(["tasks", "list", "--personal"]);
  const parsed = JSON.parse(raw) as Array<Record<string, unknown>> | { tasks?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks ?? parsed.data ?? [];
  for (const task of tasks.filter((item) => item.status === "READY" && item.coworkerId === coworker)) {
    const id = String(task.id); await run(["runtime", "start", id, "--coworker-id", coworker, "--personal"]);
    const input = typeof task.description === "string" ? task.description : String(task.input ?? "");
    const report = await createReport(JSON.parse(input));
    const file = `result-${id}.txt`; await writeFile(file, JSON.stringify(report, null, 2));
    await run(["runtime", "complete", id, "--coworker-id", coworker, "--personal", "--result-file", file]);
  }
}

async function main(): Promise<void> { await once(); setInterval(() => once().catch((error) => console.error(error.message)), Number(env("POLL_SECONDS", "60")) * 1000); }
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
