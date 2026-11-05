/** The bundled sample scenes, in picker order. The first one is the default. */
import { HELLO_XML } from "./hello";
import { ARM_XML } from "./arm";
import { CARTPOLE_XML } from "./cartpole";
import { SENSORS_XML } from "./sensors";

export interface SceneInfo {
  /** Stable id used in `?scene=<id>` URLs. */
  id: string;
  /** Label shown in the scene picker. */
  name: string;
  xml: string;
}

export const SCENES: readonly SceneInfo[] = [
  { id: "hello", name: "Hello rover", xml: HELLO_XML },
  { id: "arm", name: "2-link arm", xml: ARM_XML },
  { id: "cartpole", name: "Cart-pole", xml: CARTPOLE_XML },
  { id: "sensors", name: "Sensor playground", xml: SENSORS_XML },
];

export const DEFAULT_SCENE_ID = SCENES[0]!.id;

/** Look up a bundled scene; unknown or missing ids give the default scene. */
export function findScene(id: string | null | undefined): SceneInfo {
  return SCENES.find((s) => s.id === id) ?? SCENES[0]!;
}
