import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Spec } from "@hackkit/spec-runner";
import type { Profile } from "./profile.js";

// Checagem de regras da seção 11 do plano.

export type ItemId =
  | "rules"
  | "pais"
  | "idade"
  | "ai_allowed"
  | "preexisting_code"
  | "build_window"
  | "build_tool"
  | "runtime_model";

export interface CheckItem {
  id: ItemId;
  status: "verde" | "vermelho";
  motivo: string;
}

export interface CheckOptions {
  /** Raiz do repositório (onde ficam apps/ e packages/). */
  root: string;
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const verde = (id: ItemId, motivo: string): CheckItem => ({ id, status: "verde", motivo });
const vermelho = (id: ItemId, motivo: string): CheckItem => ({ id, status: "vermelho", motivo });
const rel = (root: string, p: string) => relative(root, p).split("\\").join("/");

function checkEligibility(spec: Spec, profile: Profile): CheckItem[] {
  const el = spec.rules?.eligibility;
  if (!el) return [vermelho("pais", "spec sem rules.eligibility"), vermelho("idade", "spec sem rules.eligibility")];
  const items: CheckItem[] = [];
  const excluded = el.countries_excluded.map((c) => c.toUpperCase());
  const allowed = el.countries_allowed?.map((c) => c.toUpperCase());
  if (excluded.includes(profile.country)) items.push(vermelho("pais", `${profile.country} está em countries_excluded`));
  else if (allowed && !allowed.includes(profile.country))
    items.push(vermelho("pais", `${profile.country} fora de countries_allowed (${allowed.join(", ")})`));
  else items.push(verde("pais", `${profile.country} aceito`));
  if (el.min_age === undefined) items.push(verde("idade", "spec sem min_age"));
  else if (profile.age < el.min_age) items.push(vermelho("idade", `idade ${profile.age} < min_age ${el.min_age}`));
  else items.push(verde("idade", `idade ${profile.age} >= min_age ${el.min_age}`));
  return items;
}

/** Cabeçalho Markdown que menciona IA/AI, usado como seção de divulgação. */
export const DISCLOSURE_HEADING = /^#{1,6}\s.*\b(IA|AI)\b/im;

function checkAi(spec: Spec, appDir: string, root: string): CheckItem {
  const ai = spec.rules!.ai_allowed;
  if (ai === false) return vermelho("ai_allowed", "regulamento proíbe uso de IA");
  if (ai === true) return verde("ai_allowed", "regulamento permite IA");
  const readme = join(appDir, "README.md");
  if (!existsSync(readme)) return vermelho("ai_allowed", `disclosed: ${rel(root, readme)} não existe`);
  return DISCLOSURE_HEADING.test(readFileSync(readme, "utf8"))
    ? verde("ai_allowed", `disclosed: seção de divulgação em ${rel(root, readme)}`)
    : vermelho("ai_allowed", `disclosed: ${rel(root, readme)} sem cabeçalho de divulgação de IA`);
}

function checkPreexisting(spec: Spec, appDir: string, root: string): CheckItem {
  const mode = spec.rules!.preexisting_code;
  if (mode !== "forbidden") return verde("preexisting_code", mode);
  const problems: string[] = [];
  // O kit só entra como dependência publicada: workspace:* aponta para o código local.
  const pkgJson = join(appDir, "package.json");
  if (existsSync(pkgJson)) {
    const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const [name, ver] of Object.entries(pkg[field] ?? {}))
        if (ver.startsWith("workspace:")) problems.push(`${name}@${ver} em ${field}`);
    }
  }
  // Cópia de arquivo do kit: mesmo conteúdo (sha256) em packages/ e em apps/<evento>.
  const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const kit = new Map<string, string>();
  for (const f of walk(join(root, "packages"))) if (statSync(f).size > 0) kit.set(hash(f), f);
  for (const f of walk(appDir)) {
    if (statSync(f).size === 0) continue;
    const src = kit.get(hash(f));
    if (src) problems.push(`${rel(root, f)} = cópia de ${rel(root, src)}`);
  }
  return problems.length === 0
    ? verde("preexisting_code", "forbidden: nenhuma cópia nem dependência workspace do kit")
    : vermelho("preexisting_code", `forbidden: ${problems.join("; ")}`);
}

