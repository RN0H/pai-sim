/**
 * Thin, environment-agnostic wrapper around the official MuJoCo WASM bindings.
 *
 * - Works in the browser (pass `locateFile` so the .wasm can be found) and in
 *   Node (unit tests), so physics behaviour is testable without a browser.
 * - Owns every Embind handle it creates and frees them in `dispose()`;
 *   MuJoCo objects are NOT garbage-collected by JS.
 */
import loadMujoco, { type MainModule, type MjModel, type MjData } from "@mujoco/mujoco";

export type Mujoco = MainModule;

let modulePromise: Promise<Mujoco> | null = null;

/** Load the MuJoCo module once per page/process. */
export function loadEngine(options?: { locateFile?: (path: string) => string }): Promise<Mujoco> {
  modulePromise ??= loadMujoco(options ?? {});
  return modulePromise;
}

/** Geom types we know how to draw. Values match MuJoCo's mjtGeom enum. */
export const GeomType = {
  PLANE: 0,
  HFIELD: 1,
  SPHERE: 2,
  CAPSULE: 3,
  ELLIPSOID: 4,
  CYLINDER: 5,
  BOX: 6,
  MESH: 7,
} as const;

export interface GeomInfo {
  type: number;
  /** MuJoCo size triple (meaning depends on type). */
  size: [number, number, number];
  rgba: [number, number, number, number];
  bodyId: number;
}

export class Sim {
  readonly model: MjModel;
  readonly data: MjData;
  private disposed = false;
  private instabilities = 0;

  constructor(
    readonly mj: Mujoco,
    readonly xml: string,
  ) {
    this.model = mj.MjModel.from_xml_string(xml);
    this.data = new mj.MjData(this.model);
    mj.mj_forward(this.model, this.data);
  }

  get timestep(): number {
    return this.model.opt.timestep;
  }

  get time(): number {
    return this.data.time;
  }

  /** Advance one physics step. */
  step(): void {
    const before = this.data.time;
    this.mj.mj_step(this.model, this.data);
    if (this.data.time < before) this.instabilities++;
  }

  /** Advance `seconds` of simulated time in fixed steps. */
  advance(seconds: number): number {
    const n = Math.max(0, Math.round(seconds / this.timestep));
    for (let i = 0; i < n; i++) this.step();
    return n;
  }

  reset(): void {
    this.instabilities = 0;
    this.mj.mj_resetData(this.model, this.data);
    this.mj.mj_forward(this.model, this.data);
  }

  /** Static description of every geom, read once for building the scene. */
  geoms(): GeomInfo[] {
    const { model } = this;
    const out: GeomInfo[] = [];
    for (let i = 0; i < model.ngeom; i++) {
      out.push({
        type: model.geom_type[i]!,
        size: [model.geom_size[3 * i]!, model.geom_size[3 * i + 1]!, model.geom_size[3 * i + 2]!],
        rgba: [
          model.geom_rgba[4 * i]!,
          model.geom_rgba[4 * i + 1]!,
          model.geom_rgba[4 * i + 2]!,
          model.geom_rgba[4 * i + 3]!,
        ],
        bodyId: model.geom_bodyid[i]!,
      });
    }
    return out;
  }

  /** True if any state value is NaN or infinite (the sim has blown up). */
  hasInvalidState(): boolean {
    const { qpos, qvel } = this.data;
    for (const v of qpos) if (!Number.isFinite(v)) return true;
    for (const v of qvel) if (!Number.isFinite(v)) return true;
    return false;
  }

  /**
   * Number of times the simulation blew up. When MuJoCo detects bad
   * accelerations it silently resets the state (time jumps back to 0); we
   * detect that in `step()`. Any value > 0 means the physics is broken.
   */
  instabilityCount(): number {
    return this.instabilities;
  }

  /** Copy of the generalized positions, safe to keep after further steps. */
  snapshotQpos(): number[] {
    return Array.from(this.data.qpos);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.data.delete();
    this.model.delete();
  }
}
