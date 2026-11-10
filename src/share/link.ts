/**
 * Share links: the whole sim (robot, environment, program) in the URL
 * fragment, `#s=<payload>`. No backend: the link *is* the sim.
 *
 * Payload = one format character + base64url bytes:
 *   "1": deflate-compressed JSON (`CompressionStream("deflate")`)
 *   "0": plain UTF-8 JSON, for browsers without `CompressionStream`
 *
 * Pure logic (no DOM): runs in Node for tests. Decoding accepts anything
 * (a link is untrusted input) and never throws; problems come back as
 * plain-language messages.
 */
import type { Language } from "../control/api";
import type { BlocksJson } from "../control/blocks";
import { ENVIRONMENTS } from "../envs";
import { validateSpec, type RobotSpec } from "../robot/spec";
import { SCENES } from "../scenes";

export const SHARE_VERSION = 1;
/** The fragment key: `#s=…`. */
export const SHARE_PREFIX = "#s=";

/** A controller program as the code panel holds it. */
export interface SharedProgram {
  language: Language;
  code: string;
  /** The Blockly workspace (`BlocksEditor.save()`) when the program was made with blocks. */
  blocks?: BlocksJson;
}

/** What one link describes. */
export interface ShareCore {
  v: typeof SHARE_VERSION;
  /** The builder's robot (with `env`), or… */
  robot?: RobotSpec;
  env?: string;
  /** …a bundled scene id (`src/scenes`). Exactly one of `robot` / `scene`. */
  scene?: string;
  program?: SharedProgram;
}

/** A link: the sim, plus the sim it was remixed from (one level only). */
export interface ShareState extends ShareCore {
  parent?: ShareCore;
}

export type DecodeResult = { ok: true; state: ShareState } | { ok: false; error: string };

/** Longest payload we try to read. Browsers and chat apps cut far shorter links anyway. */
export const MAX_PAYLOAD_CHARS = 200_000;
/** Most JSON a link may expand to (guards against decompression bombs). */
export const MAX_JSON_BYTES = 1_000_000;
/** Longest program a link may carry. */
export const MAX_CODE_CHARS = 200_000;
/** Limits on a link's Blockly workspace, so a crafted one can't hang Blockly. */
export const MAX_BLOCK_NODES = 20_000;
export const MAX_BLOCK_DEPTH = 1_000;
/** Largest number allowed in a block's `extraState` (e.g. an if block's else-if count). */
export const MAX_EXTRA_STATE = 200;

const enc = new TextEncoder();

