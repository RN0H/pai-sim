/**
 * M6: share links. Round trips (serialize → parse → deep equal), unicode
 * code, remix parents, link length for typical robots, and malformed links
 * that must give a friendly error rather than throw.
 */
import { describe, expect, it } from "vitest";
import {
  blocksLookSane,
  canCompress,
  coreOf,
  decodeShare,
  encodeShare,
  fromBase64Url,
  MAX_JSON_BYTES,
  payloadFromHash,
  remixOf,
  shareUrl,
  stripBlockIds,
  toBase64Url,
  type ShareState,
} from "../../src/share/link";
import { templateSpec } from "../../src/robot/templates";
import { EXAMPLES } from "../../src/control/examples";
import { BLOCK_EXAMPLES, blocksToCode } from "../../src/control/blocks";
import { ENVIRONMENTS } from "../../src/envs";

const SITE = "https://rn0h.github.io/pai-sim/";
const example = (id: string) => EXAMPLES.find((e) => e.id === id)!;

function robotState(): ShareState {
  return {
    v: 1,
    robot: { ...templateSpec("sensor-bot"), color: "#3366cc" },
    env: "maze",
    program: { language: "javascript", code: example("avoid").code },
  };
}

async function roundTrip(state: ShareState, compress?: boolean): Promise<ShareState> {
  const payload = await encodeShare(state, compress === undefined ? {} : { compress });
  const back = await decodeShare(payload);
  if (!back.ok) throw new Error(back.error);
  return back.state;
}

describe("share link round trip", () => {
  it("Node has CompressionStream (links are compressed)", () => {
    expect(canCompress()).toBe(true);
  });

  it("robot + environment + program", async () => {
    const s = robotState();
    expect(await roundTrip(s)).toEqual(s);
    expect(await roundTrip(s, false)).toEqual(s);
  });

  it("every template in every environment, in both languages", async () => {
    for (const t of ["scout", "hauler", "sensor-bot"]) {
      for (const env of ENVIRONMENTS) {
        for (const language of ["javascript", "python"] as const) {
          const ex = example("square");
          const s: ShareState = { v: 1, robot: templateSpec(t), env: env.id, program: { language, code: language === "python" ? ex.python : ex.code } };
          expect(await roundTrip(s)).toEqual(s);
        }
      }
    }
  });

  it("unicode in the code and the robot's name survives exactly", async () => {
    const code = `// 你好, robot! 🤖 émoji — "quotes" \\ backslash\n# ünïcödé\nconsole.log("🚀 ${"\u{1F600}"}   \t tab");\nfunction loop() { robot.setWheels(0.5, 0.5); }\n`;
    const s: ShareState = { v: 1, robot: { ...templateSpec("scout"), name: "Robo 🤖 Ünï" }, env: "line", program: { language: "javascript", code } };
    const back = await roundTrip(s);
    expect(back).toEqual(s);
    expect(back.program!.code).toBe(code);
    expect(await roundTrip(s, false)).toEqual(s);
  });

  it("a bundled scene with a Python program", async () => {
    const s: ShareState = { v: 1, scene: "sensors", program: { language: "python", code: example("follow").python } };
    expect(await roundTrip(s)).toEqual(s);
  });

  it("a scene with no program", async () => {
    const s: ShareState = { v: 1, scene: "arm" };
    expect(await roundTrip(s)).toEqual(s);
  });

  it("blocks workspaces and a remix parent", async () => {
    const blocks = stripBlockIds(BLOCK_EXAMPLES.square!);
    const parent = robotState();
    const s: ShareState = {
      v: 1,
      robot: templateSpec("hauler"),
      env: "sumo",
      program: { language: "javascript", code: blocksToCode(blocks), blocks },
      parent: coreOf(parent),
    };
    expect(await roundTrip(s)).toEqual(s);
  });

  it("the payload is URL-safe (no escaping needed in a fragment)", async () => {
    const payload = await encodeShare(robotState());
    expect(payload).toMatch(/^1[A-Za-z0-9_-]+$/);
    const url = await shareUrl(`${SITE}?env=maze#old`, robotState());
    expect(url.startsWith(`${SITE}?env=maze#s=1`)).toBe(true);
    expect(payloadFromHash(new URL(url).hash)).toBe(payload);
    expect(payloadFromHash("#other")).toBeNull();
  });

  it("base64url handles every byte value", () => {
    const bytes = new Uint8Array(256 * 3).map((_, i) => i % 256);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    for (let n = 0; n < 8; n++) expect(fromBase64Url(toBase64Url(bytes.subarray(0, n)))).toEqual(bytes.subarray(0, n));
  });
});

