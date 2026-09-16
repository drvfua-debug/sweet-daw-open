"use client";

import { audioBufferRegistry, type DecodedAudioAsset } from "@/audio/engine/AudioBufferRegistry";
import { decodeAudioBlob, decodeAudioFile } from "@/audio/engine/AudioDecode";
import { connectPostInsertPath } from "@/audio/engine/AudioGraphRouting";
import { createClipPanAutomationNode } from "@/audio/engine/ClipPanAutomation";
import { createMasterBus, type MasterBusNodes } from "@/audio/engine/MasterBus";
import { meterBridge, type MeterReading, type SpectrumReading, type WaveformReading } from "@/audio/engine/MeterBridge";
import { dbToGain, getAudibleTrackGain, getProjectDurationSec, hasSoloTrack, isReferenceTrack } from "@/audio/engine/TrackGraph";
import { TransportClock } from "@/audio/engine/Transport";
import { createCharacter, type CharacterNodeChain } from "@/audio/fx/Character";
import { createCompressor, type CompressorNodeChain } from "@/audio/fx/Compressor";
import { buildVocalActivityEnvelope, createDynamicVocalDuckNode, getVocalDuckSignature, isVocalDuckSourceRole, shouldUseVocalDuck, type DynamicVocalDuckNode } from "@/audio/fx/DynamicVocalDuck";
import { createParametricEQ, type ParametricEQNodeChain } from "@/audio/fx/ParametricEQ";
import { createVocalImageLayer, getVocalImageLayerSignature, isVocalImageLayerActive, type VocalImageLayerNodes } from "@/audio/fx/VocalImageLayer";
import { buildPluginChain, getPluginChainSignature, type PluginChainNodes } from "@/audio/plugins/PluginChain";
import type { PluginInstance } from "@/daw/model/Plugin";
import type { AudioFileRef, MasterState, Project, Track } from "@/daw/model/Project";

const SCHEDULE_AHEAD_SEC = 0.08;

export type AudioImportProgress = {
  index: number;
  total: number;
  fileName: string;
};

export type AudioImportOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: AudioImportProgress) => void;
};

type TrackControlNodes = {
  input: GainNode;
  eqPreAnalyser: AnalyserNode | null;
  eqPostAnalyser: AnalyserNode | null;
  eq: ParametricEQNodeChain;
  character: CharacterNodeChain;
  vocalImageLayer: VocalImageLayerNodes | null;
  vocalDuck: DynamicVocalDuckNode | null;
  compressor: CompressorNodeChain;
  insertChain: PluginChainNodes;
  gain: GainNode;
  pan: StereoPannerNode | null;
  meter: AnalyserNode | null;
  sendGains: Map<string, GainNode>;
  signature: string;
};

type SendBusNodes = {
  input: GainNode;
  chain: PluginChainNodes;
  output: GainNode;
  dispose: () => void;
};

export class AudioEngine {
  private context: AudioContext | null = null;
  private activeSources: AudioBufferSourceNode[] = [];
  private activeClipChains: PluginChainNodes[] = [];
  private trackControls = new Map<string, TrackControlNodes>();
  private masterBus: MasterBusNodes | null = null;
  private sendBuses = new Map<string, SendBusNodes>();
  private masterMeter: AnalyserNode | null = null;
  private vocalDuckDetectorInput: GainNode | null = null;
  private vocalDuckAnalyser: AnalyserNode | null = null;
  private vocalDuckAnalyserData: Float32Array<ArrayBuffer> | null = null;
  private vocalDuckPollHandle: number | null = null;
  private lastVocalDuckPollMs = 0;
  private vocalDuckUsesScheduledEnvelope = false;
  private vocalDuckEnvelopeSource: "audio-analysis" | "clip-fallback" | "mixed" | "none" = "none";
  private vocalDuckEnvelopeWindowCount = 0;
  private clock = new TransportClock();
  private startedAtContextTime = 0;
  private playStartPositionSec = 0;