/** Whether this browser can compress links. */
export function canCompress(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

// ---- base64url -------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Null for anything that isn't base64url. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- compression -------------------------------------------------------------

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array | null> {
  const writer = stream.writable.getWriter();
  // Errors surface through the reader; don't leave this promise unhandled.
  writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// ---- encode ------------------------------------------------------------------

/**
 * The fragment payload for `state` (without the `#s=`). Compressed when the
 * browser can; `compress: false` forces the plain format.
 */
export async function encodeShare(state: ShareState, opts: { compress?: boolean } = {}): Promise<string> {
  const json = enc.encode(JSON.stringify(state));
  if (opts.compress ?? canCompress()) {
    const packed = await pipe(json, new CompressionStream("deflate"), Infinity);
    return "1" + toBase64Url(packed!);
  }
  return "0" + toBase64Url(json);
}

/** A full share URL: `base` (any URL; its fragment is replaced) + `#s=<payload>`. */
export async function shareUrl(base: string, state: ShareState): Promise<string> {
  const url = new URL(base);
  url.hash = "";
  return url.toString().replace(/#$/, "") + SHARE_PREFIX + (await encodeShare(state));
}

// ---- decode ------------------------------------------------------------------

/** The payload in a URL fragment (`#s=…`), or null when the fragment isn't a share link. */
export function payloadFromHash(hash: string): string | null {
  return hash.startsWith(SHARE_PREFIX) ? hash.slice(SHARE_PREFIX.length) : null;
}

const BROKEN = "This link is broken or incomplete. If it was copied from a message, check the whole link was copied.";

/** Read a payload (the part after `#s=`). Never throws. */
export async function decodeShare(payload: string): Promise<DecodeResult> {
  try {
    return await decode(payload);
  } catch {
    return { ok: false, error: BROKEN };
  }
}

async function decode(payload: string): Promise<DecodeResult> {
  if (payload.length > MAX_PAYLOAD_CHARS) return { ok: false, error: "This link is too long to open." };
  const format = payload[0];
  const bytes = fromBase64Url(payload.slice(1));
  if (!bytes || (format !== "0" && format !== "1")) return { ok: false, error: BROKEN };
  let json: Uint8Array | null;
  if (format === "1") {
    if (!canCompress()) {
      return { ok: false, error: "This browser is too old to open compressed links. Try a recent Chrome, Edge, Firefox or Safari." };
    }
    json = await pipe(bytes, new DecompressionStream("deflate"), MAX_JSON_BYTES).catch(() => null);
  } else {
    json = bytes.length <= MAX_JSON_BYTES ? bytes : null;
  }
  if (!json) return { ok: false, error: BROKEN };
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    return { ok: false, error: BROKEN };
  }
  return parseState(data);
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** Check decoded JSON is a share state. Exported for tests. */
export function parseState(data: unknown): DecodeResult {
  const core = parseCore(data);
  if (!core.ok) return core;
  const state: ShareState = core.core;
  const parent = isObject(data) ? own(data, "parent") : undefined;
  if (parent !== undefined) {
    // A broken parent never stops the link itself from opening.
    const p = parseCore(parent);
    if (p.ok) state.parent = p.core;
  }
  return { ok: true, state };
}

function parseCore(data: unknown): { ok: true; core: ShareCore } | { ok: false; error: string } {
  if (!isObject(data)) return { ok: false, error: BROKEN };
  const v = own(data, "v");
  if (v !== SHARE_VERSION) {
    return typeof v === "number" && v > SHARE_VERSION
      ? { ok: false, error: "This link was made by a newer version of PAI Sim. Reload the page to get the latest version." }
      : { ok: false, error: BROKEN };
  }
  const core: ShareCore = { v: SHARE_VERSION };
  const robot = own(data, "robot");
  const scene = own(data, "scene");
  if ((robot === undefined) === (scene === undefined)) return { ok: false, error: BROKEN };
  if (robot !== undefined) {
    const checked = validateSpec(robot);
    if (!checked.ok) return { ok: false, error: `The robot in this link can't be built: ${checked.errors.join(" ")}` };
    const env = own(data, "env");
    if (typeof env !== "string" || !ENVIRONMENTS.some((e) => e.id === env)) {
      return { ok: false, error: `This link uses an environment (${JSON.stringify(env ?? null)}) that doesn't exist.` };
    }
    core.robot = checked.spec;
    core.env = env;
  } else {
    if (typeof scene !== "string" || !SCENES.some((s) => s.id === scene)) {
      return { ok: false, error: `This link uses a scene (${JSON.stringify(scene)}) that doesn't exist.` };
    }
    core.scene = scene;
  }
  const program = own(data, "program");
  if (program !== undefined) {
    if (!isObject(program)) return { ok: false, error: BROKEN };
    const language = own(program, "language");
    const code = own(program, "code");
    const blocks = own(program, "blocks");
    if ((language !== "javascript" && language !== "python") || typeof code !== "string") return { ok: false, error: BROKEN };
    if (code.length > MAX_CODE_CHARS) return { ok: false, error: "The program in this link is too long to open." };
    const p: SharedProgram = { language, code };
    if (blocks !== undefined) {
      if (!isObject(blocks) || language !== "javascript" || !blocksLookSane(blocks)) return { ok: false, error: BROKEN };
      p.blocks = blocks;
    }
    core.program = p;
  }
  return { ok: true, core };
}

/**
 * Structural limits on a Blockly workspace from a link: not too many
 * values, not too deep, and small `extraState` numbers (Blockly builds that
 * many inputs). Blockly itself rejects unknown block types when loading.
 */
export function blocksLookSane(json: unknown): boolean {
  const stack: { x: unknown; depth: number; extra: boolean }[] = [{ x: json, depth: 0, extra: false }];
  let nodes = 0;
  while (stack.length) {
    const { x, depth, extra } = stack.pop()!;
    if (++nodes > MAX_BLOCK_NODES || depth > MAX_BLOCK_DEPTH) return false;
    if (typeof x === "number" && extra && !(Math.abs(x) <= MAX_EXTRA_STATE)) return false;
    if (typeof x === "string" && x.length > 10_000) return false;
    if (Array.isArray(x)) for (const v of x) stack.push({ x: v, depth: depth + 1, extra });
    else if (isObject(x)) for (const [k, v] of Object.entries(x)) stack.push({ x: v, depth: depth + 1, extra: extra || k === "extraState" });
  }
  return true;
}

// ---- helpers -------------------------------------------------------------------

/** `state` without its parent: what a remix stores as its parent. */
export function coreOf(state: ShareState): ShareCore {
  const { parent: _parent, ...core } = state;
  return core;
}

/** Deep equality for plain JSON values. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * The state to share for `core`, opened from link `opened` (or null). An
 * unchanged sim keeps the opened link's parent, so re-sharing it gives the
 * same link; a changed one is a remix of the opened link.
 */
export function remixOf(core: ShareCore, opened: ShareState | null): ShareState {
  if (!opened) return { ...core };
  const openedCore = coreOf(opened);
  if (sameJson(core, openedCore)) return opened.parent ? { ...core, parent: opened.parent } : { ...core };
  return { ...core, parent: openedCore };
}

/**
 * A copy of a Blockly workspace without block ids. Ids are random strings
 * that don't compress; Blockly makes new ones when the blocks are loaded.
 * Only blocks (objects with a `type` and no `name`) lose their id:
 * variables and the fields that refer to them (`{ VAR: { id } }`, sometimes
 * with a name and type) keep theirs.
 */
export function stripBlockIds(json: BlocksJson): BlocksJson {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!isObject(x)) return x;
    const isBlock = typeof x.type === "string" && !("name" in x);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      if (isBlock && k === "id") continue;
      out[k] = k === "variables" ? v : walk(v);
    }
    return out;
  };
  return walk(json) as BlocksJson;
}
