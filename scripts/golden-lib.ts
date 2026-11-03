import { loadEngine } from "../src/physics/engine";
import { TEMPLATES } from "../src/robot/templates";
import { SAMPLE_EVERY, SCRIPT, trajectory, type Sample } from "../tests/golden/trajectory";

export async function generate(): Promise<{ script: typeof SCRIPT; sampleEvery: number; templates: Record<string, Sample[]> }> {
  const mj = await loadEngine();
  const templates: Record<string, Sample[]> = {};
  for (const t of TEMPLATES) templates[t.id] = trajectory(mj, t.spec);
  return { script: SCRIPT, sampleEvery: SAMPLE_EVERY, templates };
}
