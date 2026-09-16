export function clamp(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safe));
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function dbToGain(db: number): number {
  return clamp(10 ** (clamp(db, -120, 24) / 20), 0, 1.5);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-12, Math.abs(Number.isFinite(gain) ? gain : 0)));
}

export function copyChannels(channels: Float32Array[]): Float32Array[] {
  return channels.map((channel) => new Float32Array(channel));
}

export function createSilentLike(channels: Float32Array[]): Float32Array[] {
  return channels.map((channel) => new Float32Array(channel.length));
}

export function sanitizeFloat32(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) <= 1.15) return value;
  const sign = Math.sign(value);
  const excess = Math.abs(value) - 1.15;
  return sign * (1.15 + Math.tanh(excess) * 0.1);
}

export function secondsToSample(sec: number, sampleRate: number, length: number): number {
  return Math.round(clamp(sec, 0, Math.max(0, length / Math.max(1, sampleRate))) * Math.max(1, sampleRate));
}

export function applyEqualPowerFade(value: number): number {
  const t = clamp(value, 0, 1);
  return Math.sin(t * Math.PI * 0.5);
}

export function rmsOfChannel(channel: Float32Array, start = 0, end = channel.length): number {
  const safeStart = clamp(Math.floor(start), 0, channel.length);
  const safeEnd = clamp(Math.ceil(end), safeStart, channel.length);
  let sum = 0;
  for (let index = safeStart; index < safeEnd; index += 1) {
    const sample = sanitizeFloat32(channel[index] ?? 0);
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, safeEnd - safeStart));
}

export function rmsOfChannels(channels: Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = sanitizeFloat32(channel[index] ?? 0);
      sum += sample * sample;
      count += 1;
    }
  }
  return Math.sqrt(sum / Math.max(1, count));
}