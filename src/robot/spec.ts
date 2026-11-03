/**
 * RobotSpec: the plain-JSON description of a wheeled rover, and its
 * validation. This is what the builder edits, what share links store, and
 * what `compile()` turns into MJCF. Pure logic: no MuJoCo, no DOM.
 */
import {
  CASTERS,
  CHASSIS,
  findPart,
  MOTORS,
  SENSORS,
  WHEELS,
  type CasterId,
  type ChassisId,
  type MotorId,
  type SensorId,
  type WheelId,
} from "./parts";

export const SPEC_VERSION = 1;

export interface RobotSpec {
  /** Format version, for share links that outlive code changes. */
  version: typeof SPEC_VERSION;
  /** Shown to people; becomes the MJCF model name. */
  name: string;
  chassis: ChassisId;
  wheels: WheelId;
  motor: MotorId;
  caster: CasterId;
  /** Sensor parts to mount, each at most once. */
  sensors: SensorId[];
  /** Chassis colour as "#rrggbb". Optional. */
  color?: string;
}

export const MAX_NAME_LENGTH = 40;

export type ValidationResult = { ok: true; spec: RobotSpec } | { ok: false; errors: string[] };

/** Thrown by `compile()` for a spec that doesn't validate (before MuJoCo sees anything). */
export class SpecError extends Error {
  constructor(readonly errors: string[]) {
    super(`Invalid robot: ${errors.join(" ")}`);
    this.name = "SpecError";
  }
}

const choices = (parts: readonly { id: string; name: string }[]) =>
  parts.map((p) => `"${p.id}" (${p.name.toLowerCase()})`).join(", ");

function checkPart(
  errors: string[],
  value: unknown,
  label: string,
  kind: "chassis" | "wheel" | "motor" | "caster",
  all: readonly { id: string; name: string }[],
): void {
  if (typeof value !== "string" || value === "") {
    errors.push(`Pick a ${label}. Choices: ${choices(all)}.`);
  } else if (!findPart(kind, value)) {
    errors.push(`There's no ${label} called "${value}". Choices: ${choices(all)}.`);
  }
}

/**
 * Check that `input` is a usable RobotSpec. Accepts anything (e.g. parsed
 * JSON from a link) and never throws; errors are plain-language sentences.
 */
export function validateSpec(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["A robot must be described as an object with chassis, wheels, motor, caster and sensors."] };
  }
  const s = input as Record<string, unknown>;
  const errors: string[] = [];

  if (s.version !== SPEC_VERSION) {
    errors.push(`This robot was saved in format version ${JSON.stringify(s.version)}, but only version ${SPEC_VERSION} is supported.`);
  }
  if (typeof s.name !== "string" || s.name.trim() === "") {
    errors.push("Give the robot a name.");
  } else if (s.name.length > MAX_NAME_LENGTH) {
    errors.push(`The robot's name is too long (${s.name.length} characters); keep it to ${MAX_NAME_LENGTH}.`);
  }
  checkPart(errors, s.chassis, "chassis", "chassis", CHASSIS);
  checkPart(errors, s.wheels, "wheel size", "wheel", WHEELS);
  checkPart(errors, s.motor, "motor", "motor", MOTORS);
  checkPart(errors, s.caster, "caster", "caster", CASTERS);

  if (!Array.isArray(s.sensors)) {
    errors.push("The sensors list is missing (use an empty list for no sensors).");
  } else {
    const seen = new Set<string>();
    for (const id of s.sensors as unknown[]) {
      if (typeof id !== "string" || !findPart("sensor", id)) {
        errors.push(`There's no sensor called ${JSON.stringify(id)}. Choices: ${choices(SENSORS)}.`);
      } else if (seen.has(id)) {
        errors.push(`The ${findPart("sensor", id)!.name.toLowerCase()} is listed twice; a robot can have one of each sensor.`);
      }
      if (typeof id === "string") seen.add(id);
    }
  }

  if (s.color !== undefined && (typeof s.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(s.color))) {
    errors.push(`The colour ${JSON.stringify(s.color)} isn't valid; use a hex colour like "#3366cc".`);
  }

  // Physical fit: the chassis must clear the ground on these wheels. All
  // bundled parts fit; this guards future parts and hand-written specs.
  if (errors.length === 0) {
    const chassis = findPart("chassis", s.chassis as string)!;
    const wheel = findPart("wheel", s.wheels as string)!;
    if (wheel.radius - chassis.halfSize[2] < 0.005) {
      errors.push(`The ${wheel.name.toLowerCase()} are too small for the ${chassis.name.toLowerCase()}: it would scrape the ground.`);
    }
  }

  if (errors.length) return { ok: false, errors };
  const spec: RobotSpec = {
    version: SPEC_VERSION,
    name: s.name as string,
    chassis: s.chassis as ChassisId,
    wheels: s.wheels as WheelId,
    motor: s.motor as MotorId,
    caster: s.caster as CasterId,
    sensors: [...(s.sensors as SensorId[])],
  };
  if (s.color !== undefined) spec.color = s.color as string;
  return { ok: true, spec };
}
