import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Quest } from "@ma/core";
import { afterAll, describe, expect, it } from "vitest";

// db.ts opens its SQLite file at import time from MA_DB, so point it at a temp
// DB *before* importing the module under test.
const dir = mkdtempSync(join(tmpdir(), "ma-db-"));
process.env.MA_DB = join(dir, "test.db");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("SQLite persistence — quests survive a restart", () => {
  it("round-trips a quest by repo root", async () => {
    const db = await import("../packages/server/src/db.js");
    const quest: Quest = {
      id: "q-1",
      goal: "fix the averaging bug",
      targetUnitIds: ["unit:mean"],
      requiredUnitIds: ["unit:sum", "unit:mean"],
    };
    db.putQuest("/repos/calc", quest);

    const all = db.getAllQuests();
    const found = all.find((q) => q.quest.id === "q-1");
    expect(found).toBeDefined();
    expect(found!.repoRoot).toBe("/repos/calc");
    expect(found!.quest).toEqual(quest);
  });

  it("upserts (no duplicate rows) and reads back the latest", async () => {
    const db = await import("../packages/server/src/db.js");
    const base: Quest = { id: "q-2", goal: "g", targetUnitIds: ["t"], requiredUnitIds: ["t"] };
    db.putQuest("/repos/x", base);
    db.putQuest("/repos/x", { ...base, goal: "updated goal" });

    const rows = db.getAllQuests().filter((q) => q.quest.id === "q-2");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quest.goal).toBe("updated goal");
  });
});
