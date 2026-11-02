import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { shellExec, type Exec } from "./exec.js";
import type { Verifier } from "./spec.js";

export type VerifierStatus = "pass" | "fail" | "skipped";

export interface VerifierResult {
  kind: Verifier["kind"];
  status: VerifierStatus;
  detail: string;
  durationMs: number;
}

export interface VerifierContext {
  /** Diretório base de command e file_exists (padrão: process.cwd()). */
  cwd: string;
  /** Diretório do spec.yaml; o caminho de cada spec e2e é relativo a ele. */
  specDir: string;
  /** URL do deploy de preview para o e2e; sem ela o e2e fica "skipped". */
  baseUrl?: string;
  /** Comando que roda o Playwright (padrão: "pnpm exec playwright"). */
  playwrightCommand: string;
  exec: Exec;
}

const tail = (s: string, n = 2000) => (s.length > n ? s.slice(-n) : s);
const within = (base: string, p: string) => (isAbsolute(p) ? p : resolve(base, p));

export async function runVerifier(v: Verifier, ctx: VerifierContext): Promise<VerifierResult> {
  const t0 = Date.now();
  const done = (status: VerifierStatus, detail: string): VerifierResult => ({
    kind: v.kind,
    status,
    detail,
    durationMs: Date.now() - t0,
  });

  switch (v.kind) {
    case "command": {
      const cwd = v.cwd ? within(ctx.cwd, v.cwd) : ctx.cwd;
      const r = await ctx.exec(v.run, { cwd, timeoutMs: v.timeout_s ? v.timeout_s * 1000 : undefined });
      if (r.timedOut) return done("fail", `timeout após ${v.timeout_s} s`);
      return done(r.code === 0 ? "pass" : "fail", `exit ${r.code}\n${tail(r.stdout + r.stderr)}`);
    }
    case "file_exists": {
      const base = v.cwd ? within(ctx.cwd, v.cwd) : ctx.cwd;
      const paths = Array.isArray(v.path) ? v.path : [v.path];
      const missing = paths.filter((p) => !existsSync(within(base, p)));
      return missing.length === 0
        ? done("pass", `${paths.length} de ${paths.length} presentes`)
        : done("fail", `ausentes: ${missing.join(", ")}`);
    }
    case "e2e": {
      const baseUrl = v.base_url ?? ctx.baseUrl;
      if (!baseUrl) return done("skipped", "sem base_url (deploy de preview)");
      const spec = within(ctx.specDir, v.spec);
      const r = await ctx.exec(`${ctx.playwrightCommand} test "${spec}"`, {
        cwd: ctx.cwd,
        env: { ...process.env, BASE_URL: baseUrl, PLAYWRIGHT_BASE_URL: baseUrl },
        timeoutMs: v.timeout_s ? v.timeout_s * 1000 : undefined,
      });
      if (r.timedOut) return done("fail", `timeout após ${v.timeout_s} s`);
      return done(r.code === 0 ? "pass" : "fail", `exit ${r.code}\n${tail(r.stdout + r.stderr)}`);
    }
    default:
      return done("skipped", `verificador "${v.kind}" ainda não implementado`);
  }
}

export const defaultVerifierContext = (partial: Partial<VerifierContext> = {}): VerifierContext => ({
  cwd: process.cwd(),
  specDir: process.cwd(),
  playwrightCommand: "pnpm exec playwright",
  exec: shellExec,
  ...partial,
});