/** Data sem hora vale o dia inteiro em UTC. */
function bound(v: string, edge: "start" | "end"): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.parse(`${v}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return Date.parse(v);
}

function checkBuildWindow(spec: Spec, appDir: string, root: string): CheckItem {
  const [startText, endText] = spec.rules!.build_window;
  const start = bound(startText, "start");
  const end = bound(endText, "end");
  const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  const inside = git("rev-parse", "--is-inside-work-tree");
  if (inside.status !== 0)
    return vermelho("build_window", `não é repositório git: ${(inside.stderr || inside.error?.message || "").trim()}`);
  // Repositório ainda sem commit: 0 commits em apps/<evento>.
  const hasHead = git("rev-parse", "--verify", "-q", "HEAD").status === 0;
  const r = hasHead ? git("log", "--format=%h%x09%aI%x09%cI", "--", rel(root, appDir)) : undefined;
  if (r && r.status !== 0) return vermelho("build_window", `git log falhou: ${r.stderr.trim()}`);
  const lines = (r?.stdout ?? "").split("\n").filter(Boolean);
  const out = lines.filter((l) => {
    const [, author, committer] = l.split("\t");
    return [author!, committer!].some((d) => {
      const t = Date.parse(d);
      return t < start || t > end;
    });
  });
  const janela = `[${startText}, ${endText}]`;
  return out.length === 0
    ? verde("build_window", `${lines.length} de ${lines.length} commits em ${rel(root, appDir)} dentro de ${janela}`)
    : vermelho(
        "build_window",
        `${out.length} de ${lines.length} commits fora de ${janela}: ${out.map((l) => l.split("\t").join(" ")).join("; ")}`,
      );
}

function checkBuildTool(spec: Spec, appDir: string, root: string): CheckItem {
  const tool = spec.constraints.build_tool;
  if (!tool) return verde("build_tool", "sem ferramenta obrigatória");
  // Rastro da ferramenta: pasta .<ferramenta>/ na raiz do app, com pelo menos um arquivo.
  const dir = join(appDir, `.${tool}`);
  const files = walk(dir);
  return files.length > 0
    ? verde("build_tool", `${rel(root, dir)}/ com ${files.length} arquivos`)
    : vermelho("build_tool", `${rel(root, dir)}/ ausente ou vazia`);
}

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|py|md|env\.example)$/i;

function checkRuntimeModel(spec: Spec, appDir: string, root: string): CheckItem {
  const model = spec.constraints.runtime_model;
  if (!model) return verde("runtime_model", "sem modelo obrigatório");
  if (spec.evaluation === "leaderboard") return verde("runtime_model", `${model}: pipeline de placar`);
  const hit = walk(appDir).find((f) => TEXT_EXT.test(f) && readFileSync(f, "utf8").includes(model));
  return hit
    ? verde("runtime_model", `${model} referenciado em ${rel(root, hit)}`)
    : vermelho("runtime_model", `${model} não aparece em ${rel(root, appDir)} (evento julgado)`);
}

export function checkRules(spec: Spec, profile: Profile, opts: CheckOptions): CheckItem[] {
  const appDir = join(opts.root, "apps", spec.event);
  const items = checkEligibility(spec, profile);
  if (!spec.rules) {
    items.push(vermelho("rules", "spec sem bloco rules"));
  } else {
    items.push(checkAi(spec, appDir, opts.root));
    items.push(checkPreexisting(spec, appDir, opts.root));
    items.push(checkBuildWindow(spec, appDir, opts.root));
  }
  items.push(checkBuildTool(spec, appDir, opts.root));
  items.push(checkRuntimeModel(spec, appDir, opts.root));
  return items;
}

export const hasRed = (items: CheckItem[]) => items.some((i) => i.status === "vermelho");
