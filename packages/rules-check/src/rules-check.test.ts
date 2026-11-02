import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpec } from "@hackkit/spec-runner";
import { describe, expect, it } from "vitest";
import { checkRules, hasRed, type CheckItem } from "./check.js";
import { parseProfile } from "./profile.js";

const baseSpec = (over: { rules?: string; constraints?: string; evaluation?: string } = {}) =>
  parseSpec(`
event: ev
platform: devpost
evaluation: ${over.evaluation ?? "judged"}
deadline: 2026-12-04T22:00:00Z
constraints:
${over.constraints ?? "  build_tool: null\n  runtime_model: null"}
target_score: 88
budget_usd: 150
tracks:
  - id: main
    criteria:
      - id: c
        weight: 1
        verifiers: [{ kind: command, run: "true" }]
${
  over.rules ??
  `rules:
  ai_allowed: true
  preexisting_code: allowed
  build_window: [2026-11-02, 2026-12-04]
  eligibility: { countries_excluded: [], min_age: 18 }`
}
`);

const BR18 = parseProfile("country: br\nage: 18\n");

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "rules-"));
  spawnSync("git", ["-C", root, "init", "-q"]);
  spawnSync("git", ["-C", root, "config", "user.email", "t@t"]);
  spawnSync("git", ["-C", root, "config", "user.name", "t"]);
  return root;
}

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function commitAt(root: string, path: string, iso: string) {
  write(root, path, `${path} ${iso}`);
  spawnSync("git", ["-C", root, "add", "-A"]);
  spawnSync("git", ["-C", root, "commit", "-qm", iso], {
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
}

const item = (items: CheckItem[], id: CheckItem["id"]) => items.find((i) => i.id === id)!;

describe("elegibilidade", () => {
  it("país excluído e idade abaixo do mínimo ficam vermelhos", () => {
    const spec = baseSpec({
      rules: `rules:
  ai_allowed: true
  preexisting_code: allowed
  build_window: [2026-11-02, 2026-12-04]
  eligibility: { countries_excluded: [BR], min_age: 21 }`,
    });
    const items = checkRules(spec, BR18, { root: repo() });
    expect(item(items, "pais")).toMatchObject({ status: "vermelho" });
    expect(item(items, "idade")).toMatchObject({ status: "vermelho", motivo: "idade 18 < min_age 21" });
  });

  it("somente residentes de outro país fica vermelho", () => {
    const spec = baseSpec({
      rules: `rules:
  ai_allowed: true
  preexisting_code: allowed
  build_window: [2026-11-02, 2026-12-04]
  eligibility: { countries_excluded: [], countries_allowed: [US] }`,
    });
    expect(item(checkRules(spec, BR18, { root: repo() }), "pais").status).toBe("vermelho");
  });

  it("BR, 18 anos, sem exclusão: verde", () => {
    const items = checkRules(baseSpec(), BR18, { root: repo() });
    expect(item(items, "pais").status).toBe("verde");
    expect(item(items, "idade").status).toBe("verde");
  });

  it("spec sem rules: vermelho", () => {
    const items = checkRules(baseSpec({ rules: "" }), BR18, { root: repo() });
    expect(item(items, "rules").status).toBe("vermelho");
    expect(item(items, "pais").status).toBe("vermelho");
  });
});

describe("ai_allowed", () => {
  const spec = (v: string) =>
    baseSpec({
      rules: `rules:
  ai_allowed: ${v}
  preexisting_code: allowed
  build_window: [2026-11-02, 2026-12-04]
  eligibility: { countries_excluded: [] }`,
    });

  it("false: vermelho", () => {
    expect(item(checkRules(spec("false"), BR18, { root: repo() }), "ai_allowed").status).toBe("vermelho");
  });

  it("disclosed sem README de divulgação: vermelho; com seção: verde", () => {
    const root = repo();
    expect(item(checkRules(spec("disclosed"), BR18, { root }), "ai_allowed").status).toBe("vermelho");
    write(root, "apps/ev/README.md", "# App\n\nTexto.\n");
    expect(item(checkRules(spec("disclosed"), BR18, { root }), "ai_allowed").status).toBe("vermelho");
    write(root, "apps/ev/README.md", "# App\n\n## Uso de IA\n\nFeito com o Claude Code.\n");
    expect(item(checkRules(spec("disclosed"), BR18, { root }), "ai_allowed").status).toBe("verde");
  });
});

describe("preexisting_code", () => {
  const spec = baseSpec({
    rules: `rules:
  ai_allowed: true
  preexisting_code: forbidden
  build_window: [2026-11-02, 2026-12-04]
  eligibility: { countries_excluded: [] }`,
  });

  it("forbidden: cópia de arquivo do kit e dependência workspace ficam vermelhas", () => {
    const root = repo();
    write(root, "packages/ui/src/button.tsx", "export const Button = 1;\n");
    write(root, "apps/ev/src/button.tsx", "export const Button = 1;\n");
    write(root, "apps/ev/package.json", JSON.stringify({ dependencies: { "@hackkit/ui": "workspace:*" } }));
    const it = item(checkRules(spec, BR18, { root }), "preexisting_code");
    expect(it.status).toBe("vermelho");
    expect(it.motivo).toContain("apps/ev/src/button.tsx = cópia de packages/ui/src/button.tsx");
    expect(it.motivo).toContain("@hackkit/ui@workspace:*");
  });

  it("forbidden sem cópia: verde", () => {
    const root = repo();
    write(root, "packages/ui/src/button.tsx", "export const Button = 1;\n");
    write(root, "apps/ev/src/page.tsx", "export const Page = 2;\n");
    expect(item(checkRules(spec, BR18, { root }), "preexisting_code").status).toBe("verde");
  });
});

describe("build_window", () => {
  it("commit de apps/<evento> fora da janela fica vermelho; commit fora de apps/ não conta", () => {
    const root = repo();
    commitAt(root, "packages/ui/a.ts", "2026-10-01T12:00:00Z");
    commitAt(root, "apps/ev/a.ts", "2026-11-02T00:00:00Z");
    commitAt(root, "apps/ev/b.ts", "2026-12-04T23:59:59Z");
    expect(item(checkRules(baseSpec(), BR18, { root }), "build_window")).toMatchObject({
      status: "verde",
      motivo: expect.stringContaining("2 de 2 commits"),
    });
    commitAt(root, "apps/ev/c.ts", "2026-12-05T00:00:01Z");
    const it = item(checkRules(baseSpec(), BR18, { root }), "build_window");
    expect(it.status).toBe("vermelho");
    expect(it.motivo).toContain("1 de 3 commits fora");
  });

  it("fora de um repositório git: vermelho", () => {
    const root = mkdtempSync(join(tmpdir(), "nogit-"));
    expect(item(checkRules(baseSpec(), BR18, { root }), "build_window").status).toBe("vermelho");
  });
});

describe("build_tool e runtime_model", () => {
  it("build_tool exige .<ferramenta>/ com arquivo em apps/<evento>", () => {
    const root = repo();
    const spec = baseSpec({ constraints: "  build_tool: kiro\n  runtime_model: null" });
    expect(item(checkRules(spec, BR18, { root }), "build_tool").status).toBe("vermelho");
    write(root, "apps/ev/.kiro/specs/a.md", "x");
    expect(item(checkRules(spec, BR18, { root }), "build_tool").status).toBe("verde");
  });

  it("runtime_model: placar é verde; julgado exige o modelo referenciado no app", () => {
    const root = repo();
    const c = "  build_tool: null\n  runtime_model: gemma-4-31b-it-qat-w4a16-ct";
    expect(item(checkRules(baseSpec({ constraints: c, evaluation: "leaderboard" }), BR18, { root }), "runtime_model").status).toBe("verde");
    const judged = baseSpec({ constraints: c });
    expect(item(checkRules(judged, BR18, { root }), "runtime_model").status).toBe("vermelho");
    write(root, "apps/ev/agent.yaml", "model: gemma-4-31b-it-qat-w4a16-ct\n");
    expect(item(checkRules(judged, BR18, { root }), "runtime_model").status).toBe("verde");
  });
});

describe("cli", () => {
  const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

  it("exit 0 com tudo verde e exit 1 com item vermelho", () => {
    const root = repo();
    write(root, "profile.yaml", "country: BR\nage: 30\n");
    write(
      root,
      "events/ev/spec.yaml",
      `event: ev
platform: devpost
evaluation: judged
deadline: 2026-12-04T22:00:00Z
target_score: 88
budget_usd: 150
tracks: [{ id: main, criteria: [{ id: c, weight: 1, verifiers: [{ kind: command, run: "true" }] }] }]
rules:
  ai_allowed: true
  preexisting_code: allowed
  build_window: [2026-11-02, 2026-12-04]
  eligibility: { countries_excluded: [] }
`,
    );
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [CLI, join(root, "events/ev/spec.yaml"), "--root", root, ...args], {
        encoding: "utf8",
      });
    const ok = run();
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("pais | verde | BR aceito");
    write(root, "minor.yaml", "country: BR\nage: 10\n");
    write(root, "excluded.yaml", "country: BR\nage: 30\n");
    const spec = join(root, "events/ev/spec.yaml");
    write(root, "events/ev/spec.yaml", "");
    writeFileSync(
      spec,
      `event: ev
platform: devpost
evaluation: judged
deadline: 2026-12-04T22:00:00Z
target_score: 88
budget_usd: 150
tracks: [{ id: main, criteria: [{ id: c, weight: 1, verifiers: [{ kind: command, run: "true" }] }] }]
rules:
  ai_allowed: true
  preexisting_code: allowed
  build_window: [2026-11-02, 2026-12-04]
  eligibility: { countries_excluded: [], min_age: 18 }
`,
    );
    const red = run("--profile", join(root, "minor.yaml"), "--json");
    expect(red.status).toBe(1);
    const items = JSON.parse(red.stdout) as CheckItem[];
    expect(hasRed(items)).toBe(true);
    expect(item(items, "idade").motivo).toBe("idade 10 < min_age 18");
  });
});
