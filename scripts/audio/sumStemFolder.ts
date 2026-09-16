import fs from "node:fs";
import path from "node:path";
import { calculateWavMetrics, readWavFile, writeWavPcm16, type WavAudioData } from "./wavMetrics.ts";

type Args = {
  stems: string;
  output: string;
  gainDb: number;
};

const args = parseArgs(process.argv.slice(2));
const stemFiles = listStemFiles(args.stems);
if (stemFiles.length === 0) {
  throw new Error(`No WAV stems found: ${args.stems}`);
}

const summed = sumStemFiles(stemFiles, args.gainDb);
writeWavPcm16(args.output, summed);
const metrics = calculateWavMetrics(summed, args.output);
console.log(JSON.stringify({
  stems: stemFiles.map((filePath) => path.basename(filePath)),
  output: path.resolve(args.output),
  gainDb: args.gainDb,
  metrics: {
    durationSec: metrics.durationSec,
    sampleRate: metrics.sampleRate,
    samplePeakDb: metrics.samplePeakDb,
    truePeakApproxDb: metrics.truePeakApproxDb,
    integratedLufsApprox: metrics.integratedLufsApprox,
    crestDb: metrics.crestDb,
    sideMidDb: metrics.sideMidDb,
    bandEnergyDb: metrics.bandEnergyDb,
    bandSideMidDb: metrics.bandSideMidDb,
  },
}, null, 2));

function sumStemFiles(stemFiles: string[], gainDb: number): WavAudioData {
  const decoded = stemFiles.map((filePath) => ({ filePath, audio: readWavFile(filePath) }));
  const sampleRate = decoded[0]!.audio.sampleRate;
  const length = Math.max(...decoded.map(({ audio }) => audio.channels[0]?.length ?? 0));
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const gain = 10 ** (gainDb / 20);

  for (const { filePath, audio } of decoded) {
    if (audio.sampleRate !== sampleRate) {
      throw new Error(`Sample-rate mismatch: ${path.basename(filePath)} is ${audio.sampleRate}, expected ${sampleRate}`);
    }
    const sourceLeft = audio.channels[0] ?? new Float32Array(0);
    const sourceRight = audio.channels[1] ?? sourceLeft;
    for (let index = 0; index < length; index += 1) {
      left[index] += (sourceLeft[index] ?? 0) * gain;
      right[index] += (sourceRight[index] ?? sourceLeft[index] ?? 0) * gain;
    }
  }

  return {
    sampleRate,
    channels: [left, right],
    durationSec: length / sampleRate,
  };
}

function listStemFiles(directory: string) {
  return fs.readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith(".wav") && !name.startsWith("._"))
    .sort((a, b) => getLeadingNumber(a) - getLeadingNumber(b) || a.localeCompare(b))
    .map((name) => path.join(directory, name));
}

function getLeadingNumber(name: string) {
  const match = name.match(/^\D*(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function parseArgs(argv: string[]): Args {
  const parsed: Partial<Args> = { gainDb: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--stems" && value) {
      parsed.stems = value;
      index += 1;
    } else if (arg === "--output" && value) {
      parsed.output = value;
      index += 1;
    } else if (arg === "--gain-db" && value) {
      parsed.gainDb = Number(value);
      index += 1;
    }
  }
  if (!parsed.stems || !parsed.output) {
    throw new Error("Usage: vite-node scripts/audio/sumStemFolder.ts --stems <stem-dir> --output <sum.wav> [--gain-db -6]");
  }
  return {
    stems: parsed.stems,
    output: parsed.output,
    gainDb: Number.isFinite(parsed.gainDb) ? Number(parsed.gainDb) : 0,
  };
}
