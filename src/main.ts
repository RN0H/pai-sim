import wasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import { loadEngine, Sim } from "./physics/engine";
import { SceneRenderer } from "./render/renderer";
import { SimLoop } from "./app/loop";
import { DriveInput, wheelSpeeds } from "./app/drive";
import { HELLO_XML } from "./scenes/hello";
import "./style.css";

const MAX_WHEEL_SPEED = 10; // rad/s

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
}

declare global {
  interface Window {
    __paiSim: TestHooks;
  }
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
  });

  const status = $("#status");
  try {
    status.textContent = "Loading physics engine…";
    const mj = await loadEngine({ locateFile: () => wasmUrl });
    const sim = new Sim(mj, HELLO_XML);

    const view = new SceneRenderer($("#viewport"));
    view.load(sim);

    const drive = new DriveInput();
    for (const btn of document.querySelectorAll<HTMLElement>("[data-key]")) {
      drive.bindButton(btn, btn.dataset.key!);
    }
    let override: { forward: number; turn: number } | null = null;

    const actLeft = sim.model.actuator("left").id;
    const actRight = sim.model.actuator("right").id;

    const loop = new SimLoop(
      sim,
      (s) => {
        const cmd = override ?? drive.cmd;
        const { left, right } = wheelSpeeds(cmd, MAX_WHEEL_SPEED);
        s.data.ctrl[actLeft] = left;
        s.data.ctrl[actRight] = right;
      },
      (s) => {
        view.sync(s);
        view.render();
      },
    );
    loop.start();

    // Adaptive quality: if the device can't hold ~24 fps, drop to the cheap
    // renderer. Accessibility on low-end hardware is a core goal.
    const params = new URLSearchParams(location.search);
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
      hud.textContent = `t ${sim.time.toFixed(1)}s · ${fps.toFixed(0)} fps · ${(realtimeFactor * 100).toFixed(0)}% real-time${q}`;
    }, 250);

    $("#reset").addEventListener("click", () => sim.reset());
    const pauseBtn = $<HTMLButtonElement>("#pause");
    pauseBtn.addEventListener("click", () => {
      loop.paused = !loop.paused;
      pauseBtn.textContent = loop.paused ? "Play" : "Pause";
    });

    Object.assign(hooks, {
      time: () => sim.time,
      stats: () => ({ ...loop.stats, lowQuality: view.isLowQuality }),
      bodyPos: (name: string) => {
        const id = sim.model.body(name).id;
        const p = sim.data.xpos;
        return [p[3 * id]!, p[3 * id + 1]!, p[3 * id + 2]!];
      },
      setDrive: (forward: number, turn: number) => {
        override = { forward, turn };
      },
      reset: () => sim.reset(),
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

void main();
