/**
 * Keyboard + on-screen drive input for a differential-drive robot.
 * Maps (forward, turn) in [-1, 1] to left/right wheel velocity commands.
 */
export interface DriveCommand {
  forward: number;
  turn: number;
}

export function wheelSpeeds(cmd: DriveCommand, maxSpeed: number): { left: number; right: number } {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const left = clamp(cmd.forward - cmd.turn);
  const right = clamp(cmd.forward + cmd.turn);
  return { left: left * maxSpeed, right: right * maxSpeed };
}

/** Drive pad top speed when a model doesn't limit its wheel actuators, in rad/s. */
export const DEFAULT_DRIVE_SPEED = 10;
/** Never command more than this from the pad, whatever a model allows (rad/s). */
export const MAX_DRIVE_SPEED = 30;

/**
 * Full-stick wheel speed for a model's left/right actuators: the smaller of
 * their upper control limits (so compiled robots drive at their motor's top
 * speed), capped at MAX_DRIVE_SPEED, or the default when they aren't limited.
 */
export function driveTopSpeed(left: { limited: boolean; max: number }, right: { limited: boolean; max: number }): number {
  if (!left.limited || !right.limited) return DEFAULT_DRIVE_SPEED;
  const top = Math.min(left.max, right.max);
  if (!Number.isFinite(top) || top <= 0) return DEFAULT_DRIVE_SPEED;
  return Math.min(top, MAX_DRIVE_SPEED);
}

export class DriveInput {
  readonly cmd: DriveCommand = { forward: 0, turn: 0 };
  private readonly held = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener("keydown", (e) => {
      // Leave arrow keys to form controls (e.g. the scene picker) and editors.
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      )
        return;
      if (this.isDriveKey(e.key)) {
        this.held.add(e.key.toLowerCase());
        e.preventDefault();
        this.update();
      }
    });
    target.addEventListener("keyup", (e) => {
      this.held.delete(e.key.toLowerCase());
      this.update();
    });
    target.addEventListener("blur", () => {
      this.held.clear();
      this.update();
    });
  }

  /** Hold a virtual key while a pointer is down (on-screen pad). */
  bindButton(el: HTMLElement, key: string): void {
    const down = (e: Event) => {
      e.preventDefault();
      this.held.add(key);
      this.update();
    };
    const up = () => {
      this.held.delete(key);
      this.update();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("pointercancel", up);
    // A long press on touch screens (iOS Safari, Android) opens a context menu,
    // which cancels the press; holding a drive button should just keep driving.
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private isDriveKey(key: string): boolean {
    return ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key.toLowerCase());
  }

  private update(): void {
    const h = (k: string) => this.held.has(k);
    this.cmd.forward = (h("arrowup") || h("w") ? 1 : 0) - (h("arrowdown") || h("s") ? 1 : 0);
    this.cmd.turn = (h("arrowleft") || h("a") ? 1 : 0) - (h("arrowright") || h("d") ? 1 : 0);
  }
}
