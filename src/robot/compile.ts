/**
 * Parts → MJCF compiler: `compile(spec)` turns a RobotSpec into a complete,
 * valid MuJoCo model. Pure string building: no MuJoCo, no DOM, so it runs
 * anywhere and is cheap to call on every builder change.
 *
 * Robot layout (MuJoCo is z-up, the robot faces +x):
 * - body `rover` (free joint) carrying the chassis box, two ball casters
 *   (front and back, so the robot can't tip either way) and the sensors;
 * - wheels `wheel_left` / `wheel_right` on hinge joints of the same names at
 *   the chassis centre, so the robot turns on the spot;
 * - velocity actuators `left` / `right` (ctrl = target wheel speed in rad/s,
 *   positive drives forward);
 * - sensors named after the sensor part's outputs (`distance`,
 *   `line_left`, `line_right`).
 */
import { findPart, type CasterPart, type ChassisPart, type MotorPart, type WheelPart } from "./parts";
import { SpecError, validateSpec, type RobotSpec } from "./spec";

export interface Pose {
  x: number;
  y: number;
  /** Heading in radians, counter-clockwise from +x. */
  yaw: number;
}

export interface CompileOptions {
  /** Where the robot starts (it is placed with its wheels on z = 0). Default: origin, facing +x. */
  pose?: Pose;
  /** `<mujoco model=...>`; defaults to the robot's name. */
  modelName?: string;
  /** Add a ground plane and a light. Default true. */
  floor?: boolean;
  /** Extra MJCF placed inside `<worldbody>` (environment props). Trusted, not escaped. */
  world?: string;
}

/** Simulation timestep for compiled robots, in seconds. */
export const TIMESTEP = 0.002;
/** Name of the robot's root body. */
export const ROBOT_BODY = "rover";
/** Gap between the chassis side and the tyre. */
const WHEEL_GAP = 0.004;
/** Wheel joint armature (motor rotor + gearbox inertia); keeps light wheels stable. */
const WHEEL_ARMATURE = 0.003;
/** How far the caster balls sit above the ground when the robot is level. */
const CASTER_LIFT = 0.003;
const DEFAULT_COLOR = "#3366cc";
const SENSOR_RGBA = "0.12 0.14 0.2 1";
/** Visual-only geom: no collisions, no mass. */
const VISUAL = `contype="0" conaffinity="0" mass="0"`;

const fmt = (n: number): string => {
  const v = Number(n.toFixed(6));
  return Object.is(v, -0) ? "0" : String(v);
};
const vec = (...xs: number[]) => xs.map(fmt).join(" ");