describe("link length", () => {
  it("typical robots stay under ~2,000 characters", async () => {
    for (const ex of EXAMPLES) {
      for (const language of ["javascript", "python"] as const) {
        const s: ShareState = { v: 1, robot: templateSpec("sensor-bot"), env: "line", program: { language, code: language === "python" ? ex.python : ex.code } };
        const url = await shareUrl(SITE, s);
        expect(url.length, `${ex.id} (${language})`).toBeLessThan(2000);
        // A remix of a typical robot (with its parent) fits too.
        const remix = remixOf({ ...coreOf(s), robot: templateSpec("scout") }, s);
        expect(remix.parent).toBeDefined();
        expect((await shareUrl(SITE, remix)).length, `${ex.id} remix (${language})`).toBeLessThan(2000);
      }
    }
  });

  it("block programs (without block ids) stay under ~2,000 characters", async () => {
    for (const [id, json] of Object.entries(BLOCK_EXAMPLES)) {
      const blocks = stripBlockIds(json);
      const s: ShareState = { v: 1, robot: templateSpec("sensor-bot"), env: "line", program: { language: "javascript", code: blocksToCode(blocks), blocks } };
      expect((await shareUrl(SITE, s)).length, id).toBeLessThan(2000);
    }
  });
});

describe("stripBlockIds", () => {
  it("drops block ids but keeps variable ids, so the program is the same", () => {
    const withIds = {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: "robot_every_tick", id: "abc", x: 1, y: 2, inputs: { DO: { block: { type: "variables_set", id: "q", fields: { VAR: { id: "v1" } } } } } }],
      },
      variables: [{ name: "speed", id: "v1" }],
    };
    const out = stripBlockIds(withIds) as typeof withIds;
    expect(JSON.stringify(out)).not.toContain('"abc"');
    expect(JSON.stringify(out)).not.toContain('"q"');
    expect(out.variables).toEqual([{ name: "speed", id: "v1" }]);
    expect(out.blocks.blocks[0]!.inputs.DO.block.fields.VAR).toEqual({ id: "v1" });
    // A variable field saved with its name and type keeps its id too.
    const field = { blocks: { blocks: [{ type: "variables_get", id: "b", fields: { VAR: { id: "v2", name: "x", type: "" } } }] } };
    expect(stripBlockIds(field)).toEqual({ blocks: { blocks: [{ type: "variables_get", fields: { VAR: { id: "v2", name: "x", type: "" } } }] } });
    for (const json of Object.values(BLOCK_EXAMPLES)) expect(blocksToCode(stripBlockIds(json))).toBe(blocksToCode(json));
  });
});

describe("remixOf", () => {
  it("a fresh sim has no parent", () => {
    expect(remixOf(coreOf(robotState()), null).parent).toBeUndefined();
  });

  it("an unchanged sim keeps the link it was opened from (and its parent)", () => {
    const opened = { ...robotState(), parent: { v: 1 as const, scene: "hello" } };
    expect(remixOf(coreOf(opened), opened)).toEqual(opened);
  });

  it("a changed sim records the opened link (without its own parent) as the parent", () => {
    const opened = { ...robotState(), parent: { v: 1 as const, scene: "hello" } };
    const changed = { ...coreOf(opened), program: { language: "javascript" as const, code: "// mine" } };
    const remix = remixOf(changed, opened);
    expect(remix.parent).toEqual(coreOf(opened));
    expect(remix.parent).not.toHaveProperty("parent");
  });
});

