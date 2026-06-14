import { describe, expect, it } from "vitest";
import type { CertificationReport } from "../packages/server/src/certify.js";
import { rankReports } from "../packages/server/src/certify.js";

function report(agent: string, passed: number, gradable: number): CertificationReport {
  return {
    agent,
    totalUnits: gradable,
    gradable,
    passed,
    passRate: gradable ? passed / gradable : 0,
    weakest: [],
    results: [],
  };
}

describe("certification leaderboard (rankReports)", () => {
  it("ranks by pass rate, best first", () => {
    const ranked = rankReports([report("lazy", 0, 6), report("gpt", 4, 6), report("oracle", 6, 6)]);
    expect(ranked.map((r) => r.agent)).toEqual(["oracle", "gpt", "lazy"]);
  });

  it("breaks ties by absolute units passed, then agent name", () => {
    // same passRate (1/2 == 2/4) -> more absolute passes wins
    const ranked = rankReports([report("a", 1, 2), report("b", 2, 4)]);
    expect(ranked[0]!.agent).toBe("b");

    // identical rate and absolute passes -> stable by name
    const tie = rankReports([report("zeta", 1, 2), report("alpha", 1, 2)]);
    expect(tie.map((r) => r.agent)).toEqual(["alpha", "zeta"]);
  });

  it("does not mutate the input array", () => {
    const input = [report("a", 0, 1), report("b", 1, 1)];
    const order = input.map((r) => r.agent);
    rankReports(input);
    expect(input.map((r) => r.agent)).toEqual(order);
  });
});
