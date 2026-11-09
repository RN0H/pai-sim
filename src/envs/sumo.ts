/**
 * Sumo ring: push the box out of the ring without leaving it yourself.
 */
import { circlePoints, f, floorDisc, floorLine } from "./mjcf";
import type { Environment } from "./types";

export const RING_RADIUS = 0.9;
/** The box: half-size and starting position. */
export const BOX_HALF = 0.08;
export const BOX_START = { x: 0.25, y: 0 } as const;
export const BOX_BODY = "sumo_box";

const GOAL = "Push the box out of the ring, but stay inside yourself.";

const box = `
    <body name="${BOX_BODY}" pos="${f(BOX_START.x)} ${f(BOX_START.y)} ${f(BOX_HALF)}">
      <freejoint name="${BOX_BODY}"/>
      <geom name="${BOX_BODY}" type="box" size="${f(BOX_HALF)} ${f(BOX_HALF)} ${f(BOX_HALF)}" mass="0.4" friction="0.6 0.005 0.0001" rgba="0.85 0.35 0.3 1"/>
    </body>`;

export const SUMO: Environment = {
  id: "sumo",
  name: "Sumo ring",
  goal: GOAL,
  timeLimit: 45,
  start: { x: -0.5, y: 0, yaw: 0 },
  world:
    floorDisc("ring", 0, 0, RING_RADIUS, "0.2 0.22 0.27 1") +
    floorLine("ring_edge", circlePoints(0, 0, RING_RADIUS - 0.02, 48), 0.04, true, "0.97 0.97 0.98 1") +
    box,
  needs: [],
  suggestedTemplate: "hauler",
  createGoal: () => ({
    update(view) {
      const [bx, by] = view.body(BOX_BODY);
      if (Math.hypot(bx, by) > RING_RADIUS) return { state: "success", message: "The box is out. You win!" };
      const [x, y] = view.body("rover");
      if (Math.hypot(x, y) > RING_RADIUS) return { state: "fail", message: "Your robot left the ring! Press Reset to try again." };
      return { state: "running", message: GOAL };
    },
  }),
};
