import { describe, expect, it } from "vitest";
import { dealSpec } from "./pipeline.server";
import { parseStartupRules } from "./parse";

// Limits from https://docs.tinyfish.ai/datasets/reference. TinySet rejects specs that break them.
describe("TinySet spec stays within API limits", () => {
  for (const stage of ["Seed", "Any stage"]) {
    const spec = dealSpec(
      parseStartupRules("AI bookkeeping for small businesses", stage, "Brazil"),
    );
    it(`(${stage}) 1-10 columns, exactly one primary key, never boolean`, () => {
      expect(spec.columns.length).toBeGreaterThan(0);
      expect(spec.columns.length).toBeLessThanOrEqual(10);
      const keys = spec.columns.filter((c) => c.is_primary_key);
      expect(keys).toHaveLength(1);
      expect(keys[0]!.type).not.toBe("boolean");
    });
    it(`(${stage}) field sizes`, () => {
      expect(spec.name.length).toBeLessThanOrEqual(200);
      for (const c of spec.columns) {
        expect(["string", "number", "boolean", "url", "date"]).toContain(c.type);
        expect((c as { examples?: string[] }).examples?.length ?? 0).toBeLessThanOrEqual(3);
        expect((c as { retrieval_hint?: string }).retrieval_hint?.length ?? 0).toBeLessThanOrEqual(
          2000,
        );
        expect((c as { format?: string }).format?.length ?? 0).toBeLessThanOrEqual(2000);
        expect(c.label?.length ?? 0).toBeLessThanOrEqual(200);
      }
      const keep = spec.columns.find((c) => c.name === spec.keep_when.column);
      expect(keep?.type).toBe("boolean");
    });
  }

  it("treats 'Any stage' as any round", () => {
    const p = parseStartupRules("Payroll for restaurants", "Any stage", "Mexico");
    expect(p.stage).toBe("any");
    expect(dealSpec(p).description).toContain("at any stage");
  });
});
