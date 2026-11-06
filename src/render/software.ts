/**
 * Is the browser drawing WebGL in software (no GPU)? Then it's a slow
 * device for our purposes, and the renderer starts in lite mode right away
 * instead of waiting a few seconds to measure the frame rate. Pure logic.
 */
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

export function isSoftwareRenderer(name: string | null | undefined): boolean {
  return !!name && SOFTWARE_RENDERERS.test(name);
}
