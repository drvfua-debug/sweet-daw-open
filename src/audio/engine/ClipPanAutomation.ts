import type { Clip, PanAnchorPoint } from "@/daw/model/Project";

export type ClipPanAutomationNode = {
  input: AudioNode;
  output: AudioNode;
};

export function createClipPanAutomationNode(
  context: BaseAudioContext,
  clip: Clip,
  contextStartSec: number,
  clipOffsetSec: number,
  durationSec: number,
): ClipPanAutomationNode | null {
  const automation = clip.panAutomation;
  if (!automation?.enabled || automation.bypassed || automation.anchorPoints.length === 0 || !("createStereoPanner" in context)) {
    return null;
  }

  const panner = context.createStereoPanner();
  const points = automation.anchorPoints
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.pan))
    .sort((a, b) => a.time - b.time);
  if (points.length === 0) return null;

  const depth = clamp(automation.depth, 0, 1);
  const startPan = applyDepth(getPanAtTime(points, clipOffsetSec), depth);
  const endClipTime = clipOffsetSec + durationSec;
  panner.pan.cancelScheduledValues(contextStartSec);
  panner.pan.setValueAtTime(startPan, contextStartSec);

  let lastPan = startPan;
  for (const point of points) {
    if (point.time <= clipOffsetSec || point.time >= endClipTime) continue;
    const pan = applyDepth(point.pan, depth);
    const time = contextStartSec + (point.time - clipOffsetSec);
    if (point.curve === "hold") {
      panner.pan.setValueAtTime(pan, time);
    } else if (point.curve === "smooth" || point.curve === "easeInOut") {
      panner.pan.setTargetAtTime(pan, time, Math.max(0.005, automation.smoothingMs / 1000));
    } else {
      panner.pan.linearRampToValueAtTime(pan, time);
    }
    lastPan = pan;
  }

  const endPan = applyDepth(getPanAtTime(points, endClipTime), depth);
  if (Math.abs(endPan - lastPan) > 0.001) {
    panner.pan.linearRampToValueAtTime(endPan, contextStartSec + durationSec);
  }

  return {
    input: panner,
    output: panner,
  };
}

export function getPanAtTime(points: PanAnchorPoint[], clipTimeSec: number) {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const first = sorted[0];
  if (!first || clipTimeSec <= first.time) return first?.pan ?? 0;

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    if (!previous || !next) continue;
    if (clipTimeSec <= next.time) {
      if (previous.curve === "hold") return previous.pan;
      const span = Math.max(0.0001, next.time - previous.time);
      const t = clamp((clipTimeSec - previous.time) / span, 0, 1);
      const shaped = next.curve === "easeInOut" || next.curve === "smooth" ? t * t * (3 - 2 * t) : t;
      return previous.pan + (next.pan - previous.pan) * shaped;
    }
  }

  return sorted[sorted.length - 1]?.pan ?? 0;
}

function applyDepth(pan: number, depth: number) {
  return clamp(pan * depth, -1, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, min), max);
}
