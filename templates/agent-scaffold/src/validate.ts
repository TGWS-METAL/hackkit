import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse, type ScalarTag } from "yaml";

// Regras do contrato de submissão do harness swegemma (HARNESS_README.md, seções 2.2, 2.4 e 3.2).

export const ROOT_CONFIGS = ["agent.yaml", "agent.yml", "root_agent.yaml", "root_agent.yml"];
export const ALLOWED_EXTENSIONS = [".yaml", ".yml", ".md", ".txt", ".py", ".json", ".safetensors"];
export const ALLOWED_MODELS = [
  "gemma-4-31b-it-qat-w4a16-ct",
  "gemma-4-12b-it-qat-w4a16-ct",
  "gemma-4-e4b-it-qat-w4a16-ct",
  "gemma-4-e2b-it-qat-w4a16-ct",
];
export const BUILTIN_TOOLS = [
  "run_command",
  "submit_patch",
  "get_status",
  "read_file",
  "edit_file",
  "write_file",
  "get_code_neighbors",
  "search_similar_code",
  "get_code_subgraph",
];
export const MAX_TOTAL_BYTES = 3 * 1024 ** 3;
export const MAX_FILES = 10_000;
const PROVIDER_PREFIX = /^(openai|google|hosted_vllm|custom)\//;

export interface SubmissionFile {
  /** Caminho relativo à raiz, com "/". */
  path: string;
  size: number;
}

export interface Validation {
  errors: string[];
  files: SubmissionFile[];
  totalBytes: number;
  models: string[];
}

class Include {
  constructor(readonly path: string) {}
}

const includeTag: ScalarTag = {
  tag: "!include",
  resolve: (value: string) => new Include(value) as unknown as string,
};

const toPosix = (p: string) => p.split(sep).join("/");

function listFiles(root: string, errors: string[]): SubmissionFile[] {
  const out: SubmissionFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      const rel = toPosix(relative(root, p));
      if (st.isSymbolicLink()) errors.push(`${rel}: link simbólico`);
      else if (st.isDirectory()) walk(p);
      else out.push({ path: rel, size: st.size });
    }
  };
  walk(root);
  return out;
}

/** Caminho de !include relativo ao arquivo que inclui; precisa ficar dentro da raiz. */
function resolveInclude(root: string, from: string, target: string): string {
  if (target.includes("\0")) throw new Error(`!include ${JSON.stringify(target)} com byte nulo`);
  if (isAbsolute(target) || target.startsWith("/")) throw new Error(`!include ${target}: caminho absoluto`);
  const abs = resolve(dirname(from), target);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`!include ${target}: sai da raiz`);
  return abs;
}

interface AgentNode {
  file: string;
  config: Record<string, unknown>;
}

function loadYaml(root: string, file: string, depth: number, stack: string[]): unknown {
  if (depth > 10) throw new Error(`${toPosix(relative(root, file))}: !include além da profundidade 10`);
  if (stack.includes(file)) throw new Error(`${toPosix(relative(root, file))}: ciclo de !include`);
  const doc = parse(readFileSync(file, "utf8"), { customTags: [includeTag] }) as unknown;
  const expand = (v: unknown): unknown => {
    if (v instanceof Include) {
      const abs = resolveInclude(root, file, v.path);
      const ext = extname(abs).toLowerCase();
      if (ext === ".md" || ext === ".txt") return readFileSync(abs, "utf8");
      if (ext === ".yaml" || ext === ".yml") return loadYaml(root, abs, depth + 1, [...stack, file]);
      throw new Error(`!include ${v.path}: extensão ${ext} não aceita`);
    }
    if (Array.isArray(v)) return v.map(expand);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]));
    return v;
  };
  return expand(doc);
}

/** Percorre a árvore de agentes a partir da raiz (sub_agents e agent_tool, inclusive inline). */
function collectAgents(root: string, file: string, config: Record<string, unknown>, out: AgentNode[], seen: Set<string>) {
  out.push({ file, config });
  const refs: unknown[] = [];
  for (const s of (config.sub_agents as unknown[] | undefined) ?? []) refs.push(s);
  for (const t of (config.tools as unknown[] | undefined) ?? []) {
    if (t && typeof t === "object" && "agent_tool" in t) refs.push((t as { agent_tool: unknown }).agent_tool);
    else if (t && typeof t === "object") refs.push(t);
  }
  for (const r of refs) {
    if (!r || typeof r !== "object") continue;
    const path = (r as { config_path?: unknown }).config_path;
    if (typeof path === "string") {
      const abs = resolveInclude(root, file, path);
      if (seen.has(abs)) continue;
      seen.add(abs);
      collectAgents(root, abs, loadYaml(root, abs, 0, []) as Record<string, unknown>, out, seen);
    } else if ("name" in r) {
      collectAgents(root, file, r as Record<string, unknown>, out, seen);
    }
  }
}

