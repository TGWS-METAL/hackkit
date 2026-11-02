import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

// Formato de events/<evento>/spec.yaml (seção 5 do plano).

const commandVerifier = z.object({
  kind: z.literal("command"),
  run: z.string().min(1),
  cwd: z.string().optional(),
  timeout_s: z.number().positive().optional(),
});

const fileExistsVerifier = z.object({
  kind: z.literal("file_exists"),
  path: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  cwd: z.string().optional(),
});

const e2eVerifier = z.object({
  kind: z.literal("e2e"),
  spec: z.string().min(1),
  base_url: z.string().optional(),
  timeout_s: z.number().positive().optional(),
});

// Tipos da seção 5 que este pacote ainda não executa: entram como "skipped".
const pendingVerifier = z.looseObject({
  kind: z.enum(["leaderboard_local", "artifact_check", "judge_prompt"]),
});

export const verifierSchema = z.discriminatedUnion("kind", [
  commandVerifier,
  fileExistsVerifier,
  e2eVerifier,
  pendingVerifier,
]);

export const criterionSchema = z.object({
  id: z.string().min(1),
  weight: z.number().min(0),
  source_quote: z.string().optional(),
  verifiers: z.array(verifierSchema).min(1),
});

// O parser YAML pode devolver Date para datas sem aspas.
const dateText = z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString() : v));

export const trackSchema = z.object({
  id: z.string().min(1),
  prize_usd: z.number().min(0).optional(),
  /** Prêmio por colocação (1º, 2º, ...), quando o regulamento separa. */
  prizes_usd: z.array(z.number().min(0)).optional(),
  /** Trilha que só vale com um destes modelos (ex.: prêmio para modelo pequeno). */
  models: z.array(z.string().min(1)).optional(),
  source_quote: z.string().optional(),
  est_competitors: z.number().int().min(0).nullable().optional(),
  criteria: z.array(criterionSchema).min(1),
});

// Datas intermediárias do regulamento (entrada, fusão de equipes, entrega final).
export const milestoneSchema = z.object({
  id: z.string().min(1),
  at: dateText,
  source_quote: z.string().optional(),
});

// Cota de submissão de eventos de placar.
export const submissionsSchema = z.object({
  per_day: z.number().int().min(1),
  final_selected: z.number().int().min(1),
  source_quote: z.string().optional(),
});

export const specSchema = z.object({
  event: z.string().min(1),
  platform: z.enum(["devpost", "kaggle", "ethglobal", "dorahacks"]),
  evaluation: z.enum(["judged", "leaderboard"]),
  deadline: dateText,
  milestones: z.array(milestoneSchema).default([]),
  submissions: submissionsSchema.optional(),
  constraints: z
    .object({
      build_tool: z.string().nullable().default(null),
      runtime_model: z.string().nullable().default(null),
      required_sdks: z.array(z.string()).default([]),
    })
    .default({ build_tool: null, runtime_model: null, required_sdks: [] }),
  target_score: z.number().min(0).max(100),
  budget_usd: z.number().min(0),
  tracks: z.array(trackSchema).min(1),
  rules: z
    .object({
      ai_allowed: z.union([z.boolean(), z.literal("disclosed")]),
      preexisting_code: z.enum(["allowed", "disclosed", "forbidden"]),
      build_window: z.tuple([dateText, dateText]),
      eligibility: z
        .object({
          countries_excluded: z.array(z.string()).default([]),
          // "Somente residentes de X" (seção 11): lista de países aceitos.
          countries_allowed: z.array(z.string()).optional(),
          min_age: z.number().int().min(0).optional(),
        })
        .optional(),
    })
    .optional(),
});

export type Spec = z.infer<typeof specSchema>;
export type Criterion = z.infer<typeof criterionSchema>;
export type Verifier = z.infer<typeof verifierSchema>;

export function parseSpec(text: string): Spec {
  return specSchema.parse(parse(text));
}

export function loadSpec(path: string): Spec {
  return parseSpec(readFileSync(path, "utf8"));
}
