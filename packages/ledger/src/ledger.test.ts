import { describe, expect, it } from "vitest";
import { openLedger, PARTICIPATION_COLUMNS } from "./index.js";

describe("ledger", () => {
  it("cria a tabela participations com as colunas da seção 12", () => {
    const l = openLedger(":memory:");
    const cols = (l.db.prepare("pragma table_info(participations)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(["id", ...PARTICIPATION_COLUMNS]);
    l.close();
  });

  it("grava e lê uma participação com campos JSON e defaults", () => {
    const l = openLedger(":memory:");
    const id = l.insert({
      event: "kiroween-2026",
      platform: "devpost",
      evaluation: "judged",
      build_tool: "kiro",
      tracks: [{ id: "main", prize_usd: 0 }],
      sdks: ["foo"],
      sim_score_by_criterion: { implementation: 0.9 },
    });
    const p = l.get(id)!;
    expect(p.event).toBe("kiroween-2026");
    expect(p.tracks).toEqual([{ id: "main", prize_usd: 0 }]);
    expect(p.sdks).toEqual(["foo"]);
    expect(p.prize_won_usd).toBe(0);
    expect(p.disqualified).toBe(false);
    expect(p.est_competitors).toBeNull();
    l.close();
  });

  it("atualiza e filtra por evento", () => {
    const l = openLedger(":memory:");
    const a = l.insert({ event: "a" });
    l.insert({ event: "b" });
    l.update(a, { cost_usd: 12.5, disqualified: true, dq_reason: "janela" });
    const rows = l.list("a");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost_usd).toBe(12.5);
    expect(rows[0]!.disqualified).toBe(true);
    expect(l.list()).toHaveLength(2);
    l.close();
  });
});
