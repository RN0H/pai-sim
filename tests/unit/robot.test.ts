/**
 * M2: the parts → MJCF compiler. Every part combination must compile, settle
 * upright, drive and stay stable; specs are validated before MuJoCo sees them.
 * PROTECTED: see CLAUDE.md.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEngine, Sim, type Mujoco } from "../../src/physics/engine";
import { compile, ROBOT_BODY, tryCompile, xmlAttr } from "../../src/robot/compile";
import { CASTERS, CHASSIS, findPart, MOTORS, PARTS, SENSORS, WHEELS } from "../../src/robot/parts";
import { SpecError, SPEC_VERSION, validateSpec, type RobotSpec } from "../../src/robot/spec";
import { TEMPLATES, templateSpec } from "../../src/robot/templates";
import { HELLO_XML } from "../../src/scenes/hello";

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

const base = (): RobotSpec => ({
  version: SPEC_VERSION,
  name: "Test bot",
  chassis: "chassis_medium",
  wheels: "wheel_small",
  motor: "motor_fast",
  caster: "caster_ball",
  sensors: [],
});

function pose(sim: Sim) {
  const id = sim.bodyId(ROBOT_BODY);
  const p = sim.data.xpos;
  const m = sim.data.xmat; // row-major 3x3; column 2 is the body's z axis in world
  return { x: p[3 * id]!, y: p[3 * id + 1]!, z: p[3 * id + 2]!, upZ: m[9 * id + 8]! };
}

function run(sim: Sim, left: number, right: number, seconds: number, onStep?: () => void) {
  const l = sim.actuatorId("left");
  const r = sim.actuatorId("right");
  const n = Math.round(seconds / sim.timestep);
  for (let i = 0; i < n; i++) {
    sim.data.ctrl[l] = left;
    sim.data.ctrl[r] = right;
    sim.step();
    onStep?.();
  }
}

const sensor = (sim: Sim, name: string): number => sim.readSensor(name);

describe("parts library", () => {
  it("has the planned parts with unique ids", () => {
    expect(CHASSIS).toHaveLength(3);
    expect(WHEELS).toHaveLength(2);
    expect(MOTORS).toHaveLength(2);
    expect(CASTERS.length).toBeGreaterThanOrEqual(1);
    expect(SENSORS.map((s) => s.id)).toEqual(["distance", "line"]);
    const keys = PARTS.map((p) => `${p.kind}:${p.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("parts are physically sensible", () => {
    for (const c of CHASSIS) {
      expect(c.mass).toBeGreaterThan(0.1);
      expect(c.mass).toBeLessThan(5);
      expect(Math.min(...c.halfSize)).toBeGreaterThan(0.005);
    }
    for (const w of WHEELS) {
      expect(w.radius).toBeGreaterThan(0.02);
      expect(w.radius).toBeLessThan(0.15);
      expect(w.friction).toBeGreaterThan(0.6);
    }
    for (const m of MOTORS) {
      expect(m.maxTorque).toBeGreaterThan(0);
      expect(m.maxTorque).toBeLessThan(5);
      expect(m.maxSpeed).toBeGreaterThan(0);
    }
    const [fast, strong] = [findPart("motor", "motor_fast")!, findPart("motor", "motor_strong")!];
    expect(fast.maxSpeed).toBeGreaterThan(strong.maxSpeed);
    expect(strong.maxTorque).toBeGreaterThan(fast.maxTorque);
    for (const c of CASTERS) expect(c.friction).toBeLessThan(0.2);
  });
});

describe("spec validation", () => {
  it("accepts a valid spec and returns a clean copy", () => {
    const input = { ...base(), sensors: ["distance"], color: "#AABBCC", extra: "ignored" };
    const res = validateSpec(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec).toEqual({ ...base(), sensors: ["distance"], color: "#AABBCC" });
    expect(res.spec.sensors).not.toBe(input.sensors);
  });

  const bad: [string, unknown, RegExp][] = [
    ["not an object", 42, /object/],
    ["null", null, /object/],
    ["an array", [], /object/],
    ["wrong version", { ...base(), version: 99 }, /version/],
    ["missing name", { ...base(), name: "  " }, /name/],
    ["long name", { ...base(), name: "x".repeat(41) }, /too long/],
    ["unknown chassis", { ...base(), chassis: "chassis_huge" }, /no chassis called "chassis_huge".*chassis_small/],
    ["missing wheels", { ...base(), wheels: undefined }, /Pick a wheel size/],
    ["unknown motor", { ...base(), motor: "warp" }, /no motor called "warp"/],
    ["unknown caster", { ...base(), caster: 3 }, /caster/],
    ["sensors not a list", { ...base(), sensors: "distance" }, /sensors list/],
    ["unknown sensor", { ...base(), sensors: ["laser"] }, /no sensor called "laser"/],
    ["duplicate sensor", { ...base(), sensors: ["line", "line"] }, /listed twice/],
    ["bad colour", { ...base(), color: "red" }, /colour/],
    ["a control character in the name", { ...base(), name: "a\u0000b" }, /hidden or broken character/],
    ["a line break in the name", { ...base(), name: "two\nlines" }, /hidden or broken character/],
    ["a broken unicode character in the name", { ...base(), name: "bad \uD800 name" }, /hidden or broken character/],
    ["a stray low surrogate in the name", { ...base(), name: "bad \uDC00 name" }, /hidden or broken character/],
    ["a stray low surrogate starting the name", { ...base(), name: "\uDC00name" }, /hidden or broken character/],
    ["a huge sensors list", { ...base(), sensors: new Array(100_000).fill("laser") }, /at most one of each/],
  ];
  for (const [label, input, message] of bad) {
    it(`rejects ${label} with a readable error`, () => {
      const res = validateSpec(input);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.errors.join("\n")).toMatch(message);
      for (const e of res.errors) expect(e).toMatch(/^[A-Z].*[.]$/); // full sentences
    });
  }

  it("reports every problem at once", () => {
    const res = validateSpec({ version: 1, name: "", chassis: "x", wheels: "y", motor: "z", caster: "c", sensors: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps error lists short, even for huge inputs", () => {
    const res = validateSpec({ ...base(), sensors: new Array(1_000_000).fill(0) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.length).toBeLessThan(10);
  });

  it("ignores inherited fields", () => {
    expect(validateSpec(Object.create(base())).ok).toBe(false);
  });

  it("never throws, even for objects that throw when read", () => {
    const nasty = new Proxy({}, { get: () => { throw new Error("boom"); }, has: () => true, getOwnPropertyDescriptor: () => { throw new Error("boom"); } });
    expect(() => validateSpec(nasty)).not.toThrow();
    expect(validateSpec(nasty).ok).toBe(false);
  });

  it("never throws, whatever it is given", () => {
    for (const input of [undefined, "", "{}", [1], { sensors: [null, {}] }, { name: 5, color: 7 }, Object.create(null)]) {
      expect(() => validateSpec(input)).not.toThrow();
      expect(validateSpec(input).ok).toBe(false);
    }
  });
});

describe("compile", () => {
  it("throws SpecError for invalid specs before reaching MuJoCo", () => {
    const spec = { ...base(), chassis: "nope" } as unknown as RobotSpec;
    expect(() => compile(spec)).toThrow(SpecError);
    try {
      compile(spec);
    } catch (e) {
      expect((e as SpecError).errors[0]).toMatch(/no chassis/);
    }
    const res = tryCompile({ ...base(), motor: "nope" });
    expect(res.ok).toBe(false);
  });

  it("always uses implicitfast, names actuators left/right and sensors predictably", () => {
    const xml = compile({ ...base(), sensors: ["distance", "line"] });
    expect(xml).toContain('integrator="implicitfast"');
    const sim = make(xml);
    expect(sim.actuatorNames()).toEqual(["left", "right"]);
    expect(sim.hasDifferentialDrive()).toBe(true);
    expect(sim.model.nsensor).toBe(3);
    expect(sim.sensorNames()).toEqual(["distance", "line_left", "line_right"]);
    expect(sim.modelName).toBe("Test bot");
  });

  it("adds only the sensors asked for", () => {
    expect(make(compile(base())).model.nsensor).toBe(0);
    expect(make(compile({ ...base(), sensors: ["distance"] })).model.nsensor).toBe(1);
    expect(make(compile({ ...base(), sensors: ["line"] })).model.nsensor).toBe(2);
  });

  it("escapes the robot's name so any text is safe", () => {
    const name = `Bob's "<bot>" & co`;
    expect(xmlAttr(name)).not.toMatch(/[<>"']/);
    const sim = make(compile({ ...base(), name }));
    expect(sim.modelName).toBe(name);
  });

  it("any name that validates loads in MuJoCo and round-trips", () => {
    const names = [`Bob's "<bot>" & co`, "ロボ 🤖", "]]> <!-- x", "&amp; &#0; &lt;", "  padded  ", "ünïcødé ✓", "a\u00a0b"];
    for (const name of names) {
      const res = tryCompile({ ...base(), name });
      expect(res.ok, name).toBe(true);
      if (!res.ok) continue;
      expect(make(res.xml).modelName, name).toBe(name);
    }
  });

  it("rejects a non-finite or far-away start pose instead of building a broken model", () => {
    for (const pose of [
      { x: NaN, y: 0, yaw: 0 },
      { x: 0, y: Infinity, yaw: 0 },
      { x: 0, y: 0, yaw: -Infinity },
      { x: 1e9, y: 0, yaw: 0 },
      { x: "1", y: 0, yaw: 0 } as unknown as { x: number; y: number; yaw: number },
    ]) {
      const res = tryCompile(base(), { pose });
      expect(res.ok, JSON.stringify(pose)).toBe(false);
      expect(() => compile(base(), { pose })).toThrow(SpecError);
    }
  });

  it("is a pure function: same spec, same XML", () => {
    expect(compile(base())).toBe(compile(base()));
  });

  it("places the robot at the requested pose", () => {
    const sim = make(compile(base(), { pose: { x: 1, y: -2, yaw: Math.PI / 2 } }));
    sim.advance(0.5);
    const p = pose(sim);
    expect(p.x).toBeCloseTo(1, 2);
    expect(p.y).toBeCloseTo(-2, 2);
    // Driving forward now moves along +y.
    run(sim, 8, 8, 1);
    const q = pose(sim);
    expect(q.y - p.y).toBeGreaterThan(0.15);
    expect(Math.abs(q.x - p.x)).toBeLessThan(0.05);
  });
});

describe("every part combination", () => {
  for (const chassis of CHASSIS) {
    for (const wheels of WHEELS) {
      for (const motor of MOTORS) {
        for (const sensors of [[], ["distance"], ["line"], ["distance", "line"]] as RobotSpec["sensors"][]) {
          const label = [chassis.id, wheels.id, motor.id, ...sensors].join(" + ");
          it(label, () => {
            const spec: RobotSpec = { ...base(), chassis: chassis.id, wheels: wheels.id, motor: motor.id, sensors };
            const sim = make(compile(spec));
            let minUp = 1;
            const watch = () => (minUp = Math.min(minUp, pose(sim).upZ));

            // Settles upright, resting on its wheels.
            run(sim, 0, 0, 1, watch);
            const rest = pose(sim);
            expect(rest.upZ).toBeGreaterThan(0.98);
            expect(rest.z).toBeCloseTo(wheels.radius, 2);
            expect(Math.hypot(rest.x, rest.y)).toBeLessThan(0.01);

            // Drives forward >= 0.3 m in 2 s at full speed, roughly straight.
            const top = motor.maxSpeed;
            run(sim, top, top, 2, watch);
            const moved = pose(sim);
            expect(moved.x - rest.x).toBeGreaterThanOrEqual(0.3);
            expect(Math.abs(moved.y - rest.y)).toBeLessThan(0.05 * (moved.x - rest.x));

            // Slams into reverse, then spins in place: never tips over.
            run(sim, -top, -top, 1, watch);
            run(sim, -top, top, 1, watch);
            run(sim, 0, 0, 0.5, watch);
            expect(minUp).toBeGreaterThan(0.95); // never tilts more than ~18°
            expect(sim.instabilityCount()).toBe(0);
            expect(sim.hasInvalidState()).toBe(false);
          });
        }
      }
    }
  }
});

describe("sensors", () => {
  const WALL = `
    <geom name="wall" type="box" size="0.05 1 0.2" pos="1.05 0 0.2" rgba="0.8 0.3 0.3 1"/>`;

  it("distance reads -1 with nothing ahead and the gap to a wall in front", () => {
    const open = make(compile({ ...base(), sensors: ["distance"] }));
    open.advance(0.5);
    expect(sensor(open, "distance")).toBe(-1);

    const sim = make(compile({ ...base(), sensors: ["distance"] }, { world: WALL }));
    sim.advance(0.5);
    const hx = findPart("chassis", "chassis_medium")!.halfSize[0];
    const expected = 1.0 - (pose(sim).x + hx + 0.012); // wall face minus sensor tip
    expect(sensor(sim, "distance")).toBeCloseTo(expected, 2);
  });

  it("line probes read their height above the floor and see a strip on it", () => {
    const strip = `
    <geom name="strip" type="box" size="0.02 0.5 0.002" pos="0.3 0 0.002" rgba="0.1 0.1 0.1 1" contype="0" conaffinity="0"/>`;
    const sim = make(compile({ ...base(), sensors: ["line"] }, { world: strip }));
    sim.advance(0.5);
    const floorReading = sensor(sim, "line_left");
    expect(floorReading).toBeGreaterThan(0.005);
    expect(floorReading).toBeLessThan(0.05);
    expect(sensor(sim, "line_right")).toBeCloseTo(floorReading, 4);
    // A robot parked with its probes over the strip reads 4 mm less.
    const hx = findPart("chassis", "chassis_medium")!.halfSize[0];
    const parked = make(compile({ ...base(), sensors: ["line"] }, { world: strip, pose: { x: 0.3 - (hx - 0.012), y: 0, yaw: 0 } }));
    parked.advance(0.5);
    expect(floorReading - sensor(parked, "line_left")).toBeCloseTo(0.004, 3);
    expect(floorReading - sensor(parked, "line_right")).toBeCloseTo(0.004, 3);
    // Driving across it, the reading dips while the probe passes over.
    const l = sim.actuatorId("left");
    const r = sim.actuatorId("right");
    let minSeen = floorReading;
    let maxAfter = 0;
    for (let i = 0; i < 3000 && pose(sim).x + hx < 0.5; i++) {
      sim.data.ctrl[l] = 4;
      sim.data.ctrl[r] = 4;
      sim.step();
      const v = sensor(sim, "line_left");
      minSeen = Math.min(minSeen, v);
      if (pose(sim).x + hx - 0.012 > 0.34) maxAfter = Math.max(maxAfter, v);
    }
    expect(floorReading - minSeen).toBeGreaterThan(0.003);
    expect(maxAfter - minSeen).toBeGreaterThan(0.003);
  });
});

describe("templates", () => {
  it("has Scout, Hauler and Sensor bot, all valid", () => {
    expect(TEMPLATES.map((t) => t.spec.name)).toEqual(["Scout", "Hauler", "Sensor bot"]);
    for (const t of TEMPLATES) expect(validateSpec(t.spec).ok).toBe(true);
    const sensorBot = TEMPLATES.find((t) => t.id === "sensor-bot")!;
    expect(sensorBot.spec.sensors).toEqual(expect.arrayContaining(["distance", "line"]));
  });

  it("Scout is faster than Hauler; Hauler is stronger", () => {
    const scout = TEMPLATES[0]!.spec;
    const hauler = TEMPLATES[1]!.spec;
    expect(findPart("motor", scout.motor)!.maxSpeed).toBeGreaterThan(findPart("motor", hauler.motor)!.maxSpeed);
    expect(findPart("motor", hauler.motor)!.maxTorque).toBeGreaterThan(findPart("motor", scout.motor)!.maxTorque);
    expect(findPart("chassis", scout.chassis)!.mass).toBeLessThan(findPart("chassis", hauler.chassis)!.mass);
  });

  it("templateSpec returns an independent copy", () => {
    const a = templateSpec("scout");
    a.sensors.push("distance");
    expect(templateSpec("scout").sensors).toEqual([]);
    expect(templateSpec("unknown").name).toBe("Scout");
  });

  it("the hello scene's rover is a compiled template", () => {
    const fragment = compile(templateSpec("hauler"));
    const roverBody = fragment.slice(fragment.indexOf(`<body name="${ROBOT_BODY}"`), fragment.indexOf("</worldbody>"));
    expect(HELLO_XML).toContain(roverBody.trim());
  });
});
