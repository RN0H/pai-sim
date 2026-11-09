/**
 * Flat playground: open floor and a green target zone. The first
 * challenge: drive (by hand or with a program) into the circle.
 */
import { flag, floorDisc } from "./mjcf";
import type { Environment } from "./types";

export const TARGET = { x: 1.6, y: 0.8, radius: 0.3 } as const;

const RUNNING = { state: "running", message: "Drive into the green circle." } as const;

export const PLAYGROUND: Environment = {
  id: "playground",
  name: "Playground",
  goal: "Drive into the green circle.",
  timeLimit: 60,
  start: { x: 0, y: 0, yaw: 0 },
  world: floorDisc("target", TARGET.x, TARGET.y, TARGET.radius, "0.55 0.85 0.6 1") + flag("target_flag", TARGET.x, TARGET.y),
  needs: [],
  suggestedTemplate: "scout",
  createGoal: () => ({
    update(view) {
      const [x, y] = view.body("rover");
      return Math.hypot(x - TARGET.x, y - TARGET.y) < TARGET.radius
        ? { state: "success", message: "You reached the circle!" }
        : RUNNING;
    },
  }),
};
