import { create } from "zustand";
import type {
  SourceId,
  SpherePoint,
  SoundSpherePatch,
  SoundBlock,
  SoundSphereProject
} from "@/types/soundSphere";
import { calculateSourceWeights } from "./weighting";
import { evaluatePatchFitness } from "./fitness";

export type TransportState = {
  isPlaying: boolean;
  positionBeat: number;
  loopEnabled: boolean;
};

type SoundSphereStore = {
  // Project settings
  title: string;
  bpm: number;
  key: string;
  scale: string;

  // Active Sound Sphere Generator state
  patchName: string;
  spherePoint: SpherePoint;
  mutedSources: SourceId[];
  activeMode: SoundSpherePatch["mode"];
  sourceWeights: Record<SourceId, number>;

  // Calculated fitness states
  chordableScore: number;
  fxScore: number;
  sustainScore: number;
  transientScore: number;
  harshnessRisk: number;
  durationFit: SoundSpherePatch["durationFit"];
  harmonicFit: SoundSpherePatch["harmonicFit"];
  recommendedLane: SoundSpherePatch["recommendedLane"];

  // Saved Patches and Block Composer Arrangement
  savedPatches: SoundSpherePatch[];
  blocks: SoundBlock[];

  // Transport State
  transport: TransportState;
  selectedBlockId: string | null;

  // Actions
  setBpm: (bpm: number) => void;
  setKey: (key: string) => void;
  setScale: (scale: string) => void;
  setSpherePoint: (point: Partial<SpherePoint>) => void;
  toggleSourceMute: (sourceId: SourceId) => void;
  setActiveMode: (mode: SoundSpherePatch["mode"]) => void;
  setPatchName: (name: string) => void;

  // Patch Management
  saveCurrentPatch: () => SoundSpherePatch;
  loadPatch: (patch: SoundSpherePatch) => void;
  deletePatch: (patchId: string) => void;

  // Block Arrangement
  addBlock: (lane: SoundBlock["blockType"], startBeat: number, patchId: string) => boolean;
  updateBlock: (blockId: string, patch: Partial<SoundBlock>) => void;
  deleteBlock: (blockId: string) => void;
  selectBlock: (blockId: string | null) => void;

  // Transport Actions
  setTransport: (patch: Partial<TransportState>) => void;
  resetProject: () => void;
  loadProject: (project: SoundSphereProject) => void;
  exportProjectJson: () => string;
};

const DEFAULT_PROJECT = {
  title: "My Sound Sphere Composition",
  bpm: 120,
  key: "C",
  scale: "Major",
};

