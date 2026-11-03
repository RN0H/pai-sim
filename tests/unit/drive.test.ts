/** Drive pad speed limits. PROTECTED: see CLAUDE.md. */
import { describe, expect, it } from "vitest";
import { DEFAULT_DRIVE_SPEED, driveTopSpeed, MAX_DRIVE_SPEED } from "../../src/app/drive";

describe("driveTopSpeed", () => {
  const lim = (max: number) => ({ limited: true, max });
  it("uses the motors' top speed, the slower side if they differ", () => {
    expect(driveTopSpeed(lim(12), lim(12))).toBe(12);
    expect(driveTopSpeed(lim(20), lim(15))).toBe(15);
  });
  it("falls back to the default for unlimited or nonsense ranges", () => {
    expect(driveTopSpeed({ limited: false, max: 0 }, lim(5))).toBe(DEFAULT_DRIVE_SPEED);
    expect(driveTopSpeed(lim(0), lim(0))).toBe(DEFAULT_DRIVE_SPEED);
    expect(driveTopSpeed(lim(-3), lim(4))).toBe(DEFAULT_DRIVE_SPEED);
    expect(driveTopSpeed(lim(NaN), lim(4))).toBe(DEFAULT_DRIVE_SPEED);
  });
  it("never exceeds the safety cap, whatever a model allows", () => {
    expect(driveTopSpeed(lim(1000), lim(1000))).toBe(MAX_DRIVE_SPEED);
  });
});
