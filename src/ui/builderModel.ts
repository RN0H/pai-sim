/**
 * The builder's pure logic: what the panel offers, how each choice edits the
 * RobotSpec, and which errors belong to which field. No DOM, no MuJoCo, so it
 * is unit-tested in Node (tests/unit/builder.test.ts).
 */
import { tryCompile } from "../robot/compile";
import { CHASSIS, MOTORS, SENSORS, WHEELS, type SensorId } from "../robot/parts";
import { cloneSpec, validateSpec, type RobotSpec } from "../robot/spec";

/** Spec fields the builder lets you pick a part for. */
export type PartField = "chassis" | "wheels" | "motor";

export interface PartOption {
  id: string;
  /** Short label, e.g. "Small chassis". */
  label: string;
  /** One plain-language line about what the choice means. */
  detail: string;
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;
const kg = (k: number) => (k < 1 ? `${Math.round(k * 1000)} g` : `${k.toFixed(1)} kg`);

/** The choices for one part slot, in display order. */
export function partOptions(field: PartField): PartOption[] {
  switch (field) {
    case "chassis":
      return CHASSIS.map((c) => ({
        id: c.id,
        label: c.name,
        detail: `${cm(2 * c.halfSize[0])} × ${cm(2 * c.halfSize[1])}, ${kg(c.mass)}`,
      }));
    case "wheels":
      return WHEELS.map((w) => ({ id: w.id, label: w.name, detail: `${cm(2 * w.radius)} across` }));
    case "motor":
      return MOTORS.map((m) => ({
        id: m.id,
        label: m.name,
        // Ground speed depends on the wheels; describe the trade-off instead.
        detail: m.maxSpeed >= 15 ? "Quick, but weak when pushing" : "Slower, but pushes hard",
      }));
  }
}

export interface SensorOption {
  id: SensorId;
  label: string;
  detail: string;
}

export function sensorOptions(): SensorOption[] {
  return SENSORS.map((s) => ({ id: s.id, label: s.name, detail: s.reads }));
}

/** A copy of `spec` with one part swapped. */
export function withPart(spec: RobotSpec, field: PartField, id: string): RobotSpec {
  return { ...cloneSpec(spec), [field]: id } as RobotSpec;
}

/** A copy of `spec` with a sensor added or removed. Sensors stay in library order. */
export function withSensor(spec: RobotSpec, id: SensorId, on: boolean): RobotSpec {
  const want = new Set(spec.sensors);
  if (on) want.add(id);
  else want.delete(id);
  const next = cloneSpec(spec);
  next.sensors = SENSORS.map((s) => s.id).filter((s) => want.has(s));
  return next;
}

export function withName(spec: RobotSpec, name: string): RobotSpec {
  return { ...cloneSpec(spec), name };
}

export function withColor(spec: RobotSpec, color: string): RobotSpec {
  return { ...cloneSpec(spec), color };
}

/** Errors for the builder: those caused by the name, and everything else. */
export interface BuilderErrors {
  name: string[];
  other: string[];
}

/** A name that always validates, used to tell name errors from the rest. */
const PLACEHOLDER_NAME = "Robot";

export function builderErrors(spec: RobotSpec): BuilderErrors {
  const all = validateSpec(spec);
  if (all.ok) return { name: [], other: [] };
  const rest = validateSpec({ ...spec, name: PLACEHOLDER_NAME });
  const other = rest.ok ? [] : rest.errors;
  return { name: all.errors.filter((e) => !other.includes(e)), other };
}

/**
 * Compile the builder's spec into the "My robot" scene: the robot alone on
 * a floor, at the origin facing +x (the camera can stay where it was). Never
 * throws; invalid specs return plain-language errors.
 */
export function buildScene(spec: RobotSpec): ReturnType<typeof tryCompile> {
  return tryCompile(spec, { pose: { x: 0, y: 0, yaw: 0 }, floor: true });
}
