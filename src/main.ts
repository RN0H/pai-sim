import wasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import { friendlyLoadError, loadEngine, Sim, type Mujoco } from "./physics/engine";
import { SceneRenderer } from "./render/renderer";
import { SimLoop } from "./app/loop";
import { DriveInput, driveTopSpeed, wheelSpeeds } from "./app/drive";
import { DEFAULT_SCENE_ID, findScene, SCENES } from "./scenes";
import { templateSpec } from "./robot/templates";
import type { RobotSpec } from "./robot/spec";
import { BuilderPanel } from "./ui/builder";
import { buildScene } from "./ui/builderModel";
import "./style.css";

/** Larger files are almost certainly not a single-file MJCF model. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CUSTOM_OPTION = "__custom";
const BUILD_OPTION = "__build";
/** Scene id for the robot made in the builder. */
const BUILD_SCENE = "build";
/** Scenes whose robot sits at the origin, so the builder keeps their camera. */
const ROBOT_SCENES = new Set(["hello", BUILD_SCENE]);

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Hooks for automated browser tests (tests/e2e). Not a public API. */
export interface TestHooks {
  ready: boolean;
  error: string | null;
  time(): number;
  stats(): { fps: number; realtimeFactor: number; lowQuality: boolean };
  bodyPos(name: string): [number, number, number];
  setDrive(forward: number, turn: number): void;
  reset(): void;
  /** Id of the bundled scene shown, or "custom" for a user's file. */
  scene(): string;
  /** Model name of the scene shown (MJCF `<mujoco model="...">`). */
  modelName(): string;
  /** Last load error shown to the user, or null. */
  loadError(): string | null;
  /** Number of geoms currently drawn. */
  drawnGeoms(): number;
  /** The robot spec the builder shows (read-only: tests build through the UI). */
  builderSpec(): RobotSpec;
  /** Camera position in render coordinates. */
  cameraPos(): [number, number, number];
}

declare global {
  interface Window {
    __paiSim: TestHooks;
  }
}

interface Current {
  sim: Sim;
  /** Bundled scene id, "custom" (a user's file) or "build" (the builder's robot). */
  sceneId: string;
  /** Actuator ids and the top speed (rad/s) the drive pad commands. */
  drive: { left: number; right: number; maxSpeed: number } | null;
}

