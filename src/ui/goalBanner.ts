/**
 * The goal banner over the viewport: the environment, its goal, the time
 * left, and a success/fail message when the attempt ends. Also offers a
 * suitable template when the robot lacks a sensor the environment needs.
 * Screen readers hear the goal when the environment changes and the result
 * when an attempt ends, not every tick of the timer.
 */
import { missingSensors, type Environment, type TrackedStatus } from "../envs";
import { findPart } from "../robot/parts";
import type { RobotSpec } from "../robot/spec";
import { TEMPLATES } from "../robot/templates";

const $ = (root: HTMLElement, sel: string) => root.querySelector<HTMLElement>(sel)!;

/** "1:05" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export class GoalBanner {
  private readonly envName: HTMLElement;
  private readonly text: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly tip: HTMLElement;
  private readonly tipText: HTMLElement;
  private readonly tipButton: HTMLButtonElement;
  private readonly live: HTMLElement;
  private env: Environment | null = null;
  private lastKey = "";

  constructor(
    private readonly root: HTMLElement,
    onUseTemplate: (id: string) => void,
  ) {
    this.envName = $(root, "#goal-env");
    this.text = $(root, "#goal-text");
    this.timer = $(root, "#goal-timer");
    this.tip = $(root, "#goal-tip");
    this.tipText = $(root, "#goal-tip-text");
    this.tipButton = root.querySelector<HTMLButtonElement>("#goal-tip-use")!;
    this.live = $(root, "#goal-live");
    this.tipButton.addEventListener("click", () => {
      if (this.env) onUseTemplate(this.env.suggestedTemplate);
    });
  }

  /** Show the banner for `env` with this robot, or hide it (null). */
  show(env: Environment | null, spec: RobotSpec | null): void {
    const changed = env !== this.env;
    this.env = env;
    this.root.hidden = env === null;
    if (!env || !spec) return;
    this.envName.textContent = `${env.name}:`;
    const missing = missingSensors(env, spec);
    this.tip.hidden = missing.length === 0;
    if (missing.length) {
      const names = missing.map((id) => findPart("sensor", id)?.name.toLowerCase() ?? id).join(" and a ");
      const t = TEMPLATES.find((x) => x.id === env.suggestedTemplate)!;
      this.tipText.textContent = `Tip: this one needs a ${names}. Add it in Build, or`;
      this.tipButton.textContent = `use the ${t.spec.name}`;
    }
    if (changed) {
      this.lastKey = "";
      this.say(`${env.name}. ${env.goal} You have ${formatClock(env.timeLimit)}.`);
    }
  }

  /** Refresh from the tracker (a few times a second is plenty). */
  update(status: TrackedStatus): void {
    if (!this.env) return;
    const key = `${status.state}|${status.message}`;
    this.root.dataset.state = status.state;
    if (status.state === "running") {
      this.text.textContent = status.message;
      this.timer.textContent = `${formatClock(status.remaining)} left`;
    } else {
      this.text.textContent = status.state === "success" ? `${status.message} Time: ${status.time.toFixed(1)} s.` : status.message;
      this.timer.textContent = "";
    }
    // Announce results (not the running percentage or the clock).
    if (key !== this.lastKey) {
      if (status.state !== "running") this.say(this.text.textContent);
      this.lastKey = key;
    }
  }

  private say(text: string): void {
    this.live.textContent = "";
    requestAnimationFrame(() => (this.live.textContent = text));
  }
}
