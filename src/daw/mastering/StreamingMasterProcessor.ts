export const STREAMING_MASTER_PRE_ROLL_SEC = 0.75;
export const STREAMING_MASTER_POST_ROLL_SEC = 0.15;

export type StreamingMasterChunkWindow = {
  cropStartFrame: number;
  cropFrameCount: number;
};

export type StreamingMasterChunkJoiner = {
  add: (channels: Float32Array[], window: StreamingMasterChunkWindow) => Float32Array[];
  flush: () => Float32Array[];
};

export function cropStreamingMasterChunk(channels: Float32Array[], window: StreamingMasterChunkWindow) {
  const startFrame = Math.max(0, Math.floor(window.cropStartFrame));
  const frameCount = Math.max(1, Math.floor(window.cropFrameCount));
  return channels.map((channel) => {
    const output = new Float32Array(frameCount);
    output.set(channel.subarray(startFrame, startFrame + frameCount));
    return output;
  });
}

export function createStreamingMasterChunkJoiner(options: {
  sampleRate: number;
  crossfadeSec?: number;
}): StreamingMasterChunkJoiner {
  const crossfadeFrames = Math.max(16, Math.floor(options.sampleRate * (options.crossfadeSec ?? 0.012)));
  let pendingTail: Float32Array[] | null = null;

  return {
    add(channels, window) {
      const stable = cropStreamingMasterChunk(channels, window);
      const stableFrames = stable[0]?.length ?? 0;
      const heldFrames = Math.min(crossfadeFrames, stableFrames);
      const bodyFrames = Math.max(0, stableFrames - heldFrames);
      const body = stable.map((channel) => channel.slice(0, bodyFrames));
      const nextTail = stable.map((channel) => channel.slice(bodyFrames));

      if (pendingTail == null) {
        pendingTail = nextTail;
        return body;
      }

      const channelCount = Math.max(pendingTail.length, body.length, channels.length);
      const overlapFrames = Math.min(
        crossfadeFrames,
        Math.max(0, Math.floor(window.cropStartFrame)),
        pendingTail[0]?.length ?? 0,
      );
      const pendingFrames = pendingTail[0]?.length ?? 0;
      const pendingPrefixFrames = Math.max(0, pendingFrames - overlapFrames);
      const outputFrames = pendingFrames + bodyFrames;
      const output = Array.from({ length: channelCount }, (_, channelIndex) => {
        const destination = new Float32Array(outputFrames);
        const previous = pendingTail?.[channelIndex] ?? pendingTail?.[0] ?? new Float32Array();
        const currentProcessed = channels[channelIndex] ?? channels[0] ?? new Float32Array();
        const currentBody = body[channelIndex] ?? body[0] ?? new Float32Array();
        destination.set(previous.subarray(0, pendingPrefixFrames), 0);

        const currentOverlapStart = Math.max(0, Math.floor(window.cropStartFrame) - overlapFrames);
        for (let index = 0; index < overlapFrames; index += 1) {
          const mix = overlapFrames <= 1 ? 0.5 : index / (overlapFrames - 1);
          const previousSample = previous[pendingPrefixFrames + index] ?? 0;
          const currentSample = currentProcessed[currentOverlapStart + index] ?? previousSample;
          destination[pendingPrefixFrames + index] = previousSample + (currentSample - previousSample) * mix;
        }
        destination.set(currentBody, pendingFrames);
        return destination;
      });
      pendingTail = nextTail;
      return output;
    },
    flush() {
      const output = pendingTail ?? [];
      pendingTail = null;
      return output;
    },
  };
}
