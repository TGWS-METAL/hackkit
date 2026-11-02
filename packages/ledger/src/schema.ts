// Tabela da seção 12 do plano.
export const PARTICIPATIONS_DDL = `
create table if not exists participations (
  id integer primary key,
  event text, platform text, evaluation text,      -- judged | leaderboard
  build_tool text, runtime_model text,
  deadline text, submitted_at text,
  tracks text,                                     -- JSON
  est_competitors text,                            -- JSON por trilha
  prize_pool_usd integer, prize_won_usd integer default 0,
  placement text, leaderboard_rank integer,
  sim_score real, sim_score_by_criterion text,     -- JSON
  judge_feedback text,
  cost_usd real, agent_hours real, human_hours real,
  template text, sdks text, kit_version text,
  disqualified integer default 0, dq_reason text,
  notes text
);
`;

export const PARTICIPATION_COLUMNS = [
  "event", "platform", "evaluation",
  "build_tool", "runtime_model",
  "deadline", "submitted_at",
  "tracks", "est_competitors",
  "prize_pool_usd", "prize_won_usd",
  "placement", "leaderboard_rank",
  "sim_score", "sim_score_by_criterion",
  "judge_feedback",
  "cost_usd", "agent_hours", "human_hours",
  "template", "sdks", "kit_version",
  "disqualified", "dq_reason",
  "notes",
] as const;

/** Colunas que guardam JSON serializado. */
export const JSON_COLUMNS = ["tracks", "est_competitors", "sim_score_by_criterion", "sdks"] as const;
