import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Exec } from "./exec.js";
import { parseSpec } from "./spec.js";
import { runSpec, runSpecFile } from "./runner.js";
import { defaultVerifierContext, runVerifier } from "./verifiers.js";

const SPEC = `
event: exemplo
platform: devpost
evaluation: judged
deadline: 2026-12-04T22:00:00Z
constraints:
  build_tool: null
  runtime_model: null
  required_sdks: []
target_score: 88
budget_usd: 150
tracks:
  - id: main
    prize_usd: 0
    est_competitors: null
    criteria:
      - id: implementation
        weight: 0.33
        source_quote: "<trecho exato do regulamento>"
        verifiers:
          - kind: command
            run: pnpm typecheck && pnpm test && pnpm lint
          - kind: e2e
            spec: e2e/core-flow.spec.ts
          - kind: judge_prompt
            prompt: criteria/implementation.md
      - id: docs
        weight: 0.33
        verifiers:
          - kind: file_exists
            path: [README.md, LICENSE]
      - id: design
        weight: 0.33
        verifiers:
          - kind: judge_prompt
            prompt: criteria/design.md
rules:
  ai_allowed: disclosed
  preexisting_code: disclosed
  build_window: [2026-11-02, 2026-12-04]
  eligibility: { countries_excluded: [], min_age: 18 }
`;

const fakeExec = (code: number, calls: { cmd: string; env?: NodeJS.ProcessEnv }[] = []): Exec =>
  async (cmd, opts) => {
    calls.push({ cmd, env: opts.env });
    return { code, stdout: "", stderr: "", timedOut: false };
  };

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "spec-runner-"));
}

describe("parseSpec", () => {
  it("lê o formato da seção 5", () => {
    const s = parseSpec(SPEC);
    expect(s.event).toBe("exemplo");
    expect(s.tracks[0]!.criteria.map((c) => c.id)).toEqual(["implementation", "docs", "design"]);
    expect(s.tracks[0]!.criteria[0]!.verifiers.map((v) => v.kind)).toEqual(["command", "e2e", "judge_prompt"]);
    expect(s.rules?.ai_allowed).toBe("disclosed");
    expect(s.rules?.build_window).toHaveLength(2);
  });

  it("rejeita verificador de tipo desconhecido", () => {
    expect(() => parseSpec(SPEC.replace("kind: file_exists", "kind: nada"))).toThrow();
  });

  it("lê milestones, submissions e trilha restrita a modelos", () => {
    const s = parseSpec(
      SPEC.replace(
        "constraints:",
        "milestones:\n  - { id: entry, at: 2026-11-25T23:59:00Z }\nsubmissions: { per_day: 1, final_selected: 2 }\nconstraints:",
      ).replace("    prize_usd: 0\n", "    prize_usd: 0\n    prizes_usd: [3, 2, 1]\n    models: [m-small]\n"),
    );
    expect(s.milestones).toEqual([{ id: "entry", at: "2026-11-25T23:59:00Z" }]);
    expect(s.submissions).toEqual({ per_day: 1, final_selected: 2 });
    expect(s.tracks[0]!.prizes_usd).toEqual([3, 2, 1]);
    expect(s.tracks[0]!.models).toEqual(["m-small"]);
    expect(parseSpec(SPEC).milestones).toEqual([]);
    expect(() => parseSpec(SPEC.replace("constraints:", "submissions: { per_day: 0, final_selected: 2 }\nconstraints:"))).toThrow();
  });

  it("rejeita evaluation fora de judged | leaderboard", () => {
    expect(() => parseSpec(SPEC.replace("evaluation: judged", "evaluation: votos"))).toThrow();
  });
});

