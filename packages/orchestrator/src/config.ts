import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCliRunner } from "./cli-runner.js";
import type { Runner } from "./runner.js";

export interface HackkitConfig {
  runner: "cli" | "sdk";
  claudeBin?: string;
}

/**
 * Lê hackkit.config.json na raiz; a variável HACKKIT_RUNNER sobrepõe o campo runner.
 * Sem arquivo e sem variável, o modo é "cli".
 */
export function loadConfig(root: string, env: NodeJS.ProcessEnv = process.env): HackkitConfig {
  const file = join(root, "hackkit.config.json");
  const fromFile: Partial<HackkitConfig> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const runner = env.HACKKIT_RUNNER ?? fromFile.runner ?? "cli";
  if (runner !== "cli" && runner !== "sdk") throw new Error(`runner inválido: ${runner} (use cli | sdk)`);
  return { ...fromFile, runner };
}

const sdkRunner: Runner = {
  run() {
    return Promise.reject(new Error("runner sdk ainda não implementado"));
  },
};

export function selectRunner(config: HackkitConfig, root: string): Runner {
  return config.runner === "sdk"
    ? sdkRunner
    : createCliRunner({ root, ...(config.claudeBin ? { claudeBin: config.claudeBin } : {}) });
}
