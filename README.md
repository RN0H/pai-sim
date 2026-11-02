# PAI Sim

**Build, run and share robots in your browser. No install.**

Live: https://rn0h.github.io/pai-sim/

PAI Sim makes robotics simulation accessible to everyone: anyone with a link
and a cheap laptop or phone can build a robot, program it, and share it.
Physics runs locally in the browser with [MuJoCo](https://mujoco.org) compiled
to WebAssembly, and rendering uses [Three.js](https://threejs.org).

## Status

Preview. Milestone 0 is done: the engine, renderer and a drivable rover, with
a full test harness. The rover MVP is being built one milestone at a time; see
[`MILESTONES.md`](MILESTONES.md).

Drive with the arrow keys or WASD (or the on-screen pad on phones). Drag to
orbit, scroll to zoom. Add `?quality=low` for slower devices.

## Develop

```sh
npm ci
npm run dev      # http://localhost:5173/pai-sim/
npm run check    # typecheck, unit tests, build, browser tests
```

Contributors and agents: start with [`CLAUDE.md`](CLAUDE.md).

## License

MIT. MuJoCo is Apache-2.0; Three.js is MIT.