  async importFiles(files: File[], options: AudioImportOptions = {}): Promise<DecodedAudioAsset[]> {
    const context = await this.ensureContext();
    const decoded: DecodedAudioAsset[] = [];

    for (let index = 0; index < files.length; index += 1) {
      if (options.signal?.aborted) {
        throw new Error("Import cancelled.");
      }
      const file = files[index];
      if (!file) continue;
      options.onProgress?.({ index: index + 1, total: files.length, fileName: file.name });
      const buffer = await decodeAudioFile(context, file);
      if (options.signal?.aborted) {
        throw new Error("Import cancelled.");
      }
      decoded.push(audioBufferRegistry.register(file, buffer));
    }

    return decoded;
  }

  async decodeStoredAsset(fileRef: AudioFileRef, blob: Blob): Promise<DecodedAudioAsset> {
    const context = await this.ensureContext();
    const sourceFile = new File([blob], fileRef.name, { type: fileRef.mimeType || blob.type || "audio/unknown" });
    const buffer = await decodeAudioBlob(context, blob, fileRef.name, fileRef.mimeType || blob.type || "audio/unknown");
    return audioBufferRegistry.registerRestored(fileRef, buffer, sourceFile);
  }

  async play(project: Project, positionSec: number) {
    const context = await this.ensureContext();
    await context.resume();
    await this.ensurePlayableBuffers(project, context);

    this.stopActiveSources();
    this.rebuildControls(project);
    this.syncProject(project);

    const startAt = context.currentTime + SCHEDULE_AHEAD_SEC;
    this.clock.play(startAt, positionSec);
    this.startedAtContextTime = startAt;
    this.playStartPositionSec = positionSec;
    this.scheduleVocalDuckEnvelope(project, positionSec, startAt);
    this.refreshVocalDuckPolling();

    this.scheduleProject(project, positionSec, startAt);
  }

  pause() {
    if (!this.context) return this.clock.getPosition(0);
    const position = this.getCurrentPosition();
    this.stopActiveSources();
    this.stopVocalDuckPolling();
    this.vocalDuckUsesScheduledEnvelope = false;
    this.vocalDuckEnvelopeSource = "none";
    this.vocalDuckEnvelopeWindowCount = 0;
    this.clock.pause(this.context.currentTime);
    this.clock.seek(position);
    return position;
  }

  stop() {
    this.stopActiveSources();
    this.stopVocalDuckPolling();
    this.vocalDuckUsesScheduledEnvelope = false;
    this.vocalDuckEnvelopeSource = "none";
    this.vocalDuckEnvelopeWindowCount = 0;
    this.clock.stop();
  }

  async suspendForOfflineExport() {
    this.stop();
    this.disposeAllTrackControls();
    this.disposeSendBuses();
    this.masterBus?.dispose();
    this.masterBus = null;
    this.masterMeter?.disconnect();
    this.masterMeter = null;
    meterBridge.clear();
    this.disposeVocalDuckDetector();
    const context = this.context;
    this.context = null;
    await context?.close().catch(() => undefined);
  }

  async seek(project: Project, positionSec: number, shouldPlay: boolean) {
    if (!this.context) {
      this.clock.seek(positionSec);
      return;
    }

    this.stopActiveSources();
    this.clock.seek(positionSec, this.context.currentTime);

    if (shouldPlay) {
      await this.play(project, positionSec);
    }
  }

  syncProject(project: Project) {
    if (!this.context) return;
    const graphChanged = this.rebuildControls(project);

    const soloActive = hasSoloTrack(project.tracks);
    for (const track of project.tracks) {
      const nodes = this.trackControls.get(track.id);
      if (!nodes) continue;

      nodes.eq.apply(track.eq, { smooth: true });
      nodes.character.apply(track.character, { smooth: true });
      nodes.compressor.apply(track.compressor, { smooth: true });
      nodes.insertChain.update(track.insertChain, { smooth: true, bpm: project.bpm ?? 120 });
      nodes.vocalDuck?.apply(track.insertChain, { smooth: true });
      nodes.vocalImageLayer?.apply(track.vocalImage, { smooth: true });
      nodes.gain.gain.setTargetAtTime(getAudibleTrackGain(track, soloActive), this.context.currentTime, 0.01);
      if (nodes.pan) {
        nodes.pan.pan.setTargetAtTime(track.pan, this.context.currentTime, 0.01);
      }
    }

    if (this.masterBus) {
      this.masterBus.apply(project.master, { smooth: true });
    }

    if (graphChanged && this.clock.playing) {
      this.rescheduleActiveProject(project);
    }
  }

