/**
 * Runs a user's Python controller program, one control tick at a time, on
 * a Pyodide runtime (CPython compiled to WebAssembly). The Python worker
 * (src/control/pyWorker.ts) loads Pyodide and hands it here; unit tests
 * pass Pyodide loaded in Node. Pure logic: no DOM, no MuJoCo, and no
 * runtime import of Pyodide (it's ~12 MB, loaded only when Python runs).
 *
 * Program shape, the same as JavaScript's: top-level code runs once, on the
 * first tick; a top-level `def loop():` is then called on every tick.
 *
 *   robot.set_wheels(left, right)   wheel speeds from -1 to 1 (setWheels works too)
 *   robot.read("distance")          a sensor's value
 *   robot.time                      seconds since the program started
 *   print(...)                      shows in the panel's output
 *
 * Errors carry the line in the user's code (the last traceback frame in it).
 */
import { MAX_LOG_CHARS, MAX_LOG_LINES, type Reply, type TickMessage } from "./api";

/** The part of Pyodide's API this needs (so tests and the worker can pass the real thing). */
export interface PythonRuntime {
  runPython(code: string): unknown;
  globals: { get(name: string): unknown };
}

/** Filename user code is compiled under, to find its frames in tracebacks. */
const PROGRAM_FILE = "<program>";

/**
 * The driver: Python that holds the robot API and runs the program. All
 * values cross between JS and Python as JSON strings, so no Python object
 * (proxy) ever reaches JS, and none needs freeing.
 */
export const PY_DRIVER = String.raw`
import builtins as _builtins, json as _json, math as _math, sys as _sys, traceback as _traceback

_MAX_LINES = ${MAX_LOG_LINES}
_MAX_CHARS = ${MAX_LOG_CHARS}
_st = {"time": 0.0, "sensors": {}, "left": 0.0, "right": 0.0, "logs": [], "partial": "", "loop": None, "started": False}

def _log(line):
    logs = _st["logs"]
    if len(logs) >= _MAX_LINES:
        return
    if len(line) > _MAX_CHARS:
        line = line[: _MAX_CHARS - 1] + "…"
    logs.append(line)

class _Output:
    """sys.stdout / sys.stderr: whole lines go to the panel's output."""
    def write(self, s):
        s = str(s)
        parts = (_st["partial"] + s).split("\n")
        _st["partial"] = parts.pop()
        for p in parts:
            _log(p)
        if len(_st["partial"]) > _MAX_CHARS:
            _log(_st["partial"])
            _st["partial"] = ""
        return len(s)
    def flush(self):
        pass
    def isatty(self):
        return False

_sys.stdout = _Output()
_sys.stderr = _Output()

class RobotUsageError(Exception):
    pass

def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and _math.isfinite(v)

class _Robot:
    """The robot your program drives."""
    __slots__ = ()
    def set_wheels(self, left, right):
        """Wheel speeds from -1 (full reverse) to 1 (full forward)."""
        if not (_is_number(left) and _is_number(right)):
            raise RobotUsageError(
                "robot.set_wheels(left, right) needs two numbers from -1 to 1, like robot.set_wheels(0.5, 0.5). "
                "It got (%r, %r)." % (left, right))
        _st["left"] = max(-1.0, min(1.0, float(left)))
        _st["right"] = max(-1.0, min(1.0, float(right)))
    setWheels = set_wheels
    def read(self, name):
        """A sensor's value, e.g. robot.read("distance")."""
        sensors = _st["sensors"]
        if isinstance(name, str) and name in sensors:
            return sensors[name]
        have = ", ".join('"%s"' % n for n in sensors)
        hint = ("This robot has: %s." % have) if have else "This robot has no sensors (add some in the builder)."
        raise RobotUsageError("There's no sensor called %r. %s" % (name, hint))
    @property
    def time(self):
        """Seconds since the program started."""
        return _st["time"]
    def __repr__(self):
        return "<robot>"

robot = _Robot()

def _error(kind, line, message):
    return {"type": "error", "kind": kind, "line": line, "message": message}

def _user_line(exc):
    line = None
    for frame in _traceback.extract_tb(exc.__traceback__):
        if frame.filename == "${PROGRAM_FILE}":
            line = frame.lineno
    return line

def _describe(exc):
    if isinstance(exc, RobotUsageError):
        return str(exc)
    if isinstance(exc, RecursionError):
        return "A function keeps calling itself without stopping (too much recursion)."
    if isinstance(exc, SystemExit):
        return "The program called exit()."
    text = str(exc)
    return "%s: %s" % (type(exc).__name__, text) if text else type(exc).__name__

def _call(fn):
    try:
        fn()
        return None
    except BaseException as exc:
        return _error("runtime", _user_line(exc), _describe(exc))

def _start(code):
    try:
        compiled = compile(code, "${PROGRAM_FILE}", "exec")
    except SyntaxError as exc:
        line = exc.lineno if isinstance(exc.lineno, int) and exc.lineno > 0 else None
        return _error("syntax", line, "This code can't be read: %s" % (exc.msg or "syntax error"))
    except (ValueError, OverflowError) as exc:
        return _error("syntax", None, "This code can't be read: %s" % exc)
    namespace = {"__name__": "__main__", "__builtins__": _builtins, "robot": robot}
    result = _call(lambda: exec(compiled, namespace))
    if result is None:
        loop = namespace.get("loop")
        _st["loop"] = loop if callable(loop) else None
    return result

def _pai_tick(time, sensors_json, code):
    _st["time"] = time
    _st["sensors"] = _json.loads(sensors_json)
    _st["logs"] = []
    if code is not None:
        result = _start(code)
    elif _st["loop"] is not None:
        result = _call(_st["loop"])
    else:
        result = None
    if _st["partial"]:
        _log(_st["partial"])
        _st["partial"] = ""
    if result is None:
        result = {"type": "cmd", "left": _st["left"], "right": _st["right"]}
    result["logs"] = _st["logs"]
    return _json.dumps(result)
`;

type TickFn = ((time: number, sensorsJson: string, code: string | undefined) => unknown);

export class PythonRunner {
  private readonly tick: TickFn;
  private started = false;
  private failed = false;

  /** Sets up the driver on `py`. One runner per runtime: the driver keeps the program's state there. */
  constructor(py: PythonRuntime) {
    py.runPython(PY_DRIVER);
    this.tick = py.globals.get("_pai_tick") as TickFn;
  }

  /** Run one tick. After an error reply the runner stays failed. */
  handle(msg: TickMessage): Reply {
    if (this.failed) return { type: "error", seq: msg.seq, kind: "runtime", line: null, message: "The program has stopped.", logs: [] };
    // undefined (not null: Pyodide turns null into `jsnull`, not None) after the first tick.
    const code = this.started ? undefined : (msg.code ?? "");
    this.started = true;
    let out: unknown;
    try {
      out = JSON.parse(String(this.tick(msg.time, JSON.stringify(msg.sensors), code)));
    } catch (err) {
      // The driver catches everything the program raises, so this is the runtime itself failing.
      this.failed = true;
      const message = err instanceof Error ? err.message.split("\n").filter(Boolean).pop() ?? err.message : String(err);
      return { type: "error", seq: msg.seq, kind: "runtime", line: null, message: `Python stopped working: ${message}`, logs: [] };
    }
    const reply = { ...(out as Record<string, unknown>), seq: msg.seq } as Reply;
    if (reply.type === "error") this.failed = true;
    return reply;
  }
}
