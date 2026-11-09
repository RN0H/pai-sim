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

const templateName = (id: string) => TEMPLATES.find((t) => t.id === id)?.spec.name ?? id;

/** Same robot (ignoring key order). */
function sameSpec(a: RobotSpec, b: RobotSpec): boolean {
  return (
    a.name === b.name &&
    a.chassis === b.chassis &&
    a.wheels === b.wheels &&
    a.motor === b.motor &&
    a.caster === b.caster &&
    (a.color ?? "") === (b.color ?? "") &&
    a.sensors.join() === b.sensors.join()
  );
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
  private spec: RobotSpec | null = null;
  /** Where focus goes when the tip disappears after its button is used. */
  focusAfterTip: HTMLElement | null = null;
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
      if (!this.env || !this.spec) return;
      // Don't throw away a robot the user designed without asking.
      const id = this.env.suggestedTemplate;
      const own = !TEMPLATES.some((t) => sameSpec(t.spec, this.spec!));
      if (own && !confirm(`Replace ${this.spec.name} with the ${templateName(id)}? Your changes to ${this.spec.name} will be lost.`)) return;
      onUseTemplate(id);
      // The button hides once the robot has the sensor: keep keyboard focus nearby.
      if (this.tip.hidden) this.focusAfterTip?.focus();
    });
  }

  /** Show the banner for `env` with this robot, or hide it (null). */
  show(env: Environment | null, spec: RobotSpec | null): void {
    const changed = env !== this.env;
    this.env = env;
    this.spec = spec;
    this.root.hidden = env === null;
    if (!env || !spec) return;
    this.envName.textContent = `${env.name}:`;
    const missing = missingSensors(env, spec);
    this.tip.hidden = missing.length === 0;
    if (missing.length) {
      const names = missing.map((id) => findPart("sensor", id)?.name.toLowerCase() ?? id).join(" and a ");
      this.tipText.textContent = `Tip: this one needs a ${names}. Add it in Build, or`;
      this.tipButton.textContent = `use the ${templateName(env.suggestedTemplate)}`;
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
      this.timer.textContent = status.started
        ? `${formatClock(status.remaining)} left`
        : `${formatClock(status.remaining)} left · the clock starts when you move`;
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
