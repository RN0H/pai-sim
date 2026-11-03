/**
 * The parts library: pre-tuned, physically sensible parts a beginner can
 * combine. All units are SI (metres, kilograms, newton-metres, rad/s).
 *
 * Every combination of chassis × wheels × motor is tested to compile, settle
 * upright and drive (tests/unit/robot.test.ts), so new parts must keep that
 * true. Pure data: no MuJoCo, no DOM.
 */

export interface ChassisPart {
  kind: "chassis";
  id: string;
  name: string;
  /** Box half-sizes: length (x, forward), width (y), height (z). */
  halfSize: [number, number, number];
  mass: number;
}

export interface WheelPart {
  kind: "wheel";
  id: string;
  name: string;
  radius: number;
  /** Half the tyre width. */
  halfWidth: number;
  mass: number;
  /** Sliding friction coefficient of the tyre. */
  friction: number;
}

export interface MotorPart {
  kind: "motor";
  id: string;
  name: string;
  /** Top wheel speed in rad/s: the actuator's control range is ±this. */
  maxSpeed: number;
  /** Stall torque limit in N·m. */
  maxTorque: number;
  /** Velocity-servo gain (N·m per rad/s of speed error). */
  gain: number;
  /** Mass of one motor; two are mounted in the chassis. */
  mass: number;
}

export interface CasterPart {
  kind: "caster";
  id: string;
  name: string;
  radius: number;
  mass: number;
  friction: number;
}

export interface SensorPart {
  kind: "sensor";
  id: string;
  name: string;
  /** Names of the MuJoCo sensors this part adds, in order. */
  outputs: readonly string[];
  /** One-line, beginner-friendly description of what it reads. */
  reads: string;
}

export type Part = ChassisPart | WheelPart | MotorPart | CasterPart | SensorPart;

export const CHASSIS = [
  { kind: "chassis", id: "chassis_small", name: "Small chassis", halfSize: [0.07, 0.055, 0.015], mass: 0.35 },
  { kind: "chassis", id: "chassis_medium", name: "Medium chassis", halfSize: [0.11, 0.08, 0.02], mass: 0.8 },
  { kind: "chassis", id: "chassis_large", name: "Large chassis", halfSize: [0.16, 0.11, 0.025], mass: 1.6 },
] as const satisfies readonly ChassisPart[];

export const WHEELS = [
  { kind: "wheel", id: "wheel_small", name: "Small wheels", radius: 0.035, halfWidth: 0.01, mass: 0.03, friction: 1.2 },
  { kind: "wheel", id: "wheel_large", name: "Large wheels", radius: 0.055, halfWidth: 0.015, mass: 0.07, friction: 1.2 },
] as const satisfies readonly WheelPart[];

export const MOTORS = [
  { kind: "motor", id: "motor_fast", name: "Fast motors", maxSpeed: 20, maxTorque: 0.15, gain: 0.08, mass: 0.04 },
  { kind: "motor", id: "motor_strong", name: "Strong motors", maxSpeed: 12, maxTorque: 0.6, gain: 0.3, mass: 0.09 },
] as const satisfies readonly MotorPart[];

export const CASTERS = [
  { kind: "caster", id: "caster_ball", name: "Ball caster", radius: 0.012, mass: 0.02, friction: 0.02 },
] as const satisfies readonly CasterPart[];

export const SENSORS = [
  {
    kind: "sensor",
    id: "distance",
    name: "Distance sensor",
    outputs: ["distance"],
    reads: "Distance in metres to the nearest thing straight ahead, or -1 if nothing is in range.",
  },
  {
    kind: "sensor",
    id: "line",
    name: "Line sensor",
    outputs: ["line_left", "line_right"],
    reads: "Two downward probes at the front: the height in metres above whatever is below each one.",
  },
] as const satisfies readonly SensorPart[];

export type ChassisId = (typeof CHASSIS)[number]["id"];
export type WheelId = (typeof WHEELS)[number]["id"];
export type MotorId = (typeof MOTORS)[number]["id"];
export type CasterId = (typeof CASTERS)[number]["id"];
export type SensorId = (typeof SENSORS)[number]["id"];

/** Every part, for lookups and listings. */
export const PARTS: readonly Part[] = [...CHASSIS, ...WHEELS, ...MOTORS, ...CASTERS, ...SENSORS];

export function findPart<K extends Part["kind"]>(kind: K, id: string): Extract<Part, { kind: K }> | undefined {
  return PARTS.find((p): p is Extract<Part, { kind: K }> => p.kind === kind && p.id === id);
}
