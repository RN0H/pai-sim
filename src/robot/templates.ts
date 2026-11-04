/** Starting robots: a beginner picks one and changes parts from there. */
import { cloneSpec, SPEC_VERSION, type RobotSpec } from "./spec";

export interface Template {
  id: string;
  /** One line shown under the template's name. */
  blurb: string;
  spec: RobotSpec;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: "scout",
    blurb: "Small and fast. Good for racing and learning to drive.",
    spec: {
      version: SPEC_VERSION,
      name: "Scout",
      chassis: "chassis_small",
      wheels: "wheel_large",
      motor: "motor_fast",
      caster: "caster_ball",
      sensors: [],
      color: "#e8590c",
    },
  },
  {
    id: "hauler",
    blurb: "Big and strong. Pushes things around.",
    spec: {
      version: SPEC_VERSION,
      name: "Hauler",
      chassis: "chassis_large",
      wheels: "wheel_small",
      motor: "motor_strong",
      caster: "caster_ball",
      sensors: [],
      color: "#2f9e44",
    },
  },
  {
    id: "sensor-bot",
    blurb: "Sees walls ahead and lines on the floor. Ready to program.",
    spec: {
      version: SPEC_VERSION,
      name: "Sensor bot",
      chassis: "chassis_medium",
      wheels: "wheel_small",
      motor: "motor_fast",
      caster: "caster_ball",
      sensors: ["distance", "line"],
      color: "#1c7ed6",
    },
  },
];

/** A fresh copy of a template's spec (safe to edit). Unknown ids give the first template. */
export function templateSpec(id: string): RobotSpec {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0]!;
  return cloneSpec(t.spec);
}