export function validateSubmission(dir: string): Validation {
  const root = resolve(dir);
  const errors: string[] = [];
  const files = listFiles(root, errors);
  const totalBytes = files.reduce((s, f) => s + f.size, 0);

  if (files.length > MAX_FILES) errors.push(`${files.length} arquivos > ${MAX_FILES}`);
  if (totalBytes >= MAX_TOTAL_BYTES) errors.push(`${totalBytes} bytes >= ${MAX_TOTAL_BYTES} (3 GiB)`);
  for (const f of files) {
    const ext = extname(f.path).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) errors.push(`${f.path}: extensão ${ext || "(nenhuma)"} não aceita`);
  }
  for (const f of files.filter((f) => f.path.startsWith("adapters/") && f.path.endsWith(".safetensors"))) {
    if (!/^adapters\/[A-Za-z0-9][A-Za-z0-9._-]*\/adapter_model\.safetensors$/.test(f.path))
      errors.push(`${f.path}: adapter fora de adapters/<nome>/adapter_model.safetensors`);
  }

  const rootConfigs = ROOT_CONFIGS.filter((n) => files.some((f) => f.path === n));
  if (rootConfigs.length !== 1) {
    errors.push(
      rootConfigs.length === 0
        ? `nenhum config raiz (${ROOT_CONFIGS.join(", ")})`
        : `mais de um config raiz: ${rootConfigs.join(", ")}`,
    );
    return { errors, files, totalBytes, models: [] };
  }

  const agents: AgentNode[] = [];
  try {
    const rootFile = join(root, rootConfigs[0]!);
    collectAgents(root, rootFile, loadYaml(root, rootFile, 0, []) as Record<string, unknown>, agents, new Set([rootFile]));
  } catch (e) {
    errors.push((e as Error).message);
    return { errors, files, totalBytes, models: [] };
  }

  const models = new Set<string>();
  const adapters = new Set(files.filter((f) => f.path.startsWith("adapters/")).map((f) => f.path.split("/")[1]!));
  for (const { file, config } of agents) {
    const where = `${toPosix(relative(root, file))} (${String(config.name ?? "?")})`;
    const cls = (config.agent_class as string | undefined) ?? "LlmAgent";
    if (typeof config.name !== "string") errors.push(`${where}: sem name`);
    if (cls !== "LlmAgent") continue;
    if (typeof config.model === "string") models.add(config.model.replace(PROVIDER_PREFIX, ""));
    else errors.push(`${where}: LlmAgent sem model`);
    if (typeof config.adapter === "string" && !adapters.has(config.adapter))
      errors.push(`${where}: adapter ${config.adapter} não existe em adapters/`);
    for (const t of (config.tools as unknown[] | undefined) ?? [])
      if (typeof t === "string" && !BUILTIN_TOOLS.includes(t)) errors.push(`${where}: ferramenta ${t} não existe no harness`);
    const gen = config.generate_content_config as Record<string, unknown> | undefined;
    const maxOut = gen?.max_output_tokens;
    if (typeof maxOut === "number" && (maxOut < 1 || maxOut > 32768)) errors.push(`${where}: max_output_tokens ${maxOut} fora de 1..32768`);
    const budget = (gen?.thinking_config as Record<string, unknown> | undefined)?.thinking_budget;
    if (typeof budget === "number" && (budget < 0 || budget > 32768)) errors.push(`${where}: thinking_budget ${budget} fora de 0..32768`);
  }
  if (models.size > 1) errors.push(`mais de um modelo base: ${[...models].join(", ")}`);
  for (const m of models) if (!ALLOWED_MODELS.includes(m)) errors.push(`modelo ${m} fora de ALLOWED_MODEL_NAMES`);

  return { errors, files, totalBytes, models: [...models] };
}
