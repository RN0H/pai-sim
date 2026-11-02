/**
 * Tests for the test harness itself: the sanity detectors must actually fire.
 * PROTECTED: see CLAUDE.md.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadEngine, Sim, type Mujoco } from "../../src/physics/engine";

let mj: Mujoco;
beforeAll(async () => {
  mj = await loadEngine();
});

// A stiff velocity actuator on a tiny inertia with the explicit Euler
// integrator: the exact setup that made the M0 rover silently blow up.
const UNSTABLE_XML = `
<mujoco>
  <option timestep="0.002" integrator="Euler"/>
  <worldbody>
    <body>
      <joint name="j" type="hinge" axis="0 0 1"/>
      <geom type="cylinder" size="0.06 0.02" mass="0.1"/>
    </body>
  </worldbody>
  <actuator><velocity joint="j" kv="0.5"/></actuator>
</mujoco>`;

describe("Sim sanity detectors", () => {
  it("instabilityCount() detects MuJoCo's silent reset", () => {
    const sim = new Sim(mj, UNSTABLE_XML);
    for (let i = 0; i < 200; i++) {
      sim.data.ctrl[0] = 10;
      sim.step();
    }
    expect(sim.instabilityCount()).toBeGreaterThan(0);
    sim.dispose();
  });

  it("instabilityCount() stays 0 for the same model with implicitfast", () => {
    const sim = new Sim(mj, UNSTABLE_XML.replace('integrator="Euler"', 'integrator="implicitfast"'));
    for (let i = 0; i < 200; i++) {
      sim.data.ctrl[0] = 10;
      sim.step();
    }
    expect(sim.instabilityCount()).toBe(0);
    sim.dispose();
  });

  it("rejects invalid MJCF with an error instead of crashing", () => {
    expect(() => new Sim(mj, "<mujoco><worldbody><geom type='nope'/></worldbody></mujoco>")).toThrow();
  });
});
