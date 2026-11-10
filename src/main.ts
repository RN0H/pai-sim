import wasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import { friendlyLoadError, loadEngine, Sim, type Mujoco } from "./physics/engine";
import { SceneRenderer } from "./render/renderer";
import { SimLoop } from "./app/loop";
import { DriveInput, driveTopSpeed, wheelSpeeds } from "./app/drive";
import { DEFAULT_SCENE_ID, findScene, SCENES } from "./scenes";
import { templateSpec } from "./robot/templates";
import type { RobotSpec } from "./robot/spec";
import { BuilderPanel } from "./ui/builder";
import { DEFAULT_ENV_ID, ENVIRONMENTS, envScene, findEnv, GoalTracker, simView, type EnvView, type TrackedStatus } from "./envs";
import { GoalBanner } from "./ui/goalBanner";
import { CodePanel } from "./ui/codePanel";
import { isSoftwareRenderer } from "./render/software";
import type { Controller } from "./control/controller";
import { formatProgramError, type Language } from "./control/api";
import { startInWorker } from "./control/host";
import { decodeShare, payloadFromHash, remixOf, shareUrl, stripBlockIds, type ShareCore, type ShareState } from "./share/link";
import { RemixBar, ShareDialog, type LinkResult } from "./ui/share";
import "./style.css";

