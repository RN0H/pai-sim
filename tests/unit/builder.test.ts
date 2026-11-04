/**
 * M3: the builder's pure logic (src/ui/builderModel.ts). The panel itself is
 * covered by tests/e2e/builder.spec.ts.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEngine, Sim, type Mujoco } from "../../src/physics/engine";
import { ROBOT_BODY } from "../../src/robot/compile";
import { CHASSIS, MOTORS, SENSORS, WHEELS } from "../../src/robot/parts";
import { validateSpec } from "../../src/robot/spec";
import { TEMPLATES, templateSpec } from "../../src/robot/templates";
import {
  buildScene,
  builderErrors,
  partOptions,
  sensorOptions,
  withColor,
  withName,
  withPart,
  withSensor,
} from "../../src/ui/builderModel";

let mj: Mujoco;
const sims: Sim[] = [];
beforeAll(async () => {
  mj = await loadEngine();
});
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

describe("builder options", () => {
  it("offers every chassis, wheel, motor and sensor part, with a label and a detail line", () => {
    expect(partOptions("chassis").map((o) => o.id)).toEqual(CHASSIS.map((p) => p.id));
    expect(partOptions("wheels").map((o) => o.id)).toEqual(WHEELS.map((p) => p.id));
    expect(partOptions("motor").map((o) => o.id)).toEqual(MOTORS.map((p) => p.id));
    expect(sensorOptions().map((o) => o.id)).toEqual(SENSORS.map((p) => p.id));
    for (const o of [...partOptions("chassis"), ...partOptions("wheels"), ...partOptions("motor"), ...sensorOptions()]) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.detail.length).toBeGreaterThan(0);
    }
  });

  it("describes chassis sizes in plain units", () => {
    expect(partOptions("chassis")[0]!.detail).toBe("14 cm × 11 cm, 350 g");
  });
});

describe("editing a spec", () => {
  it("swaps a part without touching the original", () => {
    const s = templateSpec("scout");
    const t = withPart(s, "chassis", "chassis_large");
    expect(t.chassis).toBe("chassis_large");
    expect(s.chassis).toBe("chassis_small");
    expect({ ...t, chassis: s.chassis }).toEqual(s);
  });

  it("adds and removes sensors, keeping library order and no duplicates", () => {
    let s = templateSpec("scout");
    s = withSensor(s, "line", true);
    s = withSensor(s, "distance", true);
    s = withSensor(s, "distance", true);
    expect(s.sensors).toEqual(["distance", "line"]);
    s = withSensor(s, "distance", false);
    expect(s.sensors).toEqual(["line"]);
    expect(templateSpec("scout").sensors).toEqual([]);
  });

  it("renames and repaints", () => {
    const s = withColor(withName(templateSpec("hauler"), "Zippy"), "#123456");
    expect(s.name).toBe("Zippy");
    expect(s.color).toBe("#123456");
    expect(validateSpec(s).ok).toBe(true);
  });
});

describe("builder errors", () => {
  it("are empty for every template", () => {
    for (const t of TEMPLATES) expect(builderErrors(templateSpec(t.id))).toEqual({ name: [], other: [] });
  });

  it("attribute name problems to the name field in plain language", () => {
    const s = templateSpec("scout");
    const empty = builderErrors(withName(s, "  "));
    expect(empty.name).toEqual(["Give the robot a name."]);
    expect(empty.other).toEqual([]);
    const long = builderErrors(withName(s, "x".repeat(41)));
    expect(long.name[0]).toMatch(/too long \(41 characters\)/);
    expect(builderErrors(withName(s, "a\nb")).name[0]).toMatch(/hidden or broken character/);
  });

  it("keep other problems separate from the name", () => {
    const s = withName(withPart(templateSpec("scout"), "motor", "motor_jet"), "");
    const errs = builderErrors(s);
    expect(errs.name).toEqual(["Give the robot a name."]);
    expect(errs.other).toHaveLength(1);
    expect(errs.other[0]).toMatch(/no motor called "motor_jet"/);
  });
});

describe("buildScene", () => {
  it("returns errors instead of throwing for an invalid spec", () => {
    const r = buildScene(withName(templateSpec("scout"), ""));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(["Give the robot a name."]);
  });

  it("builds every part combination the panel can make into a drivable scene", () => {
    for (const chassis of partOptions("chassis"))
      for (const wheels of partOptions("wheels"))
        for (const motor of partOptions("motor")) {
          let spec = templateSpec("scout");
          spec = withPart(spec, "chassis", chassis.id);
          spec = withPart(spec, "wheels", wheels.id);
          spec = withPart(spec, "motor", motor.id);
          spec = withSensor(withSensor(spec, "distance", true), "line", true);
          const r = buildScene(spec);
          expect(r.ok, `${chassis.id}/${wheels.id}/${motor.id}`).toBe(true);
          if (!r.ok) continue;
          const sim = new Sim(mj, r.xml);
          sims.push(sim);
          expect(sim.actuatorId("left")).toBeGreaterThanOrEqual(0);
          expect(sim.actuatorId("right")).toBeGreaterThanOrEqual(0);
          expect(sim.sensorNames().sort()).toEqual(["distance", "line_left", "line_right"]);
          const id = sim.bodyId(ROBOT_BODY);
          const x0 = sim.data.xpos[3 * id]!;
          const top = MOTORS.find((m) => m.id === motor.id)!.maxSpeed;
          for (let i = 0; i < 500; i++) {
            sim.data.ctrl[sim.actuatorId("left")] = top;
            sim.data.ctrl[sim.actuatorId("right")] = top;
            sim.step();
          }
          expect(sim.data.xpos[3 * id]! - x0, `${chassis.id}/${wheels.id}/${motor.id}`).toBeGreaterThan(0.1);
          expect(sim.instabilityCount()).toBe(0);
          sim.dispose();
          sims.pop();
        }
  });
});
