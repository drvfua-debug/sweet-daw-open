export type AimixGlowPresetId = "cleanGlow" | "vocalBreath" | "darkGloss" | "aiStemRescue" | "brightButSafe" | "custom";
export type AimixGlowQuality = "preview" | "offlineHighQuality";
export type AimixGlowAudioChannel = Float32Array<ArrayBufferLike>;

export type AimixGlowSettings = {
  enabled: boolean;
  preset: AimixGlowPresetId;
  amount: number;
  vocalKey: number;
  recover: number;
  gloss: number;
  air: number;
  tame: number;
  outputMatch: boolean;
  quality: AimixGlowQuality;
};

export type AimixGlowAnalysis = {
  sampleRate: number;
  durationSec: number;
  inputLufsApprox: number;
  inputTruePeakDb: number;
  vocalAvailable: boolean;
  vocalActivityMean: number;
  vocalActivityFrames: Float32Array;
  sibilanceRisk: number;
  harshnessRisk: number;
  presenceDeficit: number;
  airDeficit: number;
  fakeAirRisk: number;
  midSideHighRisk: number;
  recommendedIntensity: number;
};

export type AimixGlowResult = {
  channels: AimixGlowAudioChannel[];
  before: AimixGlowAnalysis;
  after: AimixGlowAnalysis;
  outputMatchGainDb: number;
  actions: string[];
  warnings: string[];
};

export type AimixGlowPresetDefinition = Omit<AimixGlowSettings, "enabled" | "preset" | "quality"> & {
  label: string;
  description: string;
};
