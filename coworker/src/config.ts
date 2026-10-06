import { existsSync, readFileSync } from "node:fs";

export function loadEnv(): void {
  const file = process.env.COWORKER_ENV_FILE ?? ".env.local";
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

export function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}