describe("verificadores", () => {
  it("command: passa com exit 0 e falha com exit diferente de 0 (shell real)", async () => {
    const ctx = defaultVerifierContext({ cwd: tmp() });
    const ok = await runVerifier({ kind: "command", run: "node -e \"process.exit(0)\"" }, ctx);
    const ko = await runVerifier({ kind: "command", run: "node -e \"process.exit(3)\"" }, ctx);
    expect(ok.status).toBe("pass");
    expect(ko.status).toBe("fail");
    expect(ko.detail).toMatch(/^exit 3/);
  });

  it("command: timeout conta como fail", async () => {
    const ctx = defaultVerifierContext({ cwd: tmp() });
    const r = await runVerifier(
      { kind: "command", run: "node -e \"setTimeout(()=>{},5000)\"", timeout_s: 0.3 },
      ctx,
    );
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/timeout/);
  });

  it("file_exists: passa só com todos os caminhos presentes", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "README.md"), "x");
    const ctx = defaultVerifierContext({ cwd: dir });
    expect((await runVerifier({ kind: "file_exists", path: "README.md" }, ctx)).status).toBe("pass");
    const r = await runVerifier({ kind: "file_exists", path: ["README.md", "LICENSE"] }, ctx);
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("LICENSE");
  });

  it("e2e: sem base_url fica skipped e não executa nada", async () => {
    const calls: { cmd: string }[] = [];
    const ctx = defaultVerifierContext({ exec: fakeExec(0, calls) });
    const r = await runVerifier({ kind: "e2e", spec: "e2e/core-flow.spec.ts" }, ctx);
    expect(r.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("e2e: roda o Playwright com a spec relativa ao spec.yaml e a URL no ambiente", async () => {
    const calls: { cmd: string; env?: NodeJS.ProcessEnv }[] = [];
    const ctx = defaultVerifierContext({
      specDir: join("events", "x"),
      baseUrl: "https://preview.example.com",
      exec: fakeExec(1, calls),
    });
    const r = await runVerifier({ kind: "e2e", spec: "e2e/core-flow.spec.ts" }, ctx);
    expect(r.status).toBe("fail");
    expect(calls[0]!.cmd).toMatch(/^pnpm exec playwright test ".*core-flow\.spec\.ts"$/);
    expect(calls[0]!.env?.PLAYWRIGHT_BASE_URL).toBe("https://preview.example.com");
  });

  it("tipos não implementados ficam skipped", async () => {
    const r = await runVerifier({ kind: "judge_prompt", prompt: "x.md" }, defaultVerifierContext());
    expect(r.status).toBe("skipped");
  });
});

describe("runSpec", () => {
  it("média por critério, total ponderado 0-100 e lacunas abaixo de 0,85", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "README.md"), "x");
    writeFileSync(join(dir, "LICENSE"), "x");
    const spec = parseSpec(SPEC);
    const report = await runSpec(
      spec,
      defaultVerifierContext({ cwd: dir, baseUrl: "https://p.example.com", exec: fakeExec(0) }),
    );
    const t = report.tracks[0]!;
    const byId = Object.fromEntries(t.criteria.map((c) => [c.id, c.score]));
    expect(byId).toEqual({ implementation: 1, docs: 1, design: null });
    expect(t.weightSum).toBeCloseTo(0.99, 10);
    expect(t.total).toBeCloseTo((100 * 0.66) / 0.99, 10);
    expect(t.gaps).toEqual(["design"]);
  });

  it("critério com metade dos verificadores passando vira lacuna", async () => {
    const dir = tmp();
    let n = 0;
    const alternating: Exec = async () => ({ code: n++ % 2, stdout: "", stderr: "", timedOut: false });
    const spec = parseSpec(SPEC);
    const report = await runSpec(
      spec,
      defaultVerifierContext({ cwd: dir, baseUrl: "https://p.example.com", exec: alternating }),
    );
    const impl = report.tracks[0]!.criteria.find((c) => c.id === "implementation")!;
    expect(impl.score).toBe(0.5);
    expect(report.tracks[0]!.gaps).toContain("implementation");
  });

  it("runSpecFile resolve e2e relativo à pasta do spec.yaml", async () => {
    const dir = tmp();
    const specPath = join(dir, "spec.yaml");
    writeFileSync(specPath, SPEC);
    const calls: { cmd: string }[] = [];
    await runSpecFile(specPath, { cwd: dir, baseUrl: "https://p.example.com", exec: fakeExec(0, calls) });
    const e2e = calls.find((c) => c.cmd.includes("playwright"))!;
    expect(e2e.cmd).toContain(join(dir, "e2e", "core-flow.spec.ts"));
  });
});
