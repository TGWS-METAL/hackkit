import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOOKS = dirname(fileURLToPath(import.meta.url));

// No Windows, "bash" no PATH pode ser o do WSL; os hooks rodam no Git Bash.
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const BASH = process.env.HACKKIT_BASH ?? (process.platform === "win32" && existsSync(GIT_BASH) ? GIT_BASH : "bash");

function hook(script: string, input: unknown, env: Record<string, string> = {}) {
  const r = spawnSync(BASH, [join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", HACKKIT_EVENT: "", HACKKIT_TASK: "", HACKKIT_EVENT_BRANCH: "", ...env },
  });
  return { code: r.status, stderr: r.stderr };
}

const bash = (command: string, env: Record<string, string> = {}) =>
  hook("guard-bash.sh", { tool_name: "Bash", tool_input: { command }, cwd: tmpdir() }, env);

describe("guard-bash.sh", () => {
  it.each([
    "rm -rf node_modules",
    "rm -fr dist",
    "rm -r -f dist",
    "rm --recursive --force dist",
    "pnpm build && rm -Rf /",
    "sudo rm -rf /tmp/x",
    "cat .env.production",
    "cp .env.prod .env",
    "grep KEY apps/x/.env.production.local",
  ])("bloqueia: %s", (cmd) => {
    const r = bash(cmd);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("guard-bash");
  });

  it.each([
    "rm -r dist",
    "rm -f file.txt",
    "git push origin feature",
    "git push --force origin feature",
    "cat .env.example",
    "cat .env.local",
    "pnpm test -- --reporter=dot",
  ])("deixa passar: %s", (cmd) => {
    expect(bash(cmd).code).toBe(0);
  });

  it("push forçado na branch do evento é bloqueado quando HACKKIT_EVENT_BRANCH está definido", () => {
    const env = { HACKKIT_EVENT_BRANCH: "event/kiroween" };
    expect(bash("git push --force origin event/kiroween", env).code).toBe(2);
    expect(bash("git push -f origin event/kiroween", env).code).toBe(2);
    expect(bash("git push origin +event/kiroween", env).code).toBe(2);
    expect(bash("git push --force origin feature", env).code).toBe(0);
    expect(bash("git push origin event/kiroween", env).code).toBe(0);
  });
});

describe("post-edit.sh", () => {
  it("ignora arquivo fora de packages/, apps/ e templates/", () => {
    const root = mkdtempSync(join(tmpdir(), "hk-"));
    const r = hook("post-edit.sh", { tool_name: "Edit", tool_input: { file_path: join(root, "README.md") }, cwd: root }, {
      CLAUDE_PROJECT_DIR: root,
    });
    expect(r.code).toBe(0);
  });

  it("typecheck vermelho devolve exit 2 com o erro no stderr", () => {
    const root = mkdtempSync(join(tmpdir(), "hk-"));
    const pkg = join(root, "packages", "x");
    mkdirSync(join(pkg, "src"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "x", scripts: { typecheck: "node -e \"console.error('TS2322 erro');process.exit(1)\"" } }),
    );
    writeFileSync(join(pkg, "src", "a.ts"), "export const a = 1;\n");
    const r = hook("post-edit.sh", { tool_name: "Edit", tool_input: { file_path: join(pkg, "src", "a.ts") }, cwd: root }, {
      CLAUDE_PROJECT_DIR: root,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("TS2322");
  }, 30_000);

  it("typecheck verde devolve exit 0", () => {
    const root = mkdtempSync(join(tmpdir(), "hk-"));
    const pkg = join(root, "packages", "x");
    mkdirSync(join(pkg, "src"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "x", scripts: { typecheck: "node -e \"0\"" } }));
    writeFileSync(join(pkg, "src", "a.ts"), "export const a = 1;\n");
    const r = hook("post-edit.sh", { tool_name: "Write", tool_input: { file_path: join(pkg, "src", "a.ts") }, cwd: root }, {
      CLAUDE_PROJECT_DIR: root,
    });
    expect(r.code).toBe(0);
  }, 30_000);
});

describe("on-stop.sh", () => {
  function repoWithPackage(testScript: string) {
    const root = mkdtempSync(join(tmpdir(), "hk-"));
    const git = (...a: string[]) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    writeFileSync(join(root, "README.md"), "x");
    git("add", ".");
    git("commit", "-qm", "init");
    const pkg = join(root, "packages", "x");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "x", scripts: { test: testScript } }));
    return root;
  }

  it("sem HACKKIT_EVENT/HACKKIT_TASK não faz nada", () => {
    expect(hook("on-stop.sh", { stop_hook_active: false }).code).toBe(0);
  });

  it("suíte verde grava status ok", () => {
    const root = repoWithPackage("node -e \"0\"");
    const r = hook("on-stop.sh", { stop_hook_active: false, cwd: root }, {
      CLAUDE_PROJECT_DIR: root,
      HACKKIT_EVENT: "ev",
      HACKKIT_TASK: "t-1",
    });
    expect(r.code).toBe(0);
    const s = JSON.parse(readFileSync(join(root, "runs", "ev", "t-1.status.json"), "utf8"));
    expect(s).toMatchObject({ event: "ev", task: "t-1", ok: true, packages: [{ package: "packages/x", ok: true }] });
  }, 30_000);

  it("suíte vermelha devolve exit 2; com stop_hook_active grava vermelho e sai 0", () => {
    const root = repoWithPackage("node -e \"process.exit(1)\"");
    const env = { CLAUDE_PROJECT_DIR: root, HACKKIT_EVENT: "ev", HACKKIT_TASK: "t-2" };
    expect(hook("on-stop.sh", { stop_hook_active: false, cwd: root }, env).code).toBe(2);
    expect(hook("on-stop.sh", { stop_hook_active: true, cwd: root }, env).code).toBe(0);
    const s = JSON.parse(readFileSync(join(root, "runs", "ev", "t-2.status.json"), "utf8"));
    expect(s.ok).toBe(false);
  }, 30_000);
});
