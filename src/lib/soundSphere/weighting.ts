import type { SourceId, SpherePoint } from "@/types/soundSphere";

export const RAW_SOURCES: Record<SourceId, { name: string; x: number; y: number; z: number }> = {
  string: { name: "String", x: 0, y: 1, z: 0 },
  glass: { name: "Glass", x: 0.707, y: 0.707, z: 0 },
  wood: { name: "Wood", x: 0.707, y: -0.707, z: 0 },
  water: { name: "Water", x: 0, y: -1, z: 0 },
  air: { name: "Air", x: -0.707, y: -0.707, z: 0 },
  stone: { name: "Stone", x: -0.707, y: 0.707, z: 0 },
  electric: { name: "Electric", x: 0, y: 0, z: 1 },
  metal: { name: "Metal", x: 0, y: 0, z: -1 },
  fire: { name: "Fire", x: 1, y: 0, z: 0 },
};

export function calculateSourceWeights(
  point: SpherePoint,
  mutedSources: SourceId[],
  blendPower = 2,
  epsilon = 0.001
): Record<SourceId, number> {
  const result: Record<SourceId, number> = {
    metal: 0,
    fire: 0,
    water: 0,
    glass: 0,
    wood: 0,
    stone: 0,
    electric: 0,
    air: 0,
    string: 0,
  };

  // Clamp coordinates
  const px = Math.max(-1, Math.min(1, point.x));
  const py = Math.max(-1, Math.min(1, point.y));
  const pz = Math.max(-1, Math.min(1, point.z));

  let totalWeight = 0;
  const tempWeights: Record<SourceId, number> = { ...result };
  const sourceIds = Object.keys(RAW_SOURCES) as SourceId[];

  for (const id of sourceIds) {
    if (mutedSources.includes(id)) {
      tempWeights[id] = 0;
      continue;
    }

    const source = RAW_SOURCES[id];
    const dx = source.x - px;
    const dy = source.y - py;
    const dz = source.z - pz;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const w = 1 / (Math.pow(distance, blendPower) + epsilon);
    tempWeights[id] = w;
    totalWeight += w;
  }

  if (totalWeight > 0) {
    for (const id of sourceIds) {
      result[id] = tempWeights[id] / totalWeight;
    }
  } else {
    for (const id of sourceIds) {
      result[id] = 0;
    }
  }

  return result;
}
