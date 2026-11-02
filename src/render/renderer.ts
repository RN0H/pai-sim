/**
 * Draws any MuJoCo model with Three.js by mirroring its geoms.
 * MuJoCo is z-up; Three.js is y-up. We keep MuJoCo's frame inside a root
 * group rotated -90deg about X so all physics numbers can be used unchanged.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GeomType, type GeomInfo, type Sim } from "../physics/engine";
import { meshGeometry } from "./meshGeometry";

const INFINITE_PLANE_HALF_SIZE = 25;
const GRID_CELL_METERS = 0.5;
const HIDDEN_GROUP_START = 3;

/** A tileable grid texture: one cell per tile, with a thin line on two edges. */
function makeGridTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#c9cfd8";
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, 0, 2, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function geometryFor(g: GeomInfo, sim: Sim): THREE.BufferGeometry | null {
  const [a, b, c] = g.size;
  switch (g.type) {
    case GeomType.PLANE: {
      const w = a > 0 ? 2 * a : 2 * INFINITE_PLANE_HALF_SIZE;
      const h = b > 0 ? 2 * b : 2 * INFINITE_PLANE_HALF_SIZE;
      return new THREE.PlaneGeometry(w, h);
    }
    case GeomType.SPHERE:
      return new THREE.SphereGeometry(a, 32, 16);
    case GeomType.ELLIPSOID: {
      const s = new THREE.SphereGeometry(1, 32, 16);
      s.scale(a, b, c);
      return s;
    }
    case GeomType.BOX:
      return new THREE.BoxGeometry(2 * a, 2 * b, 2 * c);
    case GeomType.CYLINDER: {
      // Three's cylinder runs along Y; MuJoCo's along local Z.
      const s = new THREE.CylinderGeometry(a, a, 2 * b, 32);
      s.rotateX(Math.PI / 2);
      return s;
    }
    case GeomType.CAPSULE: {
      const s = new THREE.CapsuleGeometry(a, 2 * b, 8, 24);
      s.rotateX(Math.PI / 2);
      return s;
    }
    case GeomType.MESH:
      return g.meshId >= 0 ? meshGeometry(sim.meshData(g.meshId)) : null;
    default:
      return null; // heightfields: not drawn yet
  }
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly world = new THREE.Group();
  private meshes: Array<{ index: number; mesh: THREE.Mesh }> = [];
  private readonly tmpMat = new THREE.Matrix4();
  private lowQuality = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xdde3ea);
    this.scene.fog = new THREE.Fog(0xdde3ea, 10, 30);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    this.camera.position.set(2.2, 1.6, 2.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.1, 0);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3b0, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 6, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    // Without a bias, flat faces (e.g. mesh hulls) shadow themselves in stripes.
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.01;
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -4;
    sc.right = sc.top = 4;
    this.scene.add(sun);

    this.world.rotation.x = -Math.PI / 2; // z-up -> y-up
    this.scene.add(this.world);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  /** Rebuild meshes for a (new) model. */
  load(sim: Sim): void {
    for (const { mesh } of this.meshes) {
      this.world.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.meshes = [];
    sim.geoms().forEach((g, index) => {
      // Skip invisible geoms and groups 3+ (hidden by default in MuJoCo's own
      // viewer; real-world models keep their collision geoms there).
      if (g.rgba[3] === 0 || g.group >= HIDDEN_GROUP_START) return;
      const geometry = geometryFor(g, sim);
      if (!geometry) return;
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(g.rgba[0], g.rgba[1], g.rgba[2]),
        transparent: g.rgba[3] < 1,
        opacity: g.rgba[3],
        roughness: g.type === GeomType.PLANE ? 0.95 : 0.55,
        metalness: 0.05,
        // Plane geoms are one-sided in MuJoCo; meshes from user files can
        // have inconsistent winding, so draw both faces to avoid holes.
        side: g.type === GeomType.MESH ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (g.type === GeomType.PLANE && geometry instanceof THREE.PlaneGeometry) {
        const tex = makeGridTexture();
        const { width, height } = geometry.parameters;
        tex.repeat.set(width / GRID_CELL_METERS, height / GRID_CELL_METERS);
        material.map = tex;
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = g.type !== GeomType.PLANE;
      mesh.receiveShadow = true;
      this.world.add(mesh);
      this.meshes.push({ index, mesh });
    });
    this.sync(sim);
  }

  /** Copy geom poses from physics into the scene graph. */
  sync(sim: Sim): void {
    const pos = sim.data.geom_xpos;
    const mat = sim.data.geom_xmat; // row-major 3x3 per geom
    const m = this.tmpMat;
    for (const { index: i, mesh } of this.meshes) {
      const p = 3 * i;
      const r = 9 * i;
      m.set(
        mat[r]!, mat[r + 1]!, mat[r + 2]!, pos[p]!,
        mat[r + 3]!, mat[r + 4]!, mat[r + 5]!, pos[p + 1]!,
        mat[r + 6]!, mat[r + 7]!, mat[r + 8]!, pos[p + 2]!,
        0, 0, 0, 1,
      );
      mesh.matrix.copy(m);
    }
  }

  /** Number of geoms currently drawn. */
  get drawnCount(): number {
    return this.meshes.length;
  }

  /** Point the camera at a model so the whole thing is in view. */
  frame(sim: Sim): void {
    const { center, extent } = sim.bounds();
    // MuJoCo z-up (x, y, z) -> Three y-up (x, z, -y).
    const target = new THREE.Vector3(center[0], center[2], -center[1]);
    // Fit a sphere around the model in the narrower of the two fields of view,
    // so tall phone screens don't crop it sideways.
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const radius = 0.6 * extent;
    const dist = Math.min(Math.max(radius / Math.sin(Math.min(vfov, hfov) / 2), 1.2), 30);
    const dir = new THREE.Vector3(1, 0.75, 1).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.005, dist / 500);
    this.camera.far = Math.max(100, dist * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /**
   * Cheaper rendering for slow devices: no shadows, 1x pixel ratio.
   * Physics is unaffected; only visuals change.
   */
  setLowQuality(low: boolean): void {
    this.lowQuality = low;
    this.renderer.shadowMap.enabled = !low;
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
    for (const { mesh } of this.meshes) {
      mesh.castShadow = !low && mesh.castShadow;
      (mesh.material as THREE.Material).needsUpdate = true;
    }
    this.resize();
  }

  get isLowQuality(): boolean {
    return this.lowQuality;
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
