import { dirname, resolve } from "node:path";
import { loadSpec, type Spec } from "./spec.js";
import { defaultVerifierContext, runVerifier, type VerifierContext, type VerifierResult } from "./verifiers.js";

/** Limiar da seção 5: critério abaixo dele volta como lacuna. */
export const GAP_THRESHOLD = 0.85;

export interface CriterionReport {
  id: string;
  weight: number;
  /** Média dos verificadores que rodaram (pass = 1, fail = 0); null se nenhum rodou. */
  score: number | null;
  verifiers: VerifierResult[];
}

export interface TrackReport {
  id: string;
  criteria: CriterionReport[];
  /** Soma dos pesos como estão na spec. */
  weightSum: number;
  /** 100 × Σ(peso × score) ÷ Σ(peso); critério com score null entra como 0. */
  total: number;
  /** Critérios com score abaixo de GAP_THRESHOLD ou sem verificador executado. */
  gaps: string[];
}

export interface SpecReport {
  event: string;
  targetScore: number;
  tracks: TrackReport[];
}

export async function runSpec(spec: Spec, ctx: VerifierContext): Promise<SpecReport> {
  const tracks: TrackReport[] = [];
  for (const track of spec.tracks) {
    const criteria: CriterionReport[] = [];
    for (const c of track.criteria) {
      const results: VerifierResult[] = [];
      for (const v of c.verifiers) results.push(await runVerifier(v, ctx));
      const ran = results.filter((r) => r.status !== "skipped");
      const score = ran.length === 0 ? null : ran.filter((r) => r.status === "pass").length / ran.length;
      criteria.push({ id: c.id, weight: c.weight, score, verifiers: results });
    }
    const weightSum = criteria.reduce((s, c) => s + c.weight, 0);
    const weighted = criteria.reduce((s, c) => s + c.weight * (c.score ?? 0), 0);
    tracks.push({
      id: track.id,
      criteria,
      weightSum,
      total: weightSum === 0 ? 0 : (100 * weighted) / weightSum,
      gaps: criteria.filter((c) => c.score === null || c.score < GAP_THRESHOLD).map((c) => c.id),
    });
  }
  return { event: spec.event, targetScore: spec.target_score, tracks };
}

export async function runSpecFile(
  specPath: string,
  ctx: Partial<Omit<VerifierContext, "specDir">> = {},
): Promise<SpecReport> {
  const abs = resolve(specPath);
  return runSpec(loadSpec(abs), defaultVerifierContext({ ...ctx, specDir: dirname(abs) }));
}
