import type { SweetChunkPlan } from "./processingTypes";

export type CreateChunkPlanArgs = {
  sampleRate: number;
  totalFrames: number;
  preferredChunkSeconds?: number;
  overlapSeconds?: number;
  maxChunks?: number;
};

const MOBILE_MIN_CHUNK_SEC = 0.5;
const MOBILE_MAX_CHUNK_SEC = 2;
const DESKTOP_MIN_CHUNK_SEC = 2;
const DESKTOP_MAX_CHUNK_SEC = 8;

export function createChunkPlan(args: CreateChunkPlanArgs): SweetChunkPlan {
  const sampleRate = Math.max(1, Math.round(finiteOr(args.sampleRate, 44100)));
  const totalFrames = Math.max(0, Math.round(finiteOr(args.totalFrames, 0)));
  const mobile = isLikelyMobileRuntime();
  const minChunkSec = mobile ? MOBILE_MIN_CHUNK_SEC : DESKTOP_MIN_CHUNK_SEC;
  const maxChunkSec = mobile ? MOBILE_MAX_CHUNK_SEC : DESKTOP_MAX_CHUNK_SEC;
  const defaultChunkSec = mobile ? 1 : 4;
  const preferredChunkSeconds = clamp(finiteOr(args.preferredChunkSeconds, defaultChunkSec), minChunkSec, maxChunkSec);
  const maxChunks = Math.max(1, Math.floor(finiteOr(args.maxChunks, Number.POSITIVE_INFINITY)));
  let chunkFrames = Math.max(1, Math.round(preferredChunkSeconds * sampleRate));
  if (Number.isFinite(maxChunks) && totalFrames > 0 && Math.ceil(totalFrames / chunkFrames) > maxChunks) {
    chunkFrames = Math.max(chunkFrames, Math.ceil(totalFrames / maxChunks));
  }
  const overlapFrames = Math.min(Math.max(0, Math.round(finiteOr(args.overlapSeconds, 0) * sampleRate)), Math.max(0, chunkFrames - 1));

  const chunks = [];
  for (let startFrame = 0, index = 0; startFrame < totalFrames; startFrame += chunkFrames, index += 1) {
    const endFrame = Math.min(totalFrames, startFrame + chunkFrames);
    chunks.push({
      index,
      startFrame,
      endFrame,
      readStartFrame: Math.max(0, startFrame - overlapFrames),
      readEndFrame: Math.min(totalFrames, endFrame + overlapFrames),
    });
  }

  return { sampleRate, totalFrames, chunkFrames, overlapFrames, chunks };
}

export function estimateChunkSeconds(plan: SweetChunkPlan): number {
  return plan.chunkFrames / Math.max(1, plan.sampleRate);
}

function isLikelyMobileRuntime() {
  const navigatorLike = typeof navigator !== "undefined" ? navigator : undefined;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigatorLike?.userAgent ?? "");
}

function finiteOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}