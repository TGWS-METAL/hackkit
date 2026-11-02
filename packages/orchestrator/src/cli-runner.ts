import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import type { Runner, Task, TaskResult } from "./runner.js";

/** Processo mínimo que o cliRunner precisa; injetável nos testes. */
export interface SpawnedProcess {
  stdout: Readable;
  stderr: Readable;
  on(event: "close", cb: (code: number | null) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
}

export type SpawnFn = (
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
) => SpawnedProcess;

export interface CliRunnerOptions {
  /** Raiz do repositório; worktree e runs/ são resolvidos a partir dela. */
  root: string;
  /** Binário do Claude Code (padrão: "claude"). */
  claudeBin?: string;
  spawn?: SpawnFn;
}

/** Argumentos de `claude -p` da seção 4. */
export function buildClaudeArgs(task: Task): string[] {
  const args = ["-p", task.prompt];
  if (task.agentPrompt) args.push("--append-system-prompt", task.agentPrompt);
  args.push(
    // `claude --help` (2.1.306): "--allowedTools <tools...>", um argumento por ferramenta.
    "--allowedTools", ...task.allowedTools,
    "--model", task.model,
    "--max-turns", String(task.maxTurns),
    // Os exemplos oficiais de stream-json em modo -p usam --verbose
    // (https://code.claude.com/docs/en/headless).
    "--output-format", "stream-json",
    "--verbose",
  );
  return args;
}

interface ResultMessage {
  type: "result";
  subtype: string;
  is_error?: boolean;
  num_turns?: number;
  session_id?: string;
  total_cost_usd?: number;
}

/** Lê o stream-json e devolve o TaskResult a partir da última mensagem type "result". */
export function parseStreamJson(text: string): TaskResult {
  let result: ResultMessage | undefined;
  let sessionId: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof msg !== "object" || msg === null) continue;
    const m = msg as Record<string, unknown>;
    if (typeof m.session_id === "string") sessionId = m.session_id;
    if (m.type === "result") result = m as unknown as ResultMessage;
  }
  if (!result) return { status: "failed", turns: 0, ...(sessionId ? { sessionId } : {}) };
  const out: TaskResult = {
    status: result.subtype === "success" && !result.is_error ? "ok" : "failed",
    turns: result.num_turns ?? 0,
  };
  const sid = result.session_id ?? sessionId;
  if (sid) out.sessionId = sid;
  if (typeof result.total_cost_usd === "number") out.costUsd = result.total_cost_usd;
  return out;
}

const defaultSpawn: SpawnFn = (command, args, opts) =>
  spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });

export function createCliRunner(opts: CliRunnerOptions): Runner {
  const spawnFn = opts.spawn ?? defaultSpawn;
  const bin = opts.claudeBin ?? "claude";
  return {
    run(task: Task): Promise<TaskResult> {
      const cwd = resolve(opts.root, task.worktree ?? join("wt", task.event, task.concern));
      const outFile = resolve(opts.root, task.outputFile ?? join("runs", task.event, `${task.id}.jsonl`));
      mkdirSync(dirname(outFile), { recursive: true });
      const out = createWriteStream(outFile);
      // Lidos por scripts/hooks/on-stop.sh para gravar runs/<evento>/<tarefa>.status.json.
      const env = {
        ...process.env,
        HACKKIT_EVENT: task.event,
        HACKKIT_TASK: task.id,
        HACKKIT_RUNS_DIR: resolve(opts.root, "runs"),
      };
      return new Promise((resolveP) => {
        let text = "";
        let stderr = "";
        let settled = false;
        const finish = (r: TaskResult) => {
          if (settled) return;
          settled = true;
          out.end(() => resolveP(r));
        };
        const child = spawnFn(bin, buildClaudeArgs(task), { cwd, env });
        child.stdout.on("data", (d: Buffer | string) => {
          text += d.toString();
          out.write(d);
        });
        child.stderr.on("data", (d: Buffer | string) => (stderr += d.toString()));
        child.on("error", () => finish({ status: "failed", turns: 0 }));
        child.on("close", (code) => {
          const r = parseStreamJson(text);
          if (code !== 0 && r.status === "ok") r.status = "failed";
          if (stderr) out.write(JSON.stringify({ type: "runner_stderr", text: stderr }) + "\n");
          finish(r);
        });
      });
    },
  };
}