export const useSoundSphereStore = create<SoundSphereStore>((set, get) => {
  // Helper to compute derived weights and fitness for the generator state
  const getDerivedStates = (point: SpherePoint, muted: SourceId[]) => {
    const weights = calculateSourceWeights(point, muted);
    const fitness = evaluatePatchFitness(weights);
    return {
      sourceWeights: weights,
      ...fitness
    };
  };

  const initialPoint = { x: 0, y: 0, z: 0 };
  const initialMuted: SourceId[] = [];
  const derived = getDerivedStates(initialPoint, initialMuted);

  return {
    title: DEFAULT_PROJECT.title,
    bpm: DEFAULT_PROJECT.bpm,
    key: DEFAULT_PROJECT.key,
    scale: DEFAULT_PROJECT.scale,

    patchName: "Init Sphere Patch",
    spherePoint: initialPoint,
    mutedSources: initialMuted,
    activeMode: "chord",
    sourceWeights: derived.sourceWeights,

    chordableScore: derived.chordableScore,
    fxScore: derived.fxScore,
    sustainScore: derived.sustainScore,
    transientScore: derived.transientScore,
    harshnessRisk: derived.harshnessRisk,
    durationFit: derived.durationFit,
    harmonicFit: derived.harmonicFit,
    recommendedLane: derived.recommendedLane,

    savedPatches: [],
    blocks: [],

    transport: {
      isPlaying: false,
      positionBeat: 0,
      loopEnabled: true,
    },
    selectedBlockId: null,

    setBpm: (bpm) => set({ bpm: Math.max(60, Math.min(200, bpm)) }),
    setKey: (key) => set({ key }),
    setScale: (scale) => set({ scale }),

    setSpherePoint: (pointPatch) =>
      set((state) => {
        const nextPoint = { ...state.spherePoint, ...pointPatch };
        const nextDerived = getDerivedStates(nextPoint, state.mutedSources);
        return {
          spherePoint: nextPoint,
          ...nextDerived,
        };
      }),

    toggleSourceMute: (sourceId) =>
      set((state) => {
        const nextMuted = state.mutedSources.includes(sourceId)
          ? state.mutedSources.filter((id) => id !== sourceId)
          : [...state.mutedSources, sourceId];
        const nextDerived = getDerivedStates(state.spherePoint, nextMuted);
        return {
          mutedSources: nextMuted,
          ...nextDerived,
        };
      }),

    setActiveMode: (mode) => set({ activeMode: mode }),
    setPatchName: (name) => set({ patchName: name }),

    saveCurrentPatch: () => {
      const state = get();
      const patchId = `patch_${Math.random().toString(36).substring(2, 9)}`;
      const newPatch: SoundSpherePatch = {
        id: patchId,
        name: state.patchName.trim() || `Patch ${state.savedPatches.length + 1}`,
        enabledSources: (Object.keys(state.sourceWeights) as SourceId[]).filter(
          (id) => !state.mutedSources.includes(id)
        ),
        mutedSources: [...state.mutedSources],
        spherePoint: { ...state.spherePoint },
        sourceWeights: { ...state.sourceWeights },
        mode: state.activeMode,
        chordableScore: state.chordableScore,
        fxScore: state.fxScore,
        sustainScore: state.sustainScore,
        transientScore: state.transientScore,
        harshnessRisk: state.harshnessRisk,
        durationFit: state.durationFit,
        harmonicFit: state.harmonicFit,
        recommendedLane: state.recommendedLane,
      };

      set((prev) => ({
        savedPatches: [...prev.savedPatches, newPatch],
        patchName: `Init Sphere Patch ${prev.savedPatches.length + 2}`,
      }));

      return newPatch;
    },

    loadPatch: (patch) => {
      const derived = getDerivedStates(patch.spherePoint, patch.mutedSources);
      set({
        patchName: patch.name,
        spherePoint: { ...patch.spherePoint },
        mutedSources: [...patch.mutedSources],
        activeMode: patch.mode,
        sourceWeights: derived.sourceWeights,
        chordableScore: derived.chordableScore,
        fxScore: derived.fxScore,
        sustainScore: derived.sustainScore,
        transientScore: derived.transientScore,
        harshnessRisk: derived.harshnessRisk,
        durationFit: derived.durationFit,
        harmonicFit: derived.harmonicFit,
        recommendedLane: derived.recommendedLane,
      });
    },

    deletePatch: (patchId) =>
      set((state) => ({
        savedPatches: state.savedPatches.filter((p) => p.id !== patchId),
        blocks: state.blocks.filter((b) => b.patchId !== patchId),
      })),

    addBlock: (lane, startBeat, patchId) => {
      const patch = get().savedPatches.find((p) => p.id === patchId);
      if (!patch) return false;

      // CRITICAL lane constraint check:
      // If a patch is NOT chord-suitable, it cannot be arranged in the Chord Lane
      if (lane === "chord" && patch.chordableScore < 0.4) {
        return false;
      }

      const blockId = `block_${Math.random().toString(36).substring(2, 9)}`;
      const newBlock: SoundBlock = {
        id: blockId,
        startBeat,
        durationBeats: 4, // 1 bar default
        patchId,
        blockType: lane,
        velocity: 80,
      };

      if (lane === "chord") {
        newBlock.chord = { root: get().key, quality: "Maj" };
        newBlock.movement = "hold";
      } else if (lane === "bass") {
        newBlock.movement = "hold";
      }

      set((state) => ({
        blocks: [...state.blocks, newBlock],
        selectedBlockId: blockId,
      }));

      return true;
    },

    updateBlock: (blockId, blockPatch) =>
      set((state) => ({
        blocks: state.blocks.map((b) => (b.id === blockId ? { ...b, ...blockPatch } : b)),
      })),

    deleteBlock: (blockId) =>
      set((state) => ({
        blocks: state.blocks.filter((b) => b.id !== blockId),
        selectedBlockId: state.selectedBlockId === blockId ? null : state.selectedBlockId,
      })),

    selectBlock: (blockId) => set({ selectedBlockId: blockId }),

    setTransport: (transportPatch) =>
      set((state) => ({
        transport: { ...state.transport, ...transportPatch },
      })),

    resetProject: () =>
      set({
        title: DEFAULT_PROJECT.title,
        bpm: DEFAULT_PROJECT.bpm,
        key: DEFAULT_PROJECT.key,
        scale: DEFAULT_PROJECT.scale,
        savedPatches: [],
        blocks: [],
        selectedBlockId: null,
        transport: {
          isPlaying: false,
          positionBeat: 0,
          loopEnabled: true,
        },
      }),

    loadProject: (project) =>
      set({
        title: project.title || DEFAULT_PROJECT.title,
        bpm: project.bpm || DEFAULT_PROJECT.bpm,
        key: project.key || DEFAULT_PROJECT.key,
        scale: project.scale || DEFAULT_PROJECT.scale,
        savedPatches: project.savedPatches || [],
        blocks: project.blocks || [],
        selectedBlockId: null,
      }),

    exportProjectJson: () => {
      const state = get();
      const proj: SoundSphereProject = {
        id: `project_${Math.random().toString(36).substring(2, 9)}`,
        title: state.title,
        bpm: state.bpm,
        key: state.key,
        scale: state.scale,
        savedPatches: state.savedPatches,
        blocks: state.blocks,
        updatedAt: new Date().toISOString(),
      };
      return JSON.stringify(proj, null, 2);
    },
  };
});
