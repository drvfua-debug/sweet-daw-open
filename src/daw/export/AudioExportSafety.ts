export type AudioExportSafetyReport = {
  ceilingDb: number;
  peakDbBefore: number;
  peakDbAfter: number;
  rmsDbBefore: number;
  rmsDbAfter: number;
  appliedGainDb: number;
  invalidSampleCount: number;
  samplesAboveCeilingBefore: number;
  hardClipRiskSamplesBefore: number;
  action: "none" | "sanitized" | "attenuated" | "sanitized_and_attenuated";
};

export function applyDownOnlyPeakSafetyToAudioBuffer(buffer: AudioBuffer, ceilingDb: number): AudioExportSafetyReport {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  return applyDownOnlyPeakSafetyToChannels(channels, ceilingDb);
}

export function applyDownOnlyPeakSafetyToChannels(channels: Float32Array[], ceilingDb: number): AudioExportSafetyReport {
  const ceiling = dbToGain(ceilingDb);
  const before = scanChannels(channels, ceiling, true);
  const gain = before.peak > ceiling && before.peak > 0 ? ceiling / before.peak : 1;

  if (gain < 0.999999) {
    for (const channel of channels) {
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = (channel[index] ?? 0) * gain;
      }
    }
  }

  const after = scanChannels(channels, ceiling, false);
  const sanitized = before.invalidSampleCount > 0;
  const attenuated = gain < 0.999999;

  return {
    ceilingDb,
    peakDbBefore: linearToDb(before.peak),
    peakDbAfter: linearToDb(after.peak),
    rmsDbBefore: linearToDb(before.rms),
    rmsDbAfter: linearToDb(after.rms),
    appliedGainDb: attenuated ? linearToDb(gain) : 0,
    invalidSampleCount: before.invalidSampleCount,
    samplesAboveCeilingBefore: before.samplesAboveCeiling,
    hardClipRiskSamplesBefore: before.hardClipRiskSamples,
    action: sanitized && attenuated ? "sanitized_and_attenuated" : sanitized ? "sanitized" : attenuated ? "attenuated" : "none",
  };
}

function scanChannels(channels: Float32Array[], ceiling: number, sanitizeInvalid: boolean) {
  let peak = 0;
  let squareSum = 0;
  let sampleCount = 0;
  let invalidSampleCount = 0;
  let samplesAboveCeiling = 0;
  let hardClipRiskSamples = 0;

  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      let sample = channel[index] ?? 0;
      if (!Number.isFinite(sample)) {
        invalidSampleCount += 1;
        sample = 0;
        if (sanitizeInvalid) channel[index] = 0;
      }

      const abs = Math.abs(sample);
      peak = Math.max(peak, abs);
      squareSum += sample * sample;
      sampleCount += 1;
      if (abs > ceiling) samplesAboveCeiling += 1;
      if (abs >= 0.999) hardClipRiskSamples += 1;
    }
  }

  return {
    peak,
    rms: sampleCount > 0 ? Math.sqrt(squareSum / sampleCount) : 0,
    invalidSampleCount,
    samplesAboveCeiling,
    hardClipRiskSamples,
  };
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function linearToDb(value: number) {
  if (value <= 0 || !Number.isFinite(value)) return -120;
  return Math.round(20 * Math.log10(value) * 100) / 100;
}