/** Escape text for use inside a double-quoted XML attribute. */
export function xmlAttr(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function hexToRgba(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return vec(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
}

interface Parts {
  chassis: ChassisPart;
  wheel: WheelPart;
  motor: MotorPart;
  caster: CasterPart;
}

function resolve(spec: RobotSpec): Parts {
  return {
    chassis: findPart("chassis", spec.chassis)!,
    wheel: findPart("wheel", spec.wheels)!,
    motor: findPart("motor", spec.motor)!,
    caster: findPart("caster", spec.caster)!,
  };
}

/** The robot as MJCF fragments, for composing into a larger scene. */
export interface RobotFragments {
  /** A `<body>` element for inside `<worldbody>`. */
  body: string;
  /** Elements for inside `<actuator>`. */
  actuators: string;
  /** Elements for inside `<sensor>` (may be empty). */
  sensors: string;
}

function wheelBody(side: "left" | "right", p: Parts): string {
  const { chassis, wheel } = p;
  const y = (side === "left" ? 1 : -1) * (chassis.halfSize[1] + WHEEL_GAP + wheel.halfWidth);
  const r = wheel.radius;
  return `
      <body name="wheel_${side}" pos="${vec(0, y, 0)}">
        <joint name="wheel_${side}" type="hinge" axis="0 1 0" armature="${fmt(WHEEL_ARMATURE)}" damping="0.001"/>
        <geom name="wheel_${side}" type="cylinder" size="${vec(r, wheel.halfWidth)}" zaxis="0 1 0" mass="${fmt(wheel.mass)}" friction="${fmt(wheel.friction)} 0.005 0.0001" rgba="0.1 0.1 0.11 1"/>
        <geom type="box" size="${vec(r * 0.75, wheel.halfWidth * 1.05, r * 0.12)}" rgba="0.75 0.77 0.8 1" ${VISUAL}/>
      </body>`;
}

function casterGeoms(end: "front" | "back", p: Parts): string {
  const { chassis, wheel, caster } = p;
  const rc = caster.radius;
  const x = (end === "front" ? 1 : -1) * (chassis.halfSize[0] - rc);
  // Balls sit slightly above the ground so the wheels carry the weight (good
  // grip) and the robot rocks onto a caster only when it pitches.
  const z = -(wheel.radius - rc) + CASTER_LIFT;
  const strutTop = -chassis.halfSize[2];
  const strut =
    z + rc < strutTop
      ? `\n      <geom type="cylinder" fromto="${vec(x, 0, strutTop, x, 0, z)}" size="0.004" rgba="0.55 0.57 0.6 1" ${VISUAL}/>`
      : "";
  return `${strut}
      <geom name="caster_${end}" type="sphere" size="${fmt(rc)}" pos="${vec(x, 0, z)}" mass="${fmt(caster.mass)}" friction="${fmt(caster.friction)} 0.0001 0.00001" rgba="0.7 0.72 0.75 1"/>`;
}

function sensorParts(spec: RobotSpec, p: Parts): { geoms: string; sensors: string } {
  const [hx, hy, hz] = p.chassis.halfSize;
  let geoms = "";
  let sensors = "";
  if (spec.sensors.includes("distance")) {
    geoms += `
      <geom name="distance_housing" type="box" size="0.006 0.018 0.008" pos="${vec(hx + 0.006, 0, 0)}" rgba="${SENSOR_RGBA}" ${VISUAL}/>
      <site name="distance" pos="${vec(hx + 0.012, 0, 0)}" zaxis="1 0 0" size="0.003"/>`;
    sensors += `
    <rangefinder name="distance" site="distance"/>`;
  }
  if (spec.sensors.includes("line")) {
    for (const side of ["left", "right"] as const) {
      const y = (side === "left" ? 1 : -1) * hy * 0.5;
      geoms += `
      <geom name="line_${side}_housing" type="box" size="0.006 0.006 0.003" pos="${vec(hx - 0.012, y, -hz - 0.003)}" rgba="${SENSOR_RGBA}" ${VISUAL}/>
      <site name="line_${side}" pos="${vec(hx - 0.012, y, -hz - 0.006)}" zaxis="0 0 -1" size="0.003"/>`;
      sensors += `
    <rangefinder name="line_${side}" site="line_${side}"/>`;
    }
  }
  return { geoms, sensors };
}

/** Build the robot's MJCF fragments. The spec must already be valid. */
export function robotFragments(spec: RobotSpec, pose: Pose = { x: 0, y: 0, yaw: 0 }): RobotFragments {
  const p = resolve(spec);
  const { chassis, wheel, motor } = p;
  const [hx, hy, hz] = chassis.halfSize;
  const z = wheel.radius + 0.002; // drop from just above the ground
  const quat = vec(Math.cos(pose.yaw / 2), 0, 0, Math.sin(pose.yaw / 2));
  const color = hexToRgba(spec.color ?? DEFAULT_COLOR);
  const { geoms: sensorGeoms, sensors } = sensorParts(spec, p);

  const body = `
    <body name="${ROBOT_BODY}" pos="${vec(pose.x, pose.y, z)}" quat="${quat}">
      <freejoint name="${ROBOT_BODY}"/>
      <geom name="chassis" type="box" size="${vec(hx, hy, hz)}" mass="${fmt(chassis.mass + 2 * motor.mass)}" rgba="${color}"/>
      <geom name="nose" type="box" size="${vec(0.01, hy * 0.6, 0.002)}" pos="${vec(hx - 0.012, 0, hz + 0.002)}" rgba="0.95 0.95 0.97 1" ${VISUAL}/>${casterGeoms("front", p)}${casterGeoms("back", p)}${sensorGeoms}${wheelBody("left", p)}${wheelBody("right", p)}
    </body>`;

  const actuator = (side: "left" | "right") => `
    <velocity name="${side}" joint="wheel_${side}" kv="${fmt(motor.gain)}" ctrlrange="${vec(-motor.maxSpeed, motor.maxSpeed)}" forcerange="${vec(-motor.maxTorque, motor.maxTorque)}"/>`;

  return { body, actuators: actuator("left") + actuator("right"), sensors };
}

/**
 * Compile a spec to a complete MJCF document. Throws `SpecError` (with
 * plain-language `errors`) for an invalid spec, before MuJoCo is involved.
 */
export function compile(spec: RobotSpec, options: CompileOptions = {}): string {
  const checked = validateSpec(spec);
  if (!checked.ok) throw new SpecError(checked.errors);
  const poseErrors = checkPose(options.pose);
  if (poseErrors.length) throw new SpecError(poseErrors);
  const valid = checked.spec;
  const { body, actuators, sensors } = robotFragments(valid, options.pose);
  const floor =
    options.floor === false
      ? ""
      : `
    <light pos="0 0 4" dir="0 0 -1"/>
    <geom name="floor" type="plane" size="0 0 0.1" rgba="0.9 0.92 0.94 1"/>`;
  const sensorBlock = sensors ? `\n  <sensor>${sensors}\n  </sensor>` : "";
  return `<mujoco model="${xmlAttr(options.modelName ?? valid.name)}">
  <option timestep="${fmt(TIMESTEP)}" gravity="0 0 -9.81" integrator="implicitfast"/>
  <worldbody>${floor}${options.world ?? ""}${body}
  </worldbody>
  <actuator>${actuators}
  </actuator>${sensorBlock}
</mujoco>
`;
}

/** Largest |x| or |y| for a start pose, in metres. */
const MAX_POSE = 1000;

function checkPose(pose: Pose | undefined): string[] {
  if (pose === undefined) return [];
  const ok = (v: unknown, limit: number) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
  if (typeof pose === "object" && pose !== null && ok(pose.x, MAX_POSE) && ok(pose.y, MAX_POSE) && ok(pose.yaw, 1e6)) return [];
  return [`The robot's start position must be finite numbers x and y (within ${MAX_POSE} m) and a heading in radians.`];
}

/**
 * Like `compile`, but returns errors instead of throwing. For the builder UI.
 * `options.world` is still trusted MJCF (it comes from our own environments).
 */
export function tryCompile(
  spec: unknown,
  options: CompileOptions = {},
): { ok: true; xml: string; spec: RobotSpec } | { ok: false; errors: string[] } {
  const checked = validateSpec(spec);
  if (!checked.ok) return checked;
  const poseErrors = checkPose(options.pose);
  if (poseErrors.length) return { ok: false, errors: poseErrors };
  return { ok: true, xml: compile(checked.spec, options), spec: checked.spec };
}