  getCurrentPosition() {
    if (!this.context) return 0;
    if (!this.clock.playing) return this.clock.getPosition(this.context.currentTime);
    const raw = this.playStartPositionSec + Math.max(0, this.context.currentTime - this.startedAtContextTime);
    return Math.min(raw, Number.MAX_SAFE_INTEGER);
  }

  getDebugInfo() {
    return {
      sampleRate: this.context?.sampleRate ?? null,
      state: this.context?.state ?? "not-created",
      importedBuffers: "registry",
      vocalDuckEnvelopeSource: this.vocalDuckEnvelopeSource,
      vocalDuckEnvelopeWindowCount: this.vocalDuckEnvelopeWindowCount,
    };
  }

  readMeter(id: string): MeterReading {
    return meterBridge.read(id);
  }

  readSpectrum(id: string): SpectrumReading | null {
    return meterBridge.readSpectrum(id);
  }

  readWaveform(id: string): WaveformReading | null {
    return meterBridge.readWaveform(id);
  }

  readMeters(trackIds: string[]) {
    return trackIds.reduce<Record<string, MeterReading>>((readings, trackId) => {
      readings[trackId] = meterBridge.read(trackId);
      return readings;
    }, {});
  }

  dispose() {
    this.stopActiveSources();
    this.trackControls.clear();
    this.disposeSendBuses();
    this.masterBus = null;
    this.masterMeter = null;
    meterBridge.clear();
    audioBufferRegistry.clear();
    this.stopVocalDuckPolling();
    this.disposeVocalDuckDetector();
    void this.context?.close();
    this.context = null;
  }

  private async ensureContext() {
    if (this.context) return this.context;

    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("This browser does not support AudioContext.");
    }

