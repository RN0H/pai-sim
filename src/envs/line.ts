/**
 * Line track: a closed oval line (two straights joined by half circles).
 * Finish one lap following the line; straying too far from it fails.
 */
import { f, floorLine, VISUAL } from "./mjcf";
import type { Environment, EnvView, GoalStatus } from "./types";

/** Half-length of the straights and radius of the bends, in metres. */
export const HALF_STRAIGHT = 0.8;
export const BEND_RADIUS = 0.6;
export const LINE_WIDTH = 0.03;
/** The robot's centre may be at most this far from the line. */
export const OFF_TRACK = 0.3;
const BEND_SEGMENTS = 24;
const STRAIGHT_SEGMENTS = 4;

/** Points along the oval, anticlockwise, starting at the left end of the bottom straight. */
export function trackPoints(): [number, number][] {
  const pts: [number, number][] = [];
  const A = HALF_STRAIGHT;
  const R = BEND_RADIUS;
  const straight = (x0: number, x1: number, y: number) => {
    for (let i = 0; i < STRAIGHT_SEGMENTS; i++) pts.push([x0 + ((x1 - x0) * i) / STRAIGHT_SEGMENTS, y]);
  };
  const bend = (cx: number, a0: number) => {
    for (let i = 0; i < BEND_SEGMENTS; i++) {
      const a = a0 + (Math.PI * i) / BEND_SEGMENTS;
      pts.push([cx + R * Math.cos(a), R * Math.sin(a)]);
    }
  };
  straight(-A, A, -R);
  bend(A, -Math.PI / 2);
  straight(A, -A, R);
  bend(-A, Math.PI / 2);
  return pts;
}

/** Distance from (x, y) to the oval line. */
export function distanceToTrack(x: number, y: number): number {
  if (Math.abs(x) <= HALF_STRAIGHT) return Math.abs(Math.abs(y) - BEND_RADIUS);
  const cx = Math.sign(x) * HALF_STRAIGHT;
  return Math.abs(Math.hypot(x - cx, y) - BEND_RADIUS);
}

export const START = { x: -0.4, y: -BEND_RADIUS, yaw: 0 } as const;

const GOAL = "Follow the line for one full lap.";

/** Two posts beside the track mark the start and finish. */
const startPosts = [-1, 1]
  .map(
    (side) =>
      `\n    <geom name="line_start_${side < 0 ? "in" : "out"}" type="box" size="0.015 0.015 0.04" pos="${f(START.x)} ${f(START.y - side * 0.2)} 0.04" rgba="0.95 0.6 0.15 1" ${VISUAL}/>`,
  )
  .join("");

export const LINE_TRACK: Environment = {
  id: "line",
  name: "Line track",
  goal: GOAL,
  timeLimit: 90,
  start: START,
  world: floorLine("track", trackPoints(), LINE_WIDTH, true) + startPosts,
  needs: ["line"],
  suggestedTemplate: "sensor-bot",
  createGoal: () => {
    // Laps are counted by the angle swept around the oval's centre (the oval
    // is convex, so following it always turns the same way round).
    let last: number | null = null;
    let swept = 0;
    return {
      update(view: EnvView): GoalStatus {
        const [x, y] = view.body("rover");
        if (distanceToTrack(x, y) > OFF_TRACK) return { state: "fail", message: "Off the track! Press Reset to try again." };
        const a = Math.atan2(y, x);
        if (last !== null) {
          let d = a - last;
          if (d > Math.PI) d -= 2 * Math.PI;
          if (d < -Math.PI) d += 2 * Math.PI;
          swept += d;
        }
        last = a;
        if (Math.abs(swept) >= 2 * Math.PI) return { state: "success", message: "Lap complete!" };
        const pct = Math.floor((Math.abs(swept) / (2 * Math.PI)) * 100);
        return { state: "running", message: `${GOAL} ${pct}% done.` };
      },
    };
  },
};
