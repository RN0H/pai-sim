/**
 * M1: generic MJCF support in the engine wrapper and mesh geometry builder.
 * PROTECTED: see CLAUDE.md.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { friendlyLoadError, GeomType, loadEngine, Sim, type Mujoco } from "../../src/physics/engine";
import { Vector3 } from "three";
import { meshGeometry } from "../../src/render/meshGeometry";

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

const TETRA = `
<mujoco model="tetra">
  <asset>
    <material name="red" rgba="1 0 0 1"/>
    <mesh name="t" vertex="0 0 0  1 0 0  0 1 0  0 0 1"/>
  </asset>
  <worldbody>
    <body pos="0 0 1"><freejoint/>
      <geom name="m" type="mesh" mesh="t" material="red"/>
      <geom name="own" type="sphere" size="0.1" material="red" rgba="0 1 0 1"/>
      <geom name="plain" type="sphere" size="0.1" pos="0.5 0 0"/>
    </body>
  </worldbody>
</mujoco>`;

describe("mesh geoms", () => {
  it("exposes mesh vertices and faces", () => {
    const sim = make(TETRA);
    const g = sim.geoms()[0]!;
    expect(g.type).toBe(GeomType.MESH);
    expect(g.meshId).toBe(0);
    const mesh = sim.meshData(g.meshId);
    expect(mesh.vertices.length).toBe(4 * 3);
    expect(mesh.faces.length).toBe(4 * 3);
    for (const f of mesh.faces) expect(f).toBeLessThan(4);
    expect(() => sim.meshData(5)).toThrow(RangeError);
  });

  it("non-mesh geoms have meshId -1", () => {
    const sim = make(TETRA);
    expect(sim.geoms()[1]!.meshId).toBe(-1);
  });

  it("builds a flat-shaded Three geometry matching the mesh size", () => {
    const sim = make(TETRA);
    const geo = meshGeometry(sim.meshData(0));
    const pos = geo.getAttribute("position");
    expect(pos.count).toBe(4 * 3); // 4 triangles, un-shared vertices
    expect(geo.getAttribute("normal").count).toBe(pos.count);
    // MuJoCo re-centres and rotates the mesh to its inertia frame, but keeps
    // its shape: the longest edge of this tetrahedron is sqrt(2) m.
    let longest = 0;
    const a = new Vector3();
    const b = new Vector3();
    for (let i = 0; i < pos.count; i++)
      for (let j = 0; j < pos.count; j++)
        longest = Math.max(longest, a.fromBufferAttribute(pos, i).distanceTo(b.fromBufferAttribute(pos, j)));
    expect(longest).toBeCloseTo(Math.SQRT2, 4);
    // Normals are unit length and point away from the centroid (outward).
    const n = geo.getAttribute("normal");
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
      expect(cx * n.getX(i) + cy * n.getY(i) + cz * n.getZ(i)).toBeGreaterThan(0);
    }
    geo.dispose();
  });
});

describe("materials and colours", () => {
  it("geoms with the default rgba take their material's colour", () => {
    const [m, own, plain] = make(TETRA).geoms();
    expect(m!.rgba).toEqual([1, 0, 0, 1]);
    expect(own!.rgba).toEqual([0, 1, 0, 1]); // explicit rgba wins
    expect(plain!.rgba).toEqual([0.5, 0.5, 0.5, 1]);
  });
});

describe("names", () => {
  it("reads the model name", () => {
    expect(make(TETRA).modelName).toBe("tetra");
    // MuJoCo's own default when the file doesn't name the model.
    expect(make("<mujoco><worldbody/></mujoco>").modelName).toBe("MuJoCo Model");
  });

  it("lists actuator names, including unnamed ones as empty", () => {
    const sim = make(`
      <mujoco><worldbody><body><joint name="j"/><geom size=".1"/></body></worldbody>
      <actuator><motor joint="j"/><motor name="b" joint="j"/></actuator></mujoco>`);
    expect(sim.actuatorNames()).toEqual(["", "b"]);
    expect(sim.hasDifferentialDrive()).toBe(false);
  });

  it("detects a differential drive by actuator names", () => {
    const sim = make(`
      <mujoco><worldbody><body><joint name="a"/><joint name="b"/><geom size=".1"/></body></worldbody>
      <actuator><velocity name="right" joint="a"/><velocity name="left" joint="b"/></actuator></mujoco>`);
    expect(sim.hasDifferentialDrive()).toBe(true);
  });

  it("reports model bounds for camera framing", () => {
    const { center, extent } = make(TETRA).bounds();
    expect(center.every(Number.isFinite)).toBe(true);
    expect(extent).toBeGreaterThan(0);
  });
});

describe("friendlyLoadError", () => {
  const errorFor = (xml: string) => {
    try {
      make(xml);
    } catch (e) {
      return friendlyLoadError(e);
    }
    throw new Error("expected the model to be rejected");
  };

  it("strips MuJoCo's prefixes and keeps the useful part", () => {
    const msg = errorFor("<mujoco><worldbody><geom type='nope'/></worldbody></mujoco>");
    expect(msg).not.toMatch(/MuJoCo Error|Loading error/);
    expect(msg).toMatch(/nope/);
  });

  it("explains non-XML input in plain words", () => {
    expect(errorFor("this is not xml")).toMatch(/isn't valid XML/);
  });

  it("explains missing referenced files", () => {
    expect(errorFor("<mujoco><asset><mesh file='a.stl'/></asset></mujoco>")).toMatch(/another file.*a\.stl/);
  });

  it("handles non-Error values", () => {
    expect(friendlyLoadError("boom")).toBe("boom");
    expect(friendlyLoadError("")).toMatch(/could not be loaded/);
  });
});
