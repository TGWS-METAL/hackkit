import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { buildClaudeArgs, createCliRunner, parseStreamJson, type SpawnFn } from "./cli-runner.js";
import { loadConfig, selectRunner } from "./config.js";
import type { Task } from "./runner.js";

const task: Task = {
  id: "frontend-001",
  event: "kiroween",
  concern: "frontend",
  prompt: "implemente a tela X",
  agentPrompt: "você é o agente frontend",
  allowedTools: ["Read", "Edit", "Write", "Bash(pnpm *)", "Bash(git *)", "mcp__playwright__*"],
  model: "sonnet",
  maxTurns: 60,
};

const SUCCESS = [
  { type: "system", subtype: "init", session_id: "s-1" },
  { type: "assistant", session_id: "s-1", message: { content: [] } },
  { type: "result", subtype: "success", is_error: false, num_turns: 7, session_id: "s-1", total_cost_usd: 0.42 },
]
  .map((m) => JSON.stringify(m))
  .join("\n");

function fakeSpawn(stdout: string, code: number, seen: { cmd?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv }): SpawnFn {
  return (cmd, args, opts) => {
    Object.assign(seen, { cmd, args, cwd: opts.cwd, env: opts.env });
    const proc = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    setImmediate(() => {
      proc.stdout.end(stdout);
      proc.stderr.end();
      setImmediate(() => proc.emit("close", code));
    });
    return proc as never;
  };
}

describe("buildClaudeArgs", () => {
  it("monta a linha da seção 4", () => {
    expect(buildClaudeArgs(task)).toEqual([
      "-p", "implemente a tela X",
      "--append-system-prompt", "você é o agente frontend",
      "--allowedTools", "Read", "Edit", "Write", "Bash(pnpm *)", "Bash(git *)", "mcp__playwright__*",
      "--model", "sonnet",
      "--max-turns", "60",
      "--output-format", "stream-json",
      "--verbose",
    ]);
  });
});

describe("parseStreamJson", () => {
  it("success vira ok com turnos, sessão e custo", () => {
    expect(parseStreamJson(SUCCESS)).toEqual({ status: "ok", turns: 7, sessionId: "s-1", costUsd: 0.42 });
  });

  it("error_max_turns vira failed", () => {
    const line = JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 60, session_id: "s-2" });
    expect(parseStreamJson(line)).toEqual({ status: "failed", turns: 60, sessionId: "s-2" });
  });

  it("sem mensagem result vira failed; linhas inválidas são ignoradas", () => {
    expect(parseStreamJson("lixo\n" + JSON.stringify({ type: "system", session_id: "s-3" }))).toEqual({
      status: "failed",
      turns: 0,
      sessionId: "s-3",
    });
  });
});

describe("cliRunner", () => {
  it("roda na worktree do concern, grava runs/<evento>/<tarefa>.jsonl e passa evento e tarefa no ambiente", async () => {
    const root = mkdtempSync(join(tmpdir(), "orch-"));
    const seen: { cmd?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv } = {};
    const runner = createCliRunner({ root, spawn: fakeSpawn(SUCCESS, 0, seen) });
    const r = await runner.run(task);
    expect(r).toEqual({ status: "ok", turns: 7, sessionId: "s-1", costUsd: 0.42 });
    expect(seen.cmd).toBe("claude");
    expect(seen.cwd).toBe(join(root, "wt", "kiroween", "frontend"));
    expect(seen.env?.HACKKIT_EVENT).toBe("kiroween");
    expect(seen.env?.HACKKIT_TASK).toBe("frontend-001");
    expect(readFileSync(join(root, "runs", "kiroween", "frontend-001.jsonl"), "utf8")).toBe(SUCCESS);
  });

  it("código de saída diferente de 0 vira failed mesmo com result success", async () => {
    const root = mkdtempSync(join(tmpdir(), "orch-"));
    const runner = createCliRunner({ root, spawn: fakeSpawn(SUCCESS, 1, {}) });
    expect((await runner.run(task)).status).toBe("failed");
  });
});

describe("config", () => {
  it("padrão cli; HACKKIT_RUNNER sobrepõe o arquivo", () => {
    const root = mkdtempSync(join(tmpdir(), "cfg-"));
    expect(loadConfig(root, {}).runner).toBe("cli");
    writeFileSync(join(root, "hackkit.config.json"), JSON.stringify({ runner: "sdk" }));
    expect(loadConfig(root, {}).runner).toBe("sdk");
    expect(loadConfig(root, { HACKKIT_RUNNER: "cli" }).runner).toBe("cli");
    expect(() => loadConfig(root, { HACKKIT_RUNNER: "x" })).toThrow();
  });

  it("runner sdk rejeita com 'não implementado'", async () => {
    await expect(selectRunner({ runner: "sdk" }, ".").run(task)).rejects.toThrow(/não implementado/);
  });
});
