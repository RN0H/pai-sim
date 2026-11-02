/**
 * Builds Three.js geometry from MuJoCo mesh data. Kept separate from the
 * renderer (no DOM, no WebGL) so it can be unit-tested in Node.
 */
import * as THREE from "three";
import type { MeshData } from "../physics/engine";

/**
 * Flat-shaded triangle geometry for a MuJoCo mesh. Vertices are in the geom's
 * local frame, so the result is positioned by the geom pose like any other
 * primitive. Faces are un-shared so each triangle gets its own normal: MuJoCo
 * collision meshes are mostly low-poly hulls that look wrong smooth-shaded.
 */
export function meshGeometry(mesh: MeshData): THREE.BufferGeometry {
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3));
  indexed.setIndex(new THREE.BufferAttribute(mesh.faces, 1));
  const flat = indexed.toNonIndexed();
  indexed.dispose();
  flat.computeVertexNormals();
  flat.computeBoundingSphere();
  return flat;
}
