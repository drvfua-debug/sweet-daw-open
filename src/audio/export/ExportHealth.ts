export type ExportHealthReport = {
  peakDb: number;
  rmsDb: number;
  clippedSamples: number;
  nearClipSamples: number;
  nanSamples: number;
  infSamples: number;
  silent: boolean;
  silentChunks?: number;
  maxConsecutiveSilentChunks?: number;
};

export type ExportHealthAccumulator = {
  add: (channels: Float32Array[]) => void;
  finish: () => ExportHealthReport;
};

export function analyzeAndSanitizeExportChannels(channels: Float32Array[]): ExportHealthReport {
  const accumulator = createExportHealthAccumulator();
  accumulator.add(channels);
  return accumulator.finish();
}

export function createExportHealthAccumulator(): ExportHealthAccumulator {
  let peak = 0;
  let squareSum = 0;
  let sampleTotal = 0;
  let clippedSamples = 0;
  let nearClipSamples = 0;
  let nanSamples = 0;
  let infSamples = 0;
  let silentChunkRun = 0;
  let silentChunks = 0;
  let maxConsecutiveSilentChunks = 0;

  return {
    add(channels) {
      let chunkPeak = 0;
      for (const channel of channels) {
        for (let index = 0; index < channel.length; index += 1) {
          const sample = channel[index] ?? 0;
          let safeSample = sample;
          if (Number.isNaN(sample)) {
            nanSamples += 1;
            safeSample = 0;
          } else if (!Number.isFinite(sample)) {
            infSamples += 1;
            safeSample = 0;
          }
          if (safeSample !== sample) channel[index] = safeSample;
          const abs = Math.abs(safeSample);
          if (abs >= 1) clippedSamples += 1;
          if (abs >= 0.98) nearClipSamples += 1;
          peak = Math.max(peak, abs);
          chunkPeak = Math.max(chunkPeak, abs);
          squareSum += safeSample * safeSample;
          sampleTotal += 1;
        }
      }
      if (chunkPeak <= 1e-6) {
        silentChunks += 1;
        silentChunkRun += 1;
        maxConsecutiveSilentChunks = Math.max(maxConsecutiveSilentChunks, silentChunkRun);
      } else {
        silentChunkRun = 0;
      }
    },
    finish() {
      const rms = sampleTotal > 0 ? Math.sqrt(squareSum / sampleTotal) : 0;
      return {
        peakDb: round2(gainToDb(peak)),
        rmsDb: round2(gainToDb(rms)),
        clippedSamples,
        nearClipSamples,
        nanSamples,
        infSamples,
        silent: peak <= 1e-6,
        silentChunks,
        maxConsecutiveSilentChunks,
      };
    },
  };
}


export function formatExportHealthWarnings(report: ExportHealthReport) {
  const warnings: string[] = [];
  if (report.nanSamples > 0 || report.infSamples > 0) {
    warnings.push(`Export health repaired invalid samples: NaN ${report.nanSamples}, Infinity ${report.infSamples}.`);
  }
  if (report.clippedSamples > 0) {
    warnings.push(`Export health detected ${report.clippedSamples} clipped sample(s).`);
  } else if (report.nearClipSamples > 0) {
    warnings.push(`Export health detected ${report.nearClipSamples} near-clip sample(s).`);
  }
  if (report.silent) {
    warnings.push("Export health detected a silent render.");
  } else if ((report.maxConsecutiveSilentChunks ?? 0) >= 3) {
    warnings.push(`Export health detected ${report.maxConsecutiveSilentChunks} consecutive silent chunk(s).`);
  }
  return warnings;
}

function gainToDb(value: number) {
  return value <= 0 ? -120 : 20 * Math.log10(value);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