    this.context = new AudioContextCtor();
    meterBridge.attach(this.context);
    return this.context;
  }

  private async ensurePlayableBuffers(project: Project, context: BaseAudioContext) {
    const referenceTrackIds = new Set(
      project.tracks.filter((track) => isReferenceTrack(track)).map((track) => track.id),
    );
    const fileIds = [...new Set(
      project.clips
        .filter((clip) => !referenceTrackIds.has(clip.trackId))
        .map((clip) => clip.isFrozen && clip.frozenRenderFileId ? clip.frozenRenderFileId : clip.fileId),
    )];
    for (const fileId of fileIds) {
      if (audioBufferRegistry.getBuffer(fileId)) continue;
      const sourceFile = audioBufferRegistry.getFile(fileId);
      const fileRef = project.files.find((entry) => entry.id === fileId);
      if (!sourceFile || !fileRef) continue;
      const buffer = await decodeAudioFile(context, sourceFile);
      audioBufferRegistry.registerRestored(fileRef, buffer, sourceFile);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  private rebuildControls(project: Project) {
    if (!this.context) return false;
    let changed = false;
    const masterSignature = getPluginChainSignature(project.master.insertChain);

    if (!this.masterBus || this.masterBus.signature !== masterSignature) {
      this.masterBus?.dispose();
      meterBridge.remove(getMasterEqAnalyserId("pre"));
      meterBridge.remove(getMasterEqAnalyserId("post"));
      meterBridge.remove("master");
      this.disposeAllTrackControls();
      this.disposeSendBuses();
      this.masterBus = createMasterBus(this.context, project.master);
      this.createSendBuses(project.bpm ?? 120);
      const masterEqPre = meterBridge.createSpectrumAnalyser(getMasterEqAnalyserId("pre"));
      const masterEqPost = meterBridge.createSpectrumAnalyser(getMasterEqAnalyserId("post"));
      if (masterEqPre) this.masterBus.input.connect(masterEqPre);
      if (masterEqPost) this.masterBus.eq.output.connect(masterEqPost);
      this.masterMeter = meterBridge.createAnalyser("master");
      if (this.masterMeter) {
        this.masterBus.output.connect(this.masterMeter);
        this.masterMeter.connect(this.context.destination);
      } else {
        this.masterBus.output.connect(this.context.destination);
      }
      changed = true;
    }

    const playableTracks = project.tracks.filter((track) => !isReferenceTrack(track));

    for (const track of playableTracks) {
      const trackSignature = getTrackControlSignature(track, project.master);
      const existing = this.trackControls.get(track.id);
      if (!existing) {
        this.trackControls.set(track.id, this.createTrackControls(track, project.master, project.bpm ?? 120));
        changed = true;
      } else if (existing.signature !== trackSignature) {
        this.disposeTrackControls(track.id, existing);
        this.trackControls.set(track.id, this.createTrackControls(track, project.master, project.bpm ?? 120));
        changed = true;
      }
    }

    for (const [trackId, nodes] of this.trackControls) {
      if (!playableTracks.some((track) => track.id === trackId)) {
        this.disposeTrackControls(trackId, nodes);
        changed = true;
      }
    }

    this.refreshVocalDuckPolling();
    return changed;
  }

  private createTrackControls(track: Track, master: MasterState, bpm: number): TrackControlNodes {
    if (!this.context || !this.masterBus) {
      throw new Error("Audio graph was not initialized.");
    }

    const input = this.context.createGain();
    const eqPreAnalyser = meterBridge.createSpectrumAnalyser(getTrackEqAnalyserId(track.id, "pre"));
    const eqPostAnalyser = meterBridge.createSpectrumAnalyser(getTrackEqAnalyserId(track.id, "post"));
    const eq = createParametricEQ(this.context, track.eq);
    const character = createCharacter(this.context, track.character);
    const compressor = createCompressor(this.context, track.compressor);
    const insertChain = buildPluginChain(this.context, track.insertChain, { bpm });
    const vocalDuck = shouldUseVocalDuck(track) ? createDynamicVocalDuckNode(this.context, track.insertChain) : null;
    const vocalImageLayer = isVocalImageLayerActive(master, track)
      ? createVocalImageLayer(this.context, track.vocalImage)
      : null;
    const gain = this.context.createGain();
    const meter = meterBridge.createAnalyser(track.id);
    const sendGains = new Map<string, GainNode>();
    let pan: StereoPannerNode | null = null;

    if (eqPreAnalyser) input.connect(eqPreAnalyser);
    input.connect(eq.input);
    if (eqPostAnalyser) eq.output.connect(eqPostAnalyser);
    eq.output.connect(character.input);
    character.output.connect(compressor.input);
    compressor.output.connect(insertChain.input);
    if ("createStereoPanner" in this.context) {
      pan = this.context.createStereoPanner();
    }
    connectPostInsertPath({
      insertOutput: insertChain.output,
      vocalDuck,
      vocalImageLayer,
      pan,
      gain,
    });

    gain.gain.value = dbToGain(track.gainDb);
    if (pan) pan.pan.value = track.pan;
    if (meter) {
      gain.connect(meter);
      meter.connect(this.masterBus.input);
    } else {
      gain.connect(this.masterBus.input);
    }
    this.connectTrackSends(track, gain, sendGains);
    if (isVocalDuckSourceRole(track.role)) {
      const detectorInput = this.ensureVocalDuckDetector();
      if (detectorInput) gain.connect(detectorInput);
    }

    return {
      input,
      eqPreAnalyser,
      eqPostAnalyser,
      eq,
      character,
      vocalImageLayer,
      vocalDuck,
      compressor,
      insertChain,
      gain,
      pan,
      meter,
      sendGains,
      signature: getTrackControlSignature(track, master),
    };
  }

  private createSendBuses(bpm: number) {
    if (!this.context || !this.masterBus) return;
    const ambience = createAmbienceSendBus(this.context, bpm);
    ambience.output.connect(this.masterBus.input);
    this.sendBuses.set("bus-ambience", ambience);
  }

  private connectTrackSends(track: Track, source: AudioNode, sendGains: Map<string, GainNode>) {
    if (!this.context) return;
    for (const send of track.sends) {
      const bus = this.sendBuses.get(send.targetBusId);
      if (!send.enabled || !bus) continue;
      const sendGain = this.context.createGain();
      sendGain.gain.value = dbToGain(send.gainDb);
      source.connect(sendGain);
      sendGain.connect(bus.input);
      sendGains.set(send.id, sendGain);
    }
  }

  private disposeSendBuses() {
    for (const bus of this.sendBuses.values()) {
      bus.dispose();
    }
    this.sendBuses.clear();
  }

  private scheduleProject(project: Project, positionSec: number, startAtContextTime: number) {
    if (!this.context) return;

    const projectDuration = getProjectDurationSec(project);
    if (positionSec >= projectDuration) return;

    for (const clip of project.clips) {
      const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
      if (!track) continue;
      if (isReferenceTrack(track)) continue;

      const nodes = this.trackControls.get(track.id);
      const frozenFileId = clip.isFrozen && clip.frozenRenderFileId ? clip.frozenRenderFileId : null;
      const buffer = audioBufferRegistry.getBuffer(frozenFileId ?? clip.fileId);
      if (!nodes || !buffer) continue;

      const clipStart = clip.timelineStartSec;
      const clipEnd = clip.timelineStartSec + clip.durationSec;
      if (clipEnd <= positionSec) continue;

      const sourceDelaySec = Math.max(0, clipStart - positionSec);
      const offsetIntoClipSec = Math.max(0, positionSec - clipStart);
      const sourceOffsetSec = (frozenFileId ? 0 : clip.sourceStartSec) + offsetIntoClipSec;
      const sourceDurationSec = Math.min(
        clip.durationSec - offsetIntoClipSec,
        Math.max(0, buffer.duration - sourceOffsetSec),
      );

      if (sourceDurationSec <= 0) continue;

      const source = this.context.createBufferSource();
      const clipGain = this.context.createGain();
      const clipPan = createClipPanAutomationNode(
        this.context,
        clip,
        startAtContextTime + sourceDelaySec,
        offsetIntoClipSec,
        sourceDurationSec,
      );
      const activeClipInserts = frozenFileId ? [] : clip.insertChain;
      const clipInsertChain = activeClipInserts.length > 0
        ? buildPluginChain(this.context, activeClipInserts, { bpm: project.bpm ?? 120 })
        : null;
      source.buffer = buffer;
      scheduleClipGain(clipGain.gain, dbToGain(clip.gainDb), startAtContextTime + sourceDelaySec, sourceDurationSec, clip.fadeInSec, clip.fadeOutSec);
      source.connect(clipGain);
      const clipOutput = clipPan?.output ?? clipGain;
      if (clipPan) {
        clipGain.connect(clipPan.input);
      }
      if (clipInsertChain) {
        clipOutput.connect(clipInsertChain.input);
        clipInsertChain.output.connect(nodes.input);
        this.activeClipChains.push(clipInsertChain);
      } else {
        clipOutput.connect(nodes.input);
      }
      source.start(startAtContextTime + sourceDelaySec, sourceOffsetSec, sourceDurationSec);
      source.onended = () => {
        try {
          source.disconnect();
          clipGain.disconnect();
          clipPan?.input.disconnect();
          clipPan?.output.disconnect();
        } catch {
          // Already disconnected by stop/seek.
        }
        if (clipInsertChain && this.activeClipChains.includes(clipInsertChain)) {
          clipInsertChain.dispose();
          this.activeClipChains = this.activeClipChains.filter((entry) => entry !== clipInsertChain);
        }
      };
      this.activeSources.push(source);
    }
  }

  private stopActiveSources() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // A source may already have ended; disconnecting below still releases graph nodes.
      }
      source.disconnect();
      source.onended = null;
      try {
        source.buffer = null;
      } catch {
        // Older Safari versions can reject buffer reassignment after start.
      }
    }

    this.activeSources = [];
    for (const chain of this.activeClipChains) {
      chain.dispose();
    }
    this.activeClipChains = [];
  }

  private rescheduleActiveProject(project: Project) {
    if (!this.context) return;
    const position = this.getCurrentPosition();
    this.stopActiveSources();
    const startAt = this.context.currentTime + SCHEDULE_AHEAD_SEC;
    this.clock.play(startAt, position);
    this.startedAtContextTime = startAt;
    this.playStartPositionSec = position;
    this.scheduleVocalDuckEnvelope(project, position, startAt);
    this.refreshVocalDuckPolling();
    this.scheduleProject(project, position, startAt);
  }

  private scheduleVocalDuckEnvelope(project: Project, positionSec: number, startAtContextTime: number) {
    const envelope = buildVocalActivityEnvelope(project, audioBufferRegistry);
    const hasAudioEnvelope = envelope.windows.some((window) => typeof window.level === "number");
    this.vocalDuckUsesScheduledEnvelope = hasAudioEnvelope;
    this.vocalDuckEnvelopeSource = envelope.windows.length > 0 ? envelope.source : "none";
    this.vocalDuckEnvelopeWindowCount = envelope.windows.length;

    for (const nodes of this.trackControls.values()) {
      nodes.vocalDuck?.scheduleDuckWindows(hasAudioEnvelope ? envelope.windows : [], {
        timelinePositionSec: positionSec,
        startAtContextTime,
      });
    }
  }

  private disposeAllTrackControls() {
    for (const [trackId, nodes] of this.trackControls) {
      this.disposeTrackControls(trackId, nodes);
    }
  }

  private disposeTrackControls(trackId: string, nodes: TrackControlNodes) {
    nodes.input.disconnect();
    nodes.eqPreAnalyser?.disconnect();
    nodes.eqPostAnalyser?.disconnect();
    nodes.eq.dispose();
    nodes.character.dispose();
    nodes.vocalImageLayer?.dispose();
    nodes.vocalDuck?.dispose();
    nodes.compressor.dispose();
    nodes.insertChain.dispose();
    nodes.gain.disconnect();
    for (const sendGain of nodes.sendGains.values()) {
      sendGain.disconnect();
    }
    nodes.pan?.disconnect();
    nodes.meter?.disconnect();
    meterBridge.remove(getTrackEqAnalyserId(trackId, "pre"));
    meterBridge.remove(getTrackEqAnalyserId(trackId, "post"));
    meterBridge.remove(trackId);
    this.trackControls.delete(trackId);
  }

  private ensureVocalDuckDetector() {
    if (!this.context) return null;
    if (this.vocalDuckDetectorInput) return this.vocalDuckDetectorInput;

    const input = this.context.createGain();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    input.connect(analyser);
    this.vocalDuckDetectorInput = input;
    this.vocalDuckAnalyser = analyser;
    this.vocalDuckAnalyserData = new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT));
    return input;
  }

  private disposeVocalDuckDetector() {
    this.vocalDuckDetectorInput?.disconnect();
    this.vocalDuckAnalyser?.disconnect();
    this.vocalDuckDetectorInput = null;
    this.vocalDuckAnalyser = null;
    this.vocalDuckAnalyserData = null;
  }

  private refreshVocalDuckPolling() {
    const hasDuckNodes = Array.from(this.trackControls.values()).some((nodes) => Boolean(nodes.vocalDuck));
    if (!this.clock.playing || !hasDuckNodes || this.vocalDuckUsesScheduledEnvelope) {
      this.stopVocalDuckPolling();
      return;
    }
    if (this.vocalDuckPollHandle !== null) return;
    this.scheduleVocalDuckPoll();
  }

  private scheduleVocalDuckPoll() {
    const tick = (timestamp: number) => {
      this.vocalDuckPollHandle = null;
      if (!this.clock.playing) return;

      if (timestamp - this.lastVocalDuckPollMs >= 33) {
        this.lastVocalDuckPollMs = timestamp;
        const level = this.readVocalDuckLevel();
        for (const nodes of this.trackControls.values()) {
          nodes.vocalDuck?.updateFromLevel(level);
        }
      }

      if (Array.from(this.trackControls.values()).some((nodes) => Boolean(nodes.vocalDuck))) {
        this.scheduleVocalDuckPoll();
      }
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      this.vocalDuckPollHandle = window.requestAnimationFrame(tick);
    } else if (typeof window !== "undefined") {
      this.vocalDuckPollHandle = window.setTimeout(() => tick(performance.now()), 33);
    }
  }

  private stopVocalDuckPolling() {
    if (this.vocalDuckPollHandle === null || typeof window === "undefined") return;
    if (typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(this.vocalDuckPollHandle);
    }
    window.clearTimeout(this.vocalDuckPollHandle);
    this.vocalDuckPollHandle = null;
  }

  private readVocalDuckLevel() {
    if (!this.vocalDuckAnalyser || !this.vocalDuckAnalyserData) return 0;
    this.vocalDuckAnalyser.getFloatTimeDomainData(this.vocalDuckAnalyserData);
    let sum = 0;
    for (let index = 0; index < this.vocalDuckAnalyserData.length; index += 1) {
      const sample = this.vocalDuckAnalyserData[index] ?? 0;
      sum += sample * sample;
    }
    return Math.sqrt(sum / Math.max(1, this.vocalDuckAnalyserData.length));
  }
}

