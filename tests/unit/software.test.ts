/** Software-rendered WebGL starts in lite mode (src/render/software.ts). */
import { describe, expect, it } from "vitest";
import { isSoftwareRenderer } from "../../src/render/software";

describe("isSoftwareRenderer", () => {
  it("spots software renderers", () => {
    for (const name of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "Google SwiftShader",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "Mesa softpipe",
      "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)",
    ]) {
      expect(isSoftwareRenderer(name), name).toBe(true);
    }
  });

  it("leaves GPUs and unknown names alone", () => {
    for (const name of [
      "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "Apple GPU",
      "Mali-G78",
      "Adreno (TM) 640",
      "WebKit WebGL",
      "",
      null,
      undefined,
    ]) {
      expect(isSoftwareRenderer(name), String(name)).toBe(false);
    }
  });
});
