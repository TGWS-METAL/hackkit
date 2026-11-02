import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { JSON_COLUMNS, PARTICIPATIONS_DDL, PARTICIPATION_COLUMNS } from "./schema.js";

export { PARTICIPATIONS_DDL, PARTICIPATION_COLUMNS } from "./schema.js";

export interface Participation {
  id?: number;
  event: string;
  platform?: string | null;
  evaluation?: "judged" | "leaderboard" | null;
  build_tool?: string | null;
  runtime_model?: string | null;
  deadline?: string | null;
  submitted_at?: string | null;
  tracks?: unknown;
  est_competitors?: unknown;
  prize_pool_usd?: number | null;
  prize_won_usd?: number;
  placement?: string | null;
  leaderboard_rank?: number | null;
  sim_score?: number | null;
  sim_score_by_criterion?: unknown;
  judge_feedback?: string | null;
  cost_usd?: number | null;
  agent_hours?: number | null;
  human_hours?: number | null;
  template?: string | null;
  sdks?: unknown;
  kit_version?: string | null;
  disqualified?: boolean;
  dq_reason?: string | null;
  notes?: string | null;
}

type Column = (typeof PARTICIPATION_COLUMNS)[number];
type SqlValue = string | number | null;

function toRow(p: Partial<Participation>): Partial<Record<Column, SqlValue>> {
  const row: Partial<Record<Column, SqlValue>> = {};
  for (const col of PARTICIPATION_COLUMNS) {
    if (!(col in p)) continue;
    const v = (p as Record<string, unknown>)[col];
    if (v === undefined) continue;
    if ((JSON_COLUMNS as readonly string[]).includes(col)) row[col] = v === null ? null : JSON.stringify(v);
    else if (col === "disqualified") row[col] = v ? 1 : 0;
    else row[col] = v as SqlValue;
  }
  return row;
}

function fromRow(r: Record<string, unknown>): Participation {
  const out: Record<string, unknown> = { ...r };
  for (const col of JSON_COLUMNS) {
    const v = r[col];
    out[col] = typeof v === "string" ? JSON.parse(v) : v;
  }
  out.disqualified = r.disqualified === 1;
  return out as unknown as Participation;
}

export class Ledger {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(PARTICIPATIONS_DDL);
  }

  insert(p: Participation): number {
    const row = toRow(p);
    const cols = Object.keys(row);
    const sql = `insert into participations (${cols.join(", ")}) values (${cols.map(() => "?").join(", ")})`;
    const res = this.db.prepare(sql).run(...cols.map((c) => row[c as Column] as SqlValue));
    return Number(res.lastInsertRowid);
  }

  update(id: number, patch: Partial<Participation>): void {
    const row = toRow(patch);
    const cols = Object.keys(row);
    if (cols.length === 0) return;
    const sql = `update participations set ${cols.map((c) => `${c} = ?`).join(", ")} where id = ?`;
    this.db.prepare(sql).run(...cols.map((c) => row[c as Column] as SqlValue), id);
  }

  get(id: number): Participation | undefined {
    const r = this.db.prepare("select * from participations where id = ?").get(id);
    return r ? fromRow(r as Record<string, unknown>) : undefined;
  }

  list(event?: string): Participation[] {
    const rows = event
      ? this.db.prepare("select * from participations where event = ? order by id").all(event)
      : this.db.prepare("select * from participations order by id").all();
    return rows.map((r) => fromRow(r as Record<string, unknown>));
  }

  close(): void {
    this.db.close();
  }
}

export function openLedger(path = "runs/ledger.db"): Ledger {
  return new Ledger(path);
}
