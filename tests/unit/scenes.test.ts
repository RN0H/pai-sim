/**
 * M1: every bundled scene compiles and stays physically sane.
 * PROTECTED: see CLAUDE.md.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { GeomType, loadEngine, Sim, type Mujoco } from "../../src/physics/engine";
import { DEFAULT_SCENE_ID, findScene, SCENES } from "../../src/scenes";

let mj: Mujoco;
const sims: Sim[] = [];
const make = (xml: string) => {
  const s = new Sim(mj, xml);
  sims.push(s);
  return s;
};

beforeAll(async () => {
  mj = await loadEngine();
});
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

describe("bundled scenes", () => {
  it("has the three M1 samples with unique ids", () => {
    const ids = SCENES.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["hello", "arm", "cartpole"]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_SCENE_ID).toBe("hello");
  });

  it("findScene falls back to the default for unknown ids", () => {
    expect(findScene("arm").id).toBe("arm");
    expect(findScene("nope").id).toBe(DEFAULT_SCENE_ID);
    expect(findScene(null).id).toBe(DEFAULT_SCENE_ID);
  });

  for (const scene of SCENES) {
    describe(scene.id, () => {
      it("compiles and has something to draw", () => {
        const sim = make(scene.xml);
        const drawable = sim.geoms().filter((g) => g.rgba[3] > 0 && g.type !== GeomType.HFIELD);
        expect(drawable.length).toBeGreaterThan(2);
        expect(sim.modelName.length).toBeGreaterThan(0);
      });

      it("stays stable for 5 s with no input", () => {
        const sim = make(scene.xml);
        sim.advance(5);
        expect(sim.time).toBeCloseTo(5, 3);
        expect(sim.instabilityCount()).toBe(0);
        expect(sim.hasInvalidState()).toBe(false);
      });

      it("stays stable for 5 s with every actuator pushed back and forth at full range", () => {
        const sim = make(scene.xml);
        const { nu } = sim.model;
        const range = sim.model.actuator_ctrlrange;
        const steps = Math.round(5 / sim.timestep);
        for (let i = 0; i < steps; i++) {
          const phase = Math.floor((i * sim.timestep) / 0.75) % 2 === 0;
          for (let a = 0; a < nu; a++) sim.data.ctrl[a] = phase ? range[2 * a + 1]! : range[2 * a]!;
          sim.step();
        }
        expect(sim.instabilityCount()).toBe(0);
        expect(sim.hasInvalidState()).toBe(false);
      });
    });
  }

  it("only the hello rover offers the drive pad", () => {
    const drive = Object.fromEntries(SCENES.map((s) => [s.id, make(s.xml).hasDifferentialDrive()]));
    expect(drive).toMatchObject({ hello: true, arm: false, cartpole: false });
  });

  it("the arm holds its pose against gravity", () => {
    const sim = make(findScene("arm").xml);
    sim.advance(3);
    const id = sim.model.body("fore").id;
    // Elbow sits 0.35 m out at shoulder height (0.34 m); it should not sag far.
    expect(sim.data.xpos[3 * id + 2]!).toBeGreaterThan(0.25);
  });

  it("the arm pedestal is a mesh geom", () => {
    const sim = make(findScene("arm").xml);
    expect(sim.geoms().some((g) => g.type === GeomType.MESH && g.meshId >= 0)).toBe(true);
  });

  it("the cart-pole's pole falls over when left alone", () => {
    const sim = make(findScene("cartpole").xml);
    sim.advance(3);
    const hinge = sim.model.jnt("hinge").id;
    const angle = sim.data.qpos[sim.model.jnt_qposadr[hinge]!]!;
    expect(Math.abs(angle)).toBeGreaterThan(1);
  });
});
