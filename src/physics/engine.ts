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
  /** Mesh id for MESH geoms (MuJoCo `geom_dataid`), otherwise -1. */
  meshId: number;
}

/** Triangle mesh in the geom's local frame (MuJoCo re-centres mesh vertices). */
export interface MeshData {
  /** xyz triples. */
  vertices: Float32Array;
  /** Vertex index triples (counter-clockwise, outward-facing). */
  faces: Uint32Array;
}

/** MuJoCo's default geom colour; a geom with this rgba and a material takes the material's colour. */
const DEFAULT_GEOM_RGBA = [0.5, 0.5, 0.5, 1];

/**
 * Turn a MuJoCo loading error into a short, human-readable message.
 * MuJoCo errors look like "MuJoCo Error: Loading error: XML Error: ...".
 */
export function friendlyLoadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = raw
    .replace(/^(\s*(MuJoCo Error|Loading error|Error)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/XML_ERROR|XML parse error/i.test(text)) return "This file isn't valid XML (check for a typo or a missing closing tag).";
  if (/Error opening file|resource not found|could not open/i.test(text))
    return `This model refers to another file that isn't available: ${text}. Only single-file MJCF models are supported for now.`;
  return text || "This model could not be loaded.";
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

  /** The `<mujoco model="...">` name (MuJoCo uses "MuJoCo Model" if none is given). */
  get modelName(): string {
    return this.nameAt(0);
  }

  /**
   * Read a NUL-terminated name from MuJoCo's `names` buffer. We read the buffer
   * directly because `mj_id2name` returns garbage (not null) for unnamed objects.
   */
  private nameAt(adr: number): string {
    const names = this.model.names;
    let end = adr;
    while (end < names.length && names[end] !== 0) end++;
    return new TextDecoder().decode(Uint8Array.from(names.subarray(adr, end)));
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
        rgba: this.geomColor(i),
        bodyId: model.geom_bodyid[i]!,
        meshId: model.geom_type[i] === GeomType.MESH ? model.geom_dataid[i]! : -1,
      });
    }
    return out;
  }

  /**
   * Effective colour of geom `i`: its own rgba, or its material's when the geom
   * keeps MuJoCo's default rgba (this mirrors MuJoCo's own viewer).
   */
  private geomColor(i: number): [number, number, number, number] {
    const { model } = this;
    const own: [number, number, number, number] = [
      model.geom_rgba[4 * i]!,
      model.geom_rgba[4 * i + 1]!,
      model.geom_rgba[4 * i + 2]!,
      model.geom_rgba[4 * i + 3]!,
    ];
    const mat = model.geom_matid[i]!;
    const isDefault = own.every((v, k) => Math.abs(v - DEFAULT_GEOM_RGBA[k]!) < 1e-6);
    if (mat < 0 || !isDefault) return own;
    const m = model.mat_rgba;
    return [m[4 * mat]!, m[4 * mat + 1]!, m[4 * mat + 2]!, m[4 * mat + 3]!];
  }

  /** Vertices and triangles of mesh `meshId` (copied out of WASM memory). */
  meshData(meshId: number): MeshData {
    const { model } = this;
    if (meshId < 0 || meshId >= model.nmesh) throw new RangeError(`no mesh ${meshId}`);
    const va = model.mesh_vertadr[meshId]!;
    const vn = model.mesh_vertnum[meshId]!;
    const fa = model.mesh_faceadr[meshId]!;
    const fn = model.mesh_facenum[meshId]!;
    return {
      vertices: Float32Array.from(model.mesh_vert.subarray(3 * va, 3 * (va + vn))),
      faces: Uint32Array.from(model.mesh_face.subarray(3 * fa, 3 * (fa + fn))),
    };
  }

  /** Names of all actuators, in id order ("" for unnamed ones). */
  actuatorNames(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.model.nu; i++) out.push(this.nameAt(this.model.name_actuatoradr[i]!));
    return out;
  }

  /** True if the model has a differential drive: actuators named `left` and `right`. */
  hasDifferentialDrive(): boolean {
    const names = this.actuatorNames();
    return names.includes("left") && names.includes("right");
  }

  /** Centre and size of the model (MuJoCo's `stat`), for framing the camera. */
  bounds(): { center: [number, number, number]; extent: number } {
    const c = this.model.stat.center;
    return { center: [c[0]!, c[1]!, c[2]!], extent: this.model.stat.extent };
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