/** Larger files are almost certainly not a single-file MJCF model. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CUSTOM_OPTION = "__custom";
const BUILD_OPTION = "__build";
/** Scene id for the robot made in the builder. */
const BUILD_SCENE = "build";

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
  /** Environment the robot is in ("build" scene only), or null. */
  env(): string | null;
  /** The environment goal's status, or null outside an environment. */
  goal(): TrackedStatus | null;
  /** Number of geoms currently drawn. */
  drawnGeoms(): number;
  /** The robot spec the builder shows (read-only: tests build through the UI). */
  builderSpec(): RobotSpec;
  /** Camera position in render coordinates. */
  cameraPos(): [number, number, number];
  /** The controller program: "none" (never run or stopped), "running" or "failed", its last error and wheel command. */
  program(): {
    state: "none" | "running" | "failed";
    error: string | null;
    wheels: { left: number; right: number };
    time: number;
    /** The running program's language, or null. */
    language: Language | null;
    /** False while a Python program waits for Python to load. */
    loaded: boolean;
  };
  /**
   * The sim's path since the program last started, one row per physics step
   * (the first 2,000): [sim time, x, y, z of the "rover" body, ...all of qpos].
   */
  programTrace(): number[][];
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
  /** For the "build" scene: the environment it's in. */
  envId: string | null;
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
    env: () => null,
    goal: () => null,
    drawnGeoms: () => 0,
    builderSpec: () => templateSpec("hauler"),
    cameraPos: () => [0, 0, 0],
    program: () => ({ state: "none", error: null, wheels: { left: 0, right: 0 }, time: 0, language: null, loaded: false }),
    programTrace: () => [],
  });

  const status = $("#status");
  try {
    status.textContent = "Loading physics engine…";
    const mj: Mujoco = await loadEngine({ locateFile: () => wasmUrl });
    const params = new URLSearchParams(location.search);

    // A share link (#s=…) is the whole sim: it wins over ?scene= / ?env=.
    // A broken one falls back to the default scene, with a message.
    const payload = payloadFromHash(location.hash);
    let opened: ShareState | null = null;
    let linkError: string | null = null;
    if (payload !== null) {
      status.textContent = "Opening the shared sim…";
      const read = await decodeShare(payload);
      if (read.ok) opened = read.state;
      else linkError = read.error;
    }
    const openedUrl = location.href;
    // Pasting another link into this tab only changes the fragment: open it properly.
    // (and going Back from a link's page to the plain site shows the plain site).
    window.addEventListener("hashchange", (e) => {
      if (payloadFromHash(location.hash) !== null || payloadFromHash(new URL(e.oldURL).hash) !== null) location.reload();
    });

    const picker = $<HTMLSelectElement>("#scene-picker");
    for (const s of SCENES) picker.add(new Option(s.name, s.id));

    // ?env=<id> opens the builder's robot in an environment (with the
    // template that suits it); otherwise ?scene=<id> picks a bundled scene.
    const wantsEnv = payload === null && params.has("env");
    let envId = wantsEnv ? findEnv(params.get("env")).id : DEFAULT_ENV_ID;
    let initialSpec = templateSpec(wantsEnv ? findEnv(envId).suggestedTemplate : "hauler");
    let first: Current | null = null;
    if (opened?.robot) {
      // Validated already, but a link must never stop the page from loading.
      const built = envScene(findEnv(opened.env), opened.robot);
      try {
        if (!built.ok) throw new Error(built.errors.join(" "));
        first = makeCurrent(new Sim(mj, built.xml), BUILD_SCENE, opened.env!);
        envId = opened.env!;
        initialSpec = opened.robot;
      } catch (err) {
        linkError = `The robot in this link can't be built: ${friendlyLoadError(err)}`;
        opened = null;
      }
    } else if (wantsEnv) {
      const built = envScene(findEnv(envId), initialSpec);
      if (built.ok) first = makeCurrent(new Sim(mj, built.xml), BUILD_SCENE, envId);
    }
    if (!first) {
      const initial = findScene(opened?.scene ?? (payload === null ? params.get("scene") : null));
      first = makeCurrent(new Sim(mj, initial.xml), initial.id, null);
    }
    let cur: Current = first;

    const envPicker = $<HTMLSelectElement>("#env-picker");
    // Shown while a scene other than "My robot" runs: picking any environment then loads the robot into it.
    const envPlaceholder = new Option("Challenges…", "");
    envPlaceholder.disabled = true;
    envPicker.add(envPlaceholder);
    for (const e of ENVIRONMENTS) envPicker.add(new Option(e.name, e.id));

    /** The goal of the environment the robot is in (null outside one), and its view of the sim. */
    let goal: GoalTracker | null = null;
    let goalView: EnvView | null = null;
    const trackGoal = () => {
      goal = cur.envId ? new GoalTracker(findEnv(cur.envId)) : null;
      goalView = goal ? simView(cur.sim) : null;
    };
    trackGoal();

    const view = new SceneRenderer($("#viewport"));
    view.load(cur.sim);
    view.frame(cur.sim);

    const drive = new DriveInput();
    for (const btn of document.querySelectorAll<HTMLElement>("[data-key]")) {
      drive.bindButton(btn, btn.dataset.key!);
    }
    let override: { forward: number; turn: number } | null = null;
    /** The running controller program, if any. It drives the wheels instead of the pad. */
    let program: Controller | null = null;
    let programFailure: string | null = null;
    /** See TestHooks.programTrace. */
    let trace: number[][] = [];
    let traceBody = 0;
    const TRACE_STEPS = 2000;

    const loop = new SimLoop(
      cur.sim,
      (s) => {
        if (goal && goalView) goal.update(goalView);
        if (program) {
          const go = program.beforeStep();
          if (go !== false && trace.length < TRACE_STEPS) {
            const x = s.data.xpos as ArrayLike<number>;
            const q = s.data.qpos as ArrayLike<number>;
            const row = [s.time, x[3 * traceBody]!, x[3 * traceBody + 1]!, x[3 * traceBody + 2]!];
            for (let i = 0; i < q.length; i++) row.push(q[i]!);
            trace.push(row);
          }
          return go;
        }
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
    const errorTitle = $("#load-error-title");
    const errorSub = $("#load-error-sub");
    let lastError: string | null = null;

    const showError = (msg: string, kind: "model" | "link" = "model") => {
      lastError = msg;
      errorTitle.textContent = kind === "link" ? "Couldn't open that link." : "Couldn't open that model.";
      errorSub.textContent = kind === "link" ? "Showing the default scene instead." : "The previous scene is still running.";
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
      builder.setShowing(cur.sceneId === BUILD_SCENE);
      envPicker.value = cur.envId ?? "";
      banner.show(cur.envId ? findEnv(cur.envId) : null, cur.envId ? builtSpec : null);
      if (goal) banner.update(goal.status);
      const hasDrive = cur.drive !== null;
      pad.hidden = !hasDrive || program !== null;
      // Touch screens (phones, tablets) get touch wording.
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const view = touch ? "drag to orbit · pinch to zoom" : "drag to orbit · scroll to zoom";
      hint.textContent = program
        ? `Your program is driving · ${view}`
        : hasDrive
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

    /** Put the scene (or, for the robot, its environment) in the URL. Defaults are left out. */
    const setSceneParam = (id: string | null, env: string | null = null) => {
      const url = new URL(location.href);
      if (id && id !== DEFAULT_SCENE_ID) url.searchParams.set("scene", id);
      else url.searchParams.delete("scene");
      if (env && env !== DEFAULT_ENV_ID) url.searchParams.set("env", env);
      else url.searchParams.delete("env");
      // The sim isn't the link's any more: a reload keeps what's showing.
      url.hash = "";
      history.replaceState(null, "", url);
    };

    const swapIn = (sim: Sim, sceneId: string, keepCamera: boolean, env: string | null = null) => {
      clearError();
      if (program) stopProgram("Stopped: the scene changed. Press Run to start it on this robot.");
      const old = cur.sim;
      cur = makeCurrent(sim, sceneId, env);
      trackGoal();
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
    /**
     * Load a builder spec as the "My robot" scene, in environment `env`.
     * `reframe` points the camera at the whole scene. Returns an error message, or null.
     */
    /** The robot in the "My robot" scene (the builder only takes a spec once it has loaded). */
    let builtSpec: RobotSpec = initialSpec;
    const loadBuild = (spec: RobotSpec, env: string = envId, reframe = false): string | null => {
      const built = envScene(findEnv(env), spec);
      if (!built.ok) return built.errors.join(" ");
      let sim: Sim;
      try {
        sim = new Sim(mj, built.xml);
      } catch (err) {
        return friendlyLoadError(err);
      }
      loadSeq++;
      // Rebuilding the robot keeps the user's view; only re-frame when coming
      // from a scene laid out differently (another environment, the arm, a
      // user's file). The Hello rover sits where the playground robot does.
      const sameLayout =
        !reframe &&
        ((cur.sceneId === BUILD_SCENE && cur.envId === env) || (cur.sceneId === "hello" && env === DEFAULT_ENV_ID));
      envId = env;
      builtSpec = built.spec;
      swapIn(sim, BUILD_SCENE, sameLayout, env);
      setSceneParam(null, env);
      return null;
    };

    const builderPanel = $("#builder");
    const builderToggle = $<HTMLButtonElement>("#builder-toggle");
    const builder = new BuilderPanel($<HTMLFormElement>("#builder-form"), {
      initial: initialSpec, // the Hello scene's robot, or the template suiting ?env=
      onChange: (spec) => loadBuild(spec),
    });
    const banner = new GoalBanner($("#goal"), (id) => builder.useTemplate(id));
    banner.focusAfterTip = envPicker;

    envPicker.addEventListener("change", () => {
      if (!envPicker.value) return;
      // A new environment is laid out differently: show all of it.
      const failure = loadBuild(builder.spec, envPicker.value, true);
      if (failure) {
        showError(failure);
        syncUi();
      }
    });
    let builderOpen = false;
    const setBuilderOpen = (open: boolean) => {
      if (open && codeOpen) setCodeOpen(false, false);
      builderOpen = open;
      builderPanel.hidden = !open;
      builderToggle.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("building", open);
      if (open) builderPanel.querySelector<HTMLElement>("[data-template]")?.focus();
      else builderToggle.focus();
    };
    builderToggle.addEventListener("click", () => setBuilderOpen(!builderOpen));
    $("#builder-close").addEventListener("click", () => setBuilderOpen(false));
    window.addEventListener("keydown", (e) => {
      // Escape closes a panel, unless it's closing a control's own popup.
      if (e.key !== "Escape" || e.defaultPrevented || e.target instanceof HTMLSelectElement) return;
      // In Blockly's menus and field editors, Escape closes them, not the panel.
      if (e.target instanceof Element && e.target.closest(".blocklyWidgetDiv, .blocklyDropDownDiv")) return;
      if (shareDialog.isOpen) {
        e.preventDefault();
        shareDialog.close();
        return;
      }
      if (builderOpen) {
        e.preventDefault();
        setBuilderOpen(false);
      } else if (codeOpen) {
        e.preventDefault();
        setCodeOpen(false);
      }
    });

    // ---- Code panel (controller programs) ------------------------------------
    const codePanelEl = $("#code");
    const codeToggle = $<HTMLButtonElement>("#code-toggle");
    let codeOpen = false;
    function setCodeOpen(open: boolean, moveFocus = true): void {
      if (open && builderOpen) setBuilderOpen(false);
      codeOpen = open;
      if (!open) code.hidePopups();
      codePanelEl.hidden = !open;
      codeToggle.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("coding", open);
      // On touch screens, focusing the editor would pop up the keyboard over the sim.
      if (open) code.shown();
      if (!moveFocus) return;
      if (open) (window.matchMedia("(pointer: coarse)").matches ? code.firstControl : code.editor).focus();
      else codeToggle.focus();
    }
    codeToggle.addEventListener("click", () => setCodeOpen(!codeOpen));
    $("#code-close").addEventListener("click", () => setCodeOpen(false));

    /** The code of the program last started, for restarting it on Reset. */
    let programCode: string | null = null;
    let programLanguage: Language = "javascript";
    /** The running program's language has loaded (Python takes a while the first time). */
    let programLoaded = false;

    const stopProgram = (message: string) => {
      program?.stop();
      program = null;
      programCode = null;
      code.setRunning(false, message);
      syncUi();
    };

    const startProgram = (text: string, language: Language) => {
      program?.stop();
      program = null;
      programFailure = null;
      if (!cur.drive) {
        code.setRunning(false, "This scene has no robot to drive. Pick Hello rover, Sensor playground, a challenge or your own robot.");
        return;
      }
      cur.sim.reset();
      override = null;
      programCode = text;
      programLanguage = language;
      programLoaded = language === "javascript";
      trace = [];
      traceBody = Math.max(0, cur.sim.bodyId("rover"));
      const sim = cur.sim;
      const ctl: Controller = startInWorker(
        sim,
        text,
        {
          onLogs: (lines) => code.addOutput(lines),
          onError: (err) => {
            if (program !== ctl) return;
            program = null;
            programCode = null;
            programFailure = formatProgramError(err);
            code.setRunning(false);
            code.showError(err);
            syncUi();
          },
        },
        () => loop.pump(),
        language,
        () => {
          // Python has loaded (called later, never during startInWorker).
          if (program !== ctl) return;
          programLoaded = true;
          code.setRunning(true, `Running on ${sim.modelName || "the robot"}.`);
        },
      );
      program = ctl;
      code.setRunning(
        true,
        programLoaded ? `Running on ${sim.modelName || "the robot"}.` : "Loading Python… The first run downloads about 12 MB, so it can take a while.",
      );
      syncUi();
    };

    const code = new CodePanel($("#code-body"), {
      initialCode: STARTER_CODE,
      initialPython: STARTER_PYTHON,
      onRun: startProgram,
      onStop: () => stopProgram("Stopped."),
    });
    if (opened?.program) code.restore(opened.program);
    syncUi();

    // ---- Share + remix ---------------------------------------------------------
    /** The sim as a link describes it, or why it can't be shared. */
    const snapshot = (): ShareCore | string => {
      const p = code.program();
      const program = p.blocks ? { ...p, blocks: stripBlockIds(p.blocks) } : p;
      if (cur.sceneId === BUILD_SCENE) return { v: 1, robot: builtSpec, env: cur.envId ?? DEFAULT_ENV_ID, program };
      if (cur.sceneId === "custom") {
        return "A model opened from a file can't go in a link yet. Pick “My robot” or one of the bundled scenes to share.";
      }
      return { v: 1, scene: cur.sceneId, program };
    };
    /** Where links point: this page without its query (the link holds everything). */
    const siteUrl = () => location.origin + location.pathname;
    const coreName = (c: ShareCore) => c.robot?.name ?? findScene(c.scene).name;
    const shareDialog = new ShareDialog($("#share"), $<HTMLButtonElement>("#share-toggle"), {
      makeLink: async (): Promise<LinkResult> => {
        const core = snapshot();
        if (typeof core === "string") return { ok: false, reason: core };
        const state = remixOf(core, opened);
        const url = await shareUrl(siteUrl(), state);
        const parent = state.parent ? { name: coreName(state.parent), url: await shareUrl(siteUrl(), state.parent) } : null;
        return { ok: true, url, remixOf: parent };
      },
    });
    if (opened) {
      const shared = opened;
      new RemixBar($("#remix")).show({
        name: coreName(shared),
        url: openedUrl,
        parent: shared.parent ? { name: coreName(shared.parent), url: await shareUrl(siteUrl(), shared.parent) } : null,
        run: shared.program
          ? () => {
              // Blocks run as blocks: show them (Blockly needs to be on screen to start).
              if (shared.program?.blocks && !codeOpen) setCodeOpen(true, false);
              code.run();
            }
          : undefined,
        afterDismiss: $<HTMLButtonElement>("#share-toggle"),
      });
    }

    picker.addEventListener("change", () => {
      loadSeq++;
      if (picker.value === BUILD_OPTION) {
        // Back to the robot from the builder.
        const failure = loadBuild(builder.spec);
        if (failure) {
          showError(failure);
          syncUi();
        }
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
    // Software-rendered WebGL (no GPU) is always slow: start in lite mode, so
    // the first seconds run in real time too.
    if (params.get("quality") === "low") view.setLowQuality(true);
    else if (params.get("quality") !== "high") {
      if (isSoftwareRenderer(view.glRendererName)) view.setLowQuality(true);
      setTimeout(() => {
        if (!view.isLowQuality && loop.stats.fps > 0 && loop.stats.fps < 24) view.setLowQuality(true);
      }, 2500);
    }

    const hud = $("#hud");
    setInterval(() => {
      if (goal) banner.update(goal.status);
      const { fps, realtimeFactor } = loop.stats;
      const q = view.isLowQuality ? " · lite" : "";
      hud.textContent = `t ${cur.sim.time.toFixed(1)}s · ${fps.toFixed(0)} fps · ${(realtimeFactor * 100).toFixed(0)}% real-time${q}`;
    }, 250);

    // Reset restarts a running program too, so it starts from the beginning.
    const resetAll = () => {
      if (program && programCode !== null) startProgram(programCode, programLanguage);
      else cur.sim.reset();
      // A fresh attempt now, even while paused (the loop only checks the goal when it steps).
      if (goal) {
        goal.restart();
        banner.update(goal.status);
      }
    };
    $("#reset").addEventListener("click", resetAll);
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
      reset: resetAll,
      scene: () => cur.sceneId,
      modelName: () => cur.sim.modelName,
      loadError: () => lastError,
      env: () => cur.envId,
      goal: () => (goal ? { ...goal.status } : null),
      drawnGeoms: () => view.drawnCount,
      builderSpec: () => builder.spec,
      cameraPos: () => view.camera.position.toArray(),
      program: () => ({
        state: program ? "running" : programFailure ? "failed" : "none",
        error: programFailure,
        wheels: program?.wheels ?? { left: 0, right: 0 },
        time: program?.time ?? 0,
        language: program ? programLanguage : null,
        loaded: !!program && programLoaded,
      }),
      programTrace: () => trace.map((r) => [...r]),
    } satisfies Partial<TestHooks>);
    if (linkError) showError(linkError, "link");
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

/** What the code editor starts with. */
const STARTER_CODE = `// Your robot's program. Pick an example above, or write your own.
// Top-level code runs once; loop() runs 50 times a second.

function loop() {
  robot.setWheels(0.5, 0.5); // both wheels half speed forward
}
`;

/** What the code editor starts with in Python. */
const STARTER_PYTHON = `# Your robot's program in Python. Pick an example above, or write your own.
# Top-level code runs once; loop() runs 50 times a second.

def loop():
    robot.set_wheels(0.5, 0.5)  # both wheels half speed forward
`;

function makeCurrent(sim: Sim, sceneId: string, envId: string | null): Current {
  const left = sim.actuatorId("left");
  const right = sim.actuatorId("right");
  if (left < 0 || right < 0) return { sim, sceneId, envId, drive: null };
  // Full stick = the motors' top speed (compiled robots set it per motor part).
  const range = sim.model.actuator_ctrlrange;
  const limits = sim.model.actuator_ctrllimited;
  const maxSpeed = driveTopSpeed(
    { limited: !!limits[left], max: range[2 * left + 1]! },
    { limited: !!limits[right], max: range[2 * right + 1]! },
  );
  const drive = { left, right, maxSpeed };
  return { sim, sceneId, envId, drive };
}

void main();