describe("malformed links give a friendly error, never throw", () => {
  async function fails(payload: string): Promise<string> {
    const r = await decodeShare(payload);
    expect(r.ok, payload.slice(0, 40)).toBe(false);
    return r.ok ? "" : r.error;
  }
  const plain = (x: unknown) => "0" + toBase64Url(new TextEncoder().encode(JSON.stringify(x)));
  const deflated = async (bytes: Uint8Array) => {
    const cs = new CompressionStream("deflate");
    const out = new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(cs));
    return "1" + toBase64Url(new Uint8Array(await out.arrayBuffer()));
  };

  it("garbage, empty, unknown format, bad base64", async () => {
    for (const p of ["", "1", "x", "2abcd", "1!!!!", "1a", "0%%%", "1" + "A".repeat(50)]) {
      expect(await fails(p)).toMatch(/broken|incomplete/);
    }
  });

  it("a link cut short", async () => {
    const payload = await encodeShare(robotState());
    for (const n of [5, Math.floor(payload.length / 2), payload.length - 3]) {
      expect(await fails(payload.slice(0, n))).toMatch(/broken|incomplete/);
    }
  });

  it("a link with characters changed in the middle", async () => {
    const payload = await encodeShare(robotState());
    const mid = Math.floor(payload.length / 2);
    const flipped = payload.slice(0, mid) + (payload[mid] === "A" ? "B" : "A") + payload.slice(mid + 1);
    // Deflate's checksum catches it.
    expect(await fails(flipped)).toMatch(/broken|incomplete/);
  });

  it("valid compression of something that isn't JSON or UTF-8", async () => {
    expect(await fails(await deflated(new TextEncoder().encode("not json {")))).toMatch(/broken/);
    expect(await fails(await deflated(new Uint8Array([0xff, 0xfe, 0x00])))).toMatch(/broken/);
  });

  it("JSON of the wrong shape", async () => {
    for (const x of [null, 42, "s", [], {}, { v: 1 }, { v: 1, robot: templateSpec("scout"), env: "maze", scene: "arm" }]) {
      expect(await fails(plain(x))).toMatch(/broken/);
    }
    expect(await fails(plain({ v: 1, scene: "arm", program: { language: "ruby", code: "" } }))).toMatch(/broken/);
    expect(await fails(plain({ v: 1, scene: "arm", program: { language: "javascript", code: 5 } }))).toMatch(/broken/);
    expect(await fails(plain({ v: 1, scene: "arm", program: { language: "python", code: "", blocks: {} } }))).toMatch(/broken/);
    expect(await fails(plain({ v: 1, scene: "arm", program: "x" }))).toMatch(/broken/);
  });

  it("a robot that can't be built says why", async () => {
    const err = await fails(plain({ v: 1, robot: { ...templateSpec("scout"), chassis: "huge" }, env: "maze" }));
    expect(err).toMatch(/robot in this link can't be built/);
    expect(err).toMatch(/no chassis called "huge"/);
  });

  it("unknown environment or scene", async () => {
    expect(await fails(plain({ v: 1, robot: templateSpec("scout"), env: "moon" }))).toMatch(/environment \("moon"\)/);
    expect(await fails(plain({ v: 1, robot: templateSpec("scout") }))).toMatch(/environment/);
    expect(await fails(plain({ v: 1, scene: "nope" }))).toMatch(/scene \("nope"\)/);
  });

  it("blocks that could hang Blockly are refused", async () => {
    const withBlocks = (blocks: unknown) => encodeShare({ v: 1, scene: "arm", program: { language: "javascript", code: "", blocks } } as ShareState);
    // A huge else-if count would make Blockly build millions of inputs.
    const ifBlock = { blocks: { languageVersion: 0, blocks: [{ type: "controls_if", extraState: { elseIfCount: 1e8 } }] } };
    expect(await fails(await withBlocks(ifBlock))).toMatch(/broken/);
    // Very deep nesting.
    let deep: Record<string, unknown> = { type: "robot_stop" };
    for (let i = 0; i < 2000; i++) deep = { type: "robot_stop", next: { block: deep } };
    expect(await fails(await withBlocks({ blocks: { languageVersion: 0, blocks: [deep] } }))).toMatch(/broken/);
    // Too many blocks.
    const many = Array.from({ length: 30_000 }, () => ({ type: "robot_stop" }));
    expect(await fails(await withBlocks({ blocks: { languageVersion: 0, blocks: many } }))).toMatch(/broken/);
    // Ordinary programs are fine.
    for (const json of Object.values(BLOCK_EXAMPLES)) expect(blocksLookSane(json)).toBe(true);
    const ok = await decodeShare(await withBlocks({ blocks: { languageVersion: 0, blocks: [{ type: "controls_if", extraState: { elseIfCount: 3, hasElse: true } }] } }));
    expect(ok.ok).toBe(true);
  });

  it("a link from a newer version asks to reload", async () => {
    expect(await fails(plain({ v: 99, scene: "arm" }))).toMatch(/newer version/);
  });

  it("a broken parent is dropped; the link still opens", async () => {
    const r = await decodeShare(plain({ v: 1, scene: "arm", parent: { v: 1, scene: "nope" } }));
    expect(r).toEqual({ ok: true, state: { v: 1, scene: "arm" } });
  });

  it("extra fields are ignored", async () => {
    const r = await decodeShare(plain({ v: 1, scene: "arm", junk: 1, __proto__x: 2 }));
    expect(r).toEqual({ ok: true, state: { v: 1, scene: "arm" } });
  });

  it("a decompression bomb is refused", async () => {
    const big = new TextEncoder().encode(JSON.stringify({ v: 1, scene: "arm", pad: " ".repeat(MAX_JSON_BYTES + 10) }));
    const payload = await deflated(big);
    expect(payload.length).toBeLessThan(5000);
    expect(await fails(payload)).toMatch(/broken/);
  });

  it("a payload that's far too long", async () => {
    expect(await fails("1" + "A".repeat(300_000))).toMatch(/too long/);
  });
});
