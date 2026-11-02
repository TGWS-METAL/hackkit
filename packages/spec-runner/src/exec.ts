import { spawn, spawnSync, type ChildProcess } from "node:child_process";

/** Encerra o processo e os filhos (com shell: true o comando roda num neto do Node). */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export type Exec = (command: string, opts: ExecOptions) => Promise<ExecResult>;

/** Roda o comando num shell e devolve o código de saída. */
export const shellExec: Exec = (command, opts) =>
  new Promise((resolve) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: true,
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: ExecResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killTree(child);
          finish({ code: 124, stdout, stderr, timedOut: true });
        }, opts.timeoutMs)
      : undefined;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => finish({ code: 127, stdout, stderr: stderr + String(err), timedOut: false }));
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr, timedOut: false }));
  });