async function main(): Promise<void> {
  const hooks: TestHooks = (window.__paiSim = {
    ready: false,
    error: null,
    time: () => 0,
    stats: () => ({ fps: 0, realtimeFactor: 0, lowQuality: false }),
    bodyPos: () => [0, 0, 0],
    setDrive: () => {},
    reset: () => {},
    scene: () => "",
    modelName: () => "",
    loadError: () => null,
    drawnGeoms: () => 0,
    builderSpec: () => templateSpec("hauler"),
    cameraPos: () => [0, 0, 0],
  });

  const status = $("#status");
  try {
    status.textContent = "Loading physics engine…";
    const mj: Mujoco = await loadEngine({ locateFile: () => wasmUrl });
    const params = new URLSearchParams(location.search);

    const picker = $<HTMLSelectElement>("#scene-picker");
    for (const s of SCENES) picker.add(new Option(s.name, s.id));

    const initial = findScene(params.get("scene"));
    let cur: Current = makeCurrent(new Sim(mj, initial.xml), initial.id);

    const view = new SceneRenderer($("#viewport"));
    view.load(cur.sim);
    view.frame(cur.sim);

    const drive = new DriveInput();
    for (const btn of document.querySelectorAll<HTMLElement>("[data-key]")) {
      drive.bindButton(btn, btn.dataset.key!);
    }
    let override: { forward: number; turn: number } | null = null;

    const loop = new SimLoop(
      cur.sim,
      (s) => {
        if (!cur.drive) return;
        const cmd = override ?? drive.cmd;
        const { left, right } = wheelSpeeds(cmd, cur.drive.maxSpeed);
        s.data.ctrl[cur.drive.left] = left;
        s.data.ctrl[cur.drive.right] = right;
      },
      (s) => {
        view.sync(s);
        view.render();
      },
    );
    loop.start();

    // ---- Scene switching ---------------------------------------------------
    const pad = $("#drive-pad");
    const hint = $("#hint");
    const errorBox = $("#load-error");
    const errorText = $("#load-error-text");
    let lastError: string | null = null;

    const showError = (msg: string) => {
      lastError = msg;
      // Clear first so screen readers re-announce a repeated message.
      errorText.textContent = "";
      errorBox.hidden = true;
      requestAnimationFrame(() => {
        if (lastError !== msg) return; // dismissed or replaced meanwhile
        errorText.textContent = msg;
        errorBox.hidden = false;
      });
    };
    const clearError = () => {
      lastError = null;
      errorBox.hidden = true;
    };
    $("#load-error-close").addEventListener("click", clearError);

    const syncUi = () => {
      const hasDrive = cur.drive !== null;
      pad.hidden = !hasDrive;
      // Touch screens (phones, tablets) get touch wording.
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const view = touch ? "drag to orbit · pinch to zoom" : "drag to orbit · scroll to zoom";
      hint.textContent = hasDrive
        ? `${touch ? "Drive with the arrow pad" : "Drive with arrow keys or WASD"} · ${view}`
        : view[0]!.toUpperCase() + view.slice(1);
      if (cur.sceneId === BUILD_SCENE) {
        let opt = picker.querySelector<HTMLOptionElement>(`option[value="${BUILD_OPTION}"]`);
        if (!opt) picker.add((opt = new Option("", BUILD_OPTION)));
        opt.textContent = `My robot: ${cur.sim.modelName || "robot"}`;
        picker.value = BUILD_OPTION;
      } else if (cur.sceneId === "custom") {
        let opt = picker.querySelector<HTMLOptionElement>(`option[value="${CUSTOM_OPTION}"]`);
        if (!opt) picker.add((opt = new Option("", CUSTOM_OPTION)));
        opt.textContent = `Your file: ${cur.sim.modelName || "model"}`;
        picker.value = CUSTOM_OPTION;
      } else {
        picker.value = cur.sceneId;
      }
    };

    /**
     * Swap in a new model. Returns false (and keeps the old scene running) if
     * MuJoCo rejects the XML.
     */
    let customXml: string | null = null;
    // Bumped by every load request so a slow file read can't overwrite a
    // scene the user picked afterwards.
    let loadSeq = 0;

    const swapIn = (sim: Sim, sceneId: string, keepCamera: boolean) => {
      clearError();
      const old = cur.sim;
      cur = makeCurrent(sim, sceneId);
      override = null;
      loop.setSim(sim);
      view.load(sim);
      if (!keepCamera) view.frame(sim);
      old.dispose();
      syncUi();
    };

    const loadXml = (xml: string, sceneId: string): boolean => {
      let sim: Sim;
      try {
        sim = new Sim(mj, xml);
      } catch (err) {
        showError(friendlyLoadError(err));
        syncUi(); // put the picker back on the scene that is still running
        return false;
      }
      swapIn(sim, sceneId, false);
      return true;
    };

    // ---- Builder -----------------------------------------------------------
    /** Load a builder spec as the "My robot" scene. Returns an error message, or null. */
    const loadBuild = (spec: RobotSpec): string | null => {
      const built = buildScene(spec);
      if (!built.ok) return built.errors.join(" ");
      let sim: Sim;
      try {
        sim = new Sim(mj, built.xml);
      } catch (err) {
        return friendlyLoadError(err);
      }
      loadSeq++;
      // Rebuilding the robot keeps the user's view; only re-frame when coming
      // from a scene laid out differently (the arm, a user's file).
      swapIn(sim, BUILD_SCENE, ROBOT_SCENES.has(cur.sceneId));
      setSceneParam(null);
      return null;
    };

    const builderPanel = $("#builder");
    const builderToggle = $<HTMLButtonElement>("#builder-toggle");
    const builder = new BuilderPanel($<HTMLFormElement>("#builder-form"), {
      initial: templateSpec("hauler"), // the robot in the default Hello scene
      onChange: loadBuild,
    });
    let builderOpen = false;
    const setBuilderOpen = (open: boolean) => {
      builderOpen = open;
      builderPanel.hidden = !open;
      builderToggle.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("building", open);
      if (open) builderPanel.querySelector<HTMLElement>("form button")?.focus();
      else builderToggle.focus();
    };
    builderToggle.addEventListener("click", () => setBuilderOpen(!builderOpen));
    $("#builder-close").addEventListener("click", () => setBuilderOpen(false));
    builderPanel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setBuilderOpen(false);
      }
    });
    syncUi();

    const setSceneParam = (id: string | null) => {
      const url = new URL(location.href);
      if (id && id !== DEFAULT_SCENE_ID) url.searchParams.set("scene", id);
      else url.searchParams.delete("scene");
      history.replaceState(null, "", url);
    };

    picker.addEventListener("change", () => {
      loadSeq++;
      if (picker.value === BUILD_OPTION) {
        // Back to the robot from the builder.
        if (loadBuild(builder.spec)) syncUi();
        return;
      }
      if (picker.value === CUSTOM_OPTION) {
        // Re-open the last file the user loaded.
        if (customXml && loadXml(customXml, "custom")) setSceneParam(null);
        else syncUi();
        return;
      }
      const scene = findScene(picker.value);
      if (loadXml(scene.xml, scene.id)) setSceneParam(scene.id);
    });

    const openFile = async (file: File) => {
      const seq = ++loadSeq;
      if (file.size > MAX_FILE_BYTES) {
        showError(`"${file.name}" is too big (${(file.size / 1e6).toFixed(1)} MB). Single-file MJCF models are usually under 1 MB.`);
        return;
      }
      let text: string;
      try {
        text = await file.text();
      } catch {
        showError(`"${file.name}" couldn't be read. Try opening it again.`);
        return;
      }
      if (seq !== loadSeq) return; // the user picked something else meanwhile
      if (!/<mujoco[\s>]/i.test(text)) {
        showError(`"${file.name}" doesn't look like a MuJoCo model: it has no <mujoco> element.`);
        return;
      }
      if (loadXml(text, "custom")) {
        customXml = text;
        setSceneParam(null);
      }
    };

    const fileInput = $<HTMLInputElement>("#file-input");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = ""; // allow re-opening the same file after editing it
      if (file) void openFile(file);
    });

    // Drag-and-drop anywhere on the page.
    const overlay = $("#drop-overlay");
    let dragDepth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      dragDepth++;
      overlay.hidden = false;
    });
    window.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) overlay.hidden = true;
    });
    window.addEventListener("dragover", (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      overlay.hidden = true;
      const file = e.dataTransfer?.files[0];
      if (file) void openFile(file);
    });

    // Adaptive quality: if the device can't hold ~24 fps, drop to the cheap
    // renderer. Accessibility on low-end hardware is a core goal.
    if (params.get("quality") === "low") view.setLowQuality(true);
    else if (params.get("quality") !== "high") {
      setTimeout(() => {
        if (loop.stats.fps > 0 && loop.stats.fps < 24) view.setLowQuality(true);
      }, 2500);
    }

    const hud = $("#hud");
    setInterval(() => {
      const { fps, realtimeFactor } = loop.stats;
      const q = view.isLowQuality ? " · lite" : "";
      hud.textContent = `t ${cur.sim.time.toFixed(1)}s · ${fps.toFixed(0)} fps · ${(realtimeFactor * 100).toFixed(0)}% real-time${q}`;
    }, 250);

    $("#reset").addEventListener("click", () => cur.sim.reset());
    const pauseBtn = $<HTMLButtonElement>("#pause");
    pauseBtn.addEventListener("click", () => {
      loop.paused = !loop.paused;
      pauseBtn.textContent = loop.paused ? "Play" : "Pause";
    });

    Object.assign(hooks, {
      time: () => cur.sim.time,
      stats: () => ({ ...loop.stats, lowQuality: view.isLowQuality }),
      bodyPos: (name: string) => {
        const id = cur.sim.bodyId(name);
        if (id < 0) throw new Error(`no body named "${name}"`);
        const p = cur.sim.data.xpos;
        return [p[3 * id]!, p[3 * id + 1]!, p[3 * id + 2]!];
      },
      setDrive: (forward: number, turn: number) => {
        override = { forward, turn };
      },
      reset: () => cur.sim.reset(),
      scene: () => cur.sceneId,
      modelName: () => cur.sim.modelName,
      loadError: () => lastError,
      drawnGeoms: () => view.drawnCount,
      builderSpec: () => builder.spec,
      cameraPos: () => view.camera.position.toArray(),
    } satisfies Partial<TestHooks>);
    hooks.ready = true;
    status.hidden = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hooks.error = msg;
    status.textContent = `Something went wrong loading the simulator: ${msg}`;
    status.classList.add("error");
    console.error(err);
  }
}

function makeCurrent(sim: Sim, sceneId: string): Current {
  const left = sim.actuatorId("left");
  const right = sim.actuatorId("right");
  if (left < 0 || right < 0) return { sim, sceneId, drive: null };
  // Full stick = the motors' top speed (compiled robots set it per motor part).
  const range = sim.model.actuator_ctrlrange;
  const limits = sim.model.actuator_ctrllimited;
  const maxSpeed = driveTopSpeed(
    { limited: !!limits[left], max: range[2 * left + 1]! },
    { limited: !!limits[right], max: range[2 * right + 1]! },
  );
  const drive = { left, right, maxSpeed };
  return { sim, sceneId, drive };
}

void main();
