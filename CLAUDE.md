# PAI Sim — guide for agents

PAI Sim is a robotics simulator that runs entirely in the browser. The goal is
**accessibility**: anyone with a link and a cheap laptop or phone can build a
robot, program it, run it, and share it, with no install and no robotics
background. Live site: https://rn0h.github.io/pai-sim/

Most implementation is done by agents. A human reviews and merges every PR.
Read this file fully before changing anything, then read `MILESTONES.md`.

## Commands

```sh
npm ci                 # install
npm run dev            # local dev server (http://localhost:5173/pai-sim/)
npm run typecheck      # tsc, strict
npm test               # unit tests (Node, no browser) — fast, run often
npm run build          # production build into dist/
npm run test:e2e       # browser tests against the built site (run build first)
npm run check          # everything above, in order. Must pass before a PR.
```

If Playwright's own Chromium isn't installed, point it at a system Chrome:
`CHROME_PATH=/usr/bin/google-chrome npm run test:e2e`.

## Architecture

Static site (Vite + TypeScript), deployed to GitHub Pages. No backend: every
feature must work from static files. Physics runs client-side, so serving a
user costs nothing.

| Module | Path | Responsibility |
|---|---|---|
| Physics | `src/physics/engine.ts` | Wraps MuJoCo WASM (`@mujoco/mujoco`). Loads models, steps, resets, sanity checks. Environment-agnostic: runs in Node for tests. |
| Rendering | `src/render/renderer.ts` | Mirrors MuJoCo geoms into Three.js. MuJoCo is z-up; a root group rotates the world so physics numbers are used unchanged. |
| App loop | `src/app/loop.ts` | Fixed-timestep physics decoupled from render rate; tracks fps and real-time factor. |
| Input | `src/app/drive.ts` | Keyboard and on-screen drive pad → wheel speeds. |
| Scenes | `src/scenes/` | MJCF models (as TS strings). |
| Entry | `src/main.ts` | Wires everything; exposes `window.__paiSim` test hooks. |

Planned modules (see `MILESTONES.md`): `src/robot/` (parts library, robot
spec, parts→MJCF compiler), `src/ui/` (builder), `src/control/` (controller
sandbox), `src/envs/` (environments), `src/share/` (share links).

**Keep module boundaries.** A task should touch one module plus its tests
where possible. Pure logic (the compiler, serialization, drive math) must not
import Three.js or touch the DOM, so it stays unit-testable in Node.

## Rules

1. **Small, verified steps.** Run `npm test` after each meaningful change, and
   `npm run check` before opening a PR.
2. **Protected tests.** Files under `tests/` and any golden data are the
   contract. Never weaken an assertion, loosen a tolerance, delete a test, or
   regenerate golden data to make your change pass. If a test is genuinely
   wrong, change it in a separate commit and explain why in the PR under
   "Test changes". New tests are always welcome.
3. **Every feature ships with tests**: unit tests for logic, a Playwright test
   for anything a user does in the UI.
4. **Look at your work.** e2e tests save screenshots to
   `test-results/screenshots/`. Open them and check the result looks right;
   tests can pass while the page looks broken (that has happened here).
5. **Accessibility is the product.** Keep the performance test passing (≥ 80%
   real time in software-rendered Chrome). Support keyboard, touch and
   phone-sized screens. Don't add heavy dependencies without a reason in the PR.
6. **Free MuJoCo handles.** Embind objects aren't garbage-collected. Call
   `.delete()` on what you create (`Sim.dispose()` does this for model/data).
7. **No secrets, no tracking, no backend.**
8. **TypeScript strict**, no `any` unless unavoidable (comment why).

## Physics gotchas (learned the hard way)

- MuJoCo **silently resets** the simulation when it goes unstable (time jumps
  back to 0, ctrl zeroed). `Sim.instabilityCount()` detects this; physics
  tests must assert it stays 0.
- Stiff velocity actuators on light wheels blow up with the default Euler
  integrator. Use `integrator="implicitfast"` and give wheel joints some
  `armature`.
- MuJoCo hinge direction follows the joint axis after body rotation; check
  that "forward" actually drives +x with a test, don't assume.
- Deleting the `data.warning` vector from JS aborts the WASM runtime. Don't.
- Software-rendered browsers run at ~5–10 fps. The loop lets physics catch up
  (up to 0.25 s per frame) and the renderer switches to "lite" mode
  (no shadows, 1× pixel ratio) below 24 fps. `?quality=low|high` forces it.

## Definition of done (every PR)

- [ ] `npm run check` passes locally
- [ ] Screenshots checked by eye
- [ ] Milestone checklist items in `MILESTONES.md` ticked only if truly done
- [ ] PR description: what changed, how it was verified, screenshots,
      anything the reviewer should look at, and a "Test changes" section
      (or "none")