function createAmbienceSendBus(context: BaseAudioContext, bpm: number): SendBusNodes {
  const input = context.createGain();
  const chain = buildPluginChain(context, [createAmbienceReverbPlugin()], { bpm });
  const output = context.createGain();
  output.gain.value = 0.75;
  input.connect(chain.input);
  chain.output.connect(output);
  return {
    input,
    chain,
    output,
    dispose: () => {
      input.disconnect();
      chain.dispose();
      output.disconnect();
    },
  };
}

function createAmbienceReverbPlugin(): PluginInstance {
  const now = new Date().toISOString();
  return {
    id: "send-bus-ambience-reverb",
    pluginId: "sweet-reverb-lite",
    name: "Ambience Bus",
    enabled: true,
    target: "track",
    params: {
      room: 0.32,
      damp: 0.62,
      preDelayMs: 18,
      lowCutHz: 180,
      highCutHz: 9000,
      width: 0.38,
      mix: 0.16,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function getTrackSendSignature(track: Track) {
  return track.sends
    .map((send) => `${send.id}:${send.targetBusId}:${send.enabled ? 1 : 0}:${send.gainDb}`)
    .join("|");
}

function getTrackControlSignature(track: Track, master: MasterState) {
  return [
    track.role,
    getPluginChainSignature(track.insertChain),
    getTrackSendSignature(track),
    getVocalImageLayerSignature(master, track),
    getVocalDuckSignature(track),
  ].join("|");
}

export const audioEngine = new AudioEngine();

export function getTrackEqAnalyserId(trackId: string, mode: "pre" | "post") {
  return `track:${trackId}:eq:${mode}`;
}

export function getMasterEqAnalyserId(mode: "pre" | "post") {
  return `master:eq:${mode}`;
}

function scheduleClipGain(
  param: AudioParam,
  baseGain: number,
  startTime: number,
  durationSec: number,
  fadeInSec: number,
  fadeOutSec: number,
) {
  const fadeIn = Math.min(Math.max(0, fadeInSec), durationSec);
  const fadeOut = Math.min(Math.max(0, fadeOutSec), Math.max(0, durationSec - fadeIn));
  const endTime = startTime + durationSec;

  param.cancelScheduledValues(startTime);
  param.setValueAtTime(fadeIn > 0 ? 0 : baseGain, startTime);
  if (fadeIn > 0) param.linearRampToValueAtTime(baseGain, startTime + fadeIn);
  if (fadeOut > 0) {
    param.setValueAtTime(baseGain, Math.max(startTime, endTime - fadeOut));
    param.linearRampToValueAtTime(0, endTime);
  }
}
