import { describe, expect, it } from "vitest";
import { createEmptyProject, createTrack, type Project, type Track } from "../model/Project";
import { computeAiMix } from "./aiMixAssistant";
import { MAGIC_POLISH_MODE_SETTINGS } from "./aiMixPresets";

function makeProjectWithTracks(tracks: Track[]): Project {
  return {
    ...createEmptyProject(),
    tracks,
  };
}

describe("AIMIX polish", () => {
  it("labels the strongest Magic Polish mode as Dense, not Loud", () => {
    expect(MAGIC_POLISH_MODE_SETTINGS.loud.label).toBe("Dense");
    expect(MAGIC_POLISH_MODE_SETTINGS.loud.limiterPushDb).toBeLessThanOrEqual(0.62);
  });

  it("keeps lead vocal clear and forward instead of overly rounded", () => {
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const project = makeProjectWithTracks([vocal]);

    const result = computeAiMix(project, "magic-pro-polish", "medium", "spotify", "pop", "balanced");
    const mixedVocal = result.tracks[0];

    expect(mixedVocal?.pan).toBe(0);
    expect(mixedVocal?.character.enabled).toBe(false);
    expect(mixedVocal?.compressor.enabled).toBe(false);
    expect(findBandGain(mixedVocal, 280)).toBeLessThanOrEqual(0);
    expect(findBandGain(mixedVocal, 3200)).toBeLessThanOrEqual(0);
    expect(findBandGain(mixedVocal, 1200)).toBe(0);
    expect(findBandGain(mixedVocal, 12500)).toBeGreaterThanOrEqual(0);
    expect(findBandGain(mixedVocal, 12500)).toBeLessThanOrEqual(0.3);
  });

  it("uses professional stereo placement while preserving the center foundation", () => {
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const drums = createTrack("Drums", 1, "drums", "drums");
    const bass = createTrack("Bass", 2, "bass", "bass");
    const synth = createTrack("Synth Pad", 3, "synth", "synth");
    synth.pan = 0.3;

    const project = makeProjectWithTracks([vocal, drums, bass, synth]);
    const result = computeAiMix(project, "magic-pro-polish", "medium", "spotify", "pop", "balanced");
    const [mixedVocal, mixedDrums, mixedBass, mixedSynth] = result.tracks;

    expect(mixedVocal?.pan).toBe(0);
    expect(mixedDrums?.pan).toBe(0);
    expect(mixedBass?.pan).toBe(0);
    expect(Math.abs(mixedSynth?.pan ?? 0)).toBeGreaterThan(0.08);
    expect(Math.abs(mixedSynth?.pan ?? 0)).toBeLessThanOrEqual(0.42);
    expect(findBandGain(mixedSynth, 2400)).toBeLessThanOrEqual(0);
    expect(findBandGain(mixedSynth, 9500)).toBeGreaterThanOrEqual(0);
    expect(findBandGain(mixedSynth, 9500)).toBeLessThanOrEqual(0.1);
  });

  it("pulls foundation stems back inside strict center protection", () => {
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const drums = createTrack("Drums", 1, "drums", "drums");
    const bass = createTrack("Bass", 2, "bass", "bass");
    vocal.pan = 0.45;
    drums.pan = -0.45;
    bass.pan = 0.35;
    const project = makeProjectWithTracks([vocal, drums, bass]);

    const result = computeAiMix(project, "magic-pro-polish", "medium", "none", "pop", "balanced");
    const [mixedVocal, mixedDrums, mixedBass] = result.tracks;

    expect(Math.abs(mixedVocal?.pan ?? 1)).toBeLessThanOrEqual(0.04);
    expect(Math.abs(mixedDrums?.pan ?? 1)).toBeLessThanOrEqual(0.06);
    expect(Math.abs(mixedBass?.pan ?? 1)).toBeLessThanOrEqual(0.03);
  });

  it("leaves reference tracks untouched because they are analysis-only", () => {
    const reference = createTrack("Reference Mix", 0, "reference", "reference");
    reference.gainDb = -2.4;
    reference.pan = 0.31;
    reference.character.enabled = true;
    reference.character.mode = "brightExciter";
    const project = makeProjectWithTracks([reference]);

    const result = computeAiMix(project, "magic-pro-polish", "strong", "spotify", "pop", "balanced");
    const mixedReference = result.tracks[0];

    expect(mixedReference).toEqual(reference);
  });

  it("uses the shared role EQ policy instead of vocal-only EQ moves", () => {
    const guitar = createTrack("Guitar", 0, "guitar", "guitar");
    const fx = createTrack("Impact FX", 1, "fx", "fx");
    const project = makeProjectWithTracks([guitar, fx]);

    const result = computeAiMix(project, "magic-pro-polish", "medium", "spotify", "pop", "balanced");
    const [mixedGuitar, mixedFx] = result.tracks;

    expect(findBandGain(mixedGuitar, 2200)).toBeGreaterThan(0);
    expect(findBandGain(mixedGuitar, 9000)).toBeLessThanOrEqual(0);
    expect(findBandGain(mixedFx, 2800)).toBeGreaterThanOrEqual(0);
    expect(findHighpassFrequency(mixedFx)).toBeGreaterThanOrEqual(120);
  });

  it("does not add automatic high-frequency character to support stems by default", () => {
    const guitar = createTrack("Guitar", 0, "guitar", "guitar");
    const synth = createTrack("Synth", 1, "synth", "synth");
    const drums = createTrack("Drums", 2, "drums", "drums");
    const bass = createTrack("Bass", 3, "bass", "bass");
    const project = makeProjectWithTracks([guitar, synth, drums, bass]);

    const result = computeAiMix(project, "magic-pro-polish", "medium", "spotify", "pop", "balanced");
    const [mixedGuitar, mixedSynth, mixedDrums, mixedBass] = result.tracks;

    expect(mixedGuitar?.character.enabled).toBe(false);
    expect(mixedSynth?.character.enabled).toBe(false);
    expect(mixedDrums?.character.enabled).toBe(false);
    expect(mixedBass?.character.enabled).toBe(true);
    expect(mixedBass?.character.mix).toBeLessThanOrEqual(0.1);
  });

  it("tightens low end without blind sub boosting", () => {
    const drums = createTrack("Drums", 0, "drums", "drums");
    const bass = createTrack("Bass", 1, "bass", "bass");
    const project = makeProjectWithTracks([drums, bass]);

    const result = computeAiMix(project, "magic-pro-polish", "strong", "spotify", "club", "balanced");
    const [mixedDrums, mixedBass] = result.tracks;

    expect(mixedDrums?.pan).toBe(0);
    expect(mixedBass?.pan).toBe(0);
    expect(findBandGain(mixedDrums, 72)).toBeLessThanOrEqual(0.2);
    expect(findBandGain(mixedBass, 55)).toBeLessThanOrEqual(0.2);
    expect(findBandGain(mixedBass, 210)).toBeLessThanOrEqual(0);
    expect(findBandGain(mixedBass, 900)).toBeLessThanOrEqual(0.1);
  });

  it("reduces air boosts when harshness guard sees strong high energy", () => {
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const project = makeProjectWithTracks([vocal]);

    const result = computeAiMix(project, "magic-pro-polish", "medium", "spotify", "pop", "balanced", {
      airEnergy: 0.85,
      ultraAirEnergy: 0.75,
      topAirEnergy: 0.6,
    });
    const mixedVocal = result.tracks[0];

    expect(findBandGain(mixedVocal, 9500)).toBeLessThanOrEqual(0.2);
    expect(findBandGain(mixedVocal, 12500)).toBeLessThanOrEqual(0.2);
  });

  it("uses safer master push for Safe and stronger but capped push for Loud", () => {
    const music = createTrack("Full Mix", 0, "music", "music");
    const project = makeProjectWithTracks([music]);

    const safe = computeAiMix(project, "magic-pro-polish", "medium", "spotify", "pop", "safe");
    const balanced = computeAiMix(project, "magic-pro-polish", "medium", "spotify", "pop", "balanced");
    const loud = computeAiMix(project, "magic-pro-polish", "medium", "spotify", "pop", "loud");

    expect(safe.master.gainDb).toBeLessThanOrEqual(balanced.master.gainDb);
    expect(loud.master.gainDb).toBeGreaterThan(balanced.master.gainDb);
    expect(balanced.master.gainDb).toBeLessThanOrEqual(0.7);
    expect(loud.master.compressor.ratio).toBeLessThanOrEqual(1.65);
  });

  it("reduces limiter push when reference crest is more dynamic than the current mix", () => {
    const music = createTrack("Full Mix", 0, "music", "music");
    const project = makeProjectWithTracks([music]);
    const analysis = { crestFactorDb: 5 };

    const noReference = computeAiMix(project, "magic-pro-polish", "medium", "none", "pop", "balanced", analysis);
    const withReference = computeAiMix(project, "magic-pro-polish", "medium", "none", "pop", "balanced", analysis, {
      referenceCrestFactorDb: 11,
      referenceCrestFollow: true,
    });

    expect(withReference.master.gainDb).toBeLessThanOrEqual(noReference.master.gainDb);
  });

  it("uses touch-up behavior after Doctor without redoing layout or master", () => {
    const synth = createTrack("Synth Pad", 0, "synth", "synth");
    synth.gainDb = -3.2;
    synth.pan = 0.42;
    const project = makeProjectWithTracks([synth]);
    project.master.gainDb = 0.8;
    project.master.compressor.enabled = true;
    project.master.compressor.threshold = -18;

    const result = computeAiMix(project, "magic-pro-polish", "strong", "soundcloud", "pop", "loud", {}, {
      workflow: "doctor-touchup",
    });
    const mixedSynth = result.tracks[0];

    expect(mixedSynth?.pan).toBe(0.42);
    expect(mixedSynth?.gainDb).toBeLessThanOrEqual(-3.2);
    expect(result.master.gainDb).toBe(0.8);
    expect(result.master.compressor.threshold).toBe(-18);
  });
  it("blends non-magic preset gain in dB instead of multiplying negative dB", () => {
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    vocal.gainDb = -12;
    const project = makeProjectWithTracks([vocal]);

    const result = computeAiMix(project, "vocal-forward", "medium", "none", "pop", "balanced");
    const mixedVocal = result.tracks[0];

    expect(mixedVocal?.gainDb).toBeGreaterThan(-12);
    expect(mixedVocal?.gainDb).toBeLessThan(-4);
  });

  it("applies safe reference delta feedback to Magic Pro master EQ", () => {
    const music = createTrack("Full Mix", 0, "music", "music");
    const project = makeProjectWithTracks([music]);

    const result = computeAiMix(project, "magic-pro-polish", "medium", "none", "pop", "balanced", {}, {
      referenceDelta: {
        loudnessDeltaDb: 0,
        peakDeltaDb: 0,
        crestFactorDeltaDb: 0,
        lowEndDeltaDb: -2.4,
        bodyDeltaDb: -1.2,
        presenceDeltaDb: 2.0,
        airDeltaDb: 2.4,
        stereoWidthDelta: 0,
        correlationDelta: 0,
        advisory: [],
      },
    });

    expect(findMasterBandGain(result.master, 3500)).toBeGreaterThan(0);
    expect(findMasterBandGain(result.master, 300)).toBeLessThanOrEqual(0);
    expect(findMasterShelfGain(result.master)).toBeGreaterThan(0);
    expect(findMasterShelfGain(result.master)).toBeLessThanOrEqual(0.6);
  });

  it("keeps reference low-end catch-up from becoming a sub boost", () => {
    const music = createTrack("Full Mix", 0, "music", "music");
    const project = makeProjectWithTracks([music]);

    const result = computeAiMix(project, "magic-pro-polish", "strong", "none", "club", "balanced", {
      lowEnergy: 0.35,
    }, {
      referenceDelta: {
        loudnessDeltaDb: 0,
        peakDeltaDb: 0,
        crestFactorDeltaDb: 0,
        lowEndDeltaDb: 4,
        bodyDeltaDb: 0,
        presenceDeltaDb: 0,
        airDeltaDb: 0,
        stereoWidthDelta: 0,
        correlationDelta: 0,
        advisory: [],
      },
    });

    expect(findMasterBandGain(result.master, 80)).toBeLessThanOrEqual(0.35);
  });
});

function findBandGain(track: Track | undefined, frequency: number) {
  const band = track?.eq.bands.find((entry) => Math.abs(entry.frequency - frequency) < 5);
  return band?.gainDb ?? 0;
}

function findHighpassFrequency(track: Track | undefined) {
  return track?.eq.bands.find((entry) => entry.type === "highpass" && entry.enabled)?.frequency ?? 0;
}

function findMasterBandGain(master: Project["master"], frequency: number) {
  const band = master.eq.bands.find((entry) => entry.type === "peaking" && Math.abs(entry.frequency - frequency) < 5);
  return band?.gainDb ?? 0;
}

function findMasterShelfGain(master: Project["master"]) {
  const band = master.eq.bands.find((entry) => entry.type === "highshelf" && entry.enabled);
  return band?.gainDb ?? 0;
}
