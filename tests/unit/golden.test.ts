/**
 * M2: golden trajectories for the three templates. Replays a scripted drive
 * and compares it with tests/golden/templates.json (made by `npm run golden`).
 * PROTECTED: never regenerate the golden file to make a change pass; see CLAUDE.md.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadEngine, type Mujoco } from "../../src/physics/engine";
import { TEMPLATES } from "../../src/robot/templates";
import { SAMPLE_EVERY, SCRIPT, trajectory, type Sample } from "../golden/trajectory";

/** Position tolerance (m) and heading tolerance (rad). */
const POS_TOL = 2e-3;
const YAW_TOL = 1e-2;

const golden = JSON.parse(readFileSync(new URL("../golden/templates.json", import.meta.url), "utf8")) as {
  script: typeof SCRIPT;
  sampleEvery: number;
  templates: Record<string, Sample[]>;
};

let mj: Mujoco;
beforeAll(async () => {
  mj = await loadEngine();
});

describe("golden trajectories", () => {
  it("were generated with the current drive script", () => {
    expect(golden.script).toEqual(SCRIPT);
    expect(golden.sampleEvery).toBe(SAMPLE_EVERY);
    expect(Object.keys(golden.templates).sort()).toEqual(TEMPLATES.map((t) => t.id).sort());
  });

  for (const t of TEMPLATES) {
    it(`${t.spec.name} follows its golden trajectory`, () => {
      const expected = golden.templates[t.id]!;
      const actual = trajectory(mj, t.spec);
      expect(actual.length).toBe(expected.length);
      // The robot really goes somewhere: the golden data isn't trivially still.
      const end = expected.at(-1)!;
      expect(Math.hypot(end[1], end[2])).toBeGreaterThan(0.2);
      for (let i = 0; i < expected.length; i++) {
        const [te, xe, ye, ze, yawe] = expected[i]!;
        const [ta, xa, ya, za, yawa] = actual[i]!;
        const where = `${t.id} at t=${te}s`;
        expect(ta, where).toBeCloseTo(te, 6);
        expect(Math.hypot(xa - xe, ya - ye, za - ze), where).toBeLessThan(POS_TOL);
        const dYaw = Math.atan2(Math.sin(yawa - yawe), Math.cos(yawa - yawe));
        expect(Math.abs(dYaw), where).toBeLessThan(YAW_TOL);
      }
    });
  }
});
