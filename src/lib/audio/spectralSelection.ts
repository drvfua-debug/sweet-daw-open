import type { SweetSpectralSelection } from "./spectralEditorTypes";

export type CreateSweetSpectralSelectionInput = Partial<SweetSpectralSelection> & {
  startSec: number;
  endSec: number;
};

export function createSweetSpectralSelection(input: CreateSweetSpectralSelectionInput): SweetSpectralSelection {
  const startSec = clampNumber(Math.min(input.startSec, input.endSec), 0, 60 * 60);
  const endSec = Math.max(startSec + 0.01, clampNumber(Math.max(input.startSec, input.endSec), 0, 60 * 60));
  const rawMinHz = input.minHz == null && input.maxHz == null ? undefined : Math.min(input.minHz ?? input.maxHz ?? 20, input.maxHz ?? input.minHz ?? 20000);
  const rawMaxHz = input.minHz == null && input.maxHz == null ? undefined : Math.max(input.minHz ?? input.maxHz ?? 20, input.maxHz ?? input.minHz ?? 20000);
  const minHz = rawMinHz == null ? undefined : clampNumber(rawMinHz, 20, 20000);
  const maxHz = rawMaxHz == null ? undefined : Math.max((minHz ?? 20) + 10, clampNumber(rawMaxHz, 20, 20000));
  return {
    id: input.id ?? createSelectionId(),
    startSec,
    endSec,
    minHz,
    maxHz,
    shape: input.shape ?? (minHz == null || maxHz == null ? "time-range" : "rectangle"),
    featherTimeSec: clampNumber(input.featherTimeSec ?? 0.03, 0, 2),
    featherHz: clampNumber(input.featherHz ?? 120, 0, 6000),
  };
}

export function updateSweetSpectralSelection(selection: SweetSpectralSelection, patch: Partial<SweetSpectralSelection>): SweetSpectralSelection {
  return createSweetSpectralSelection({ ...selection, ...patch, startSec: patch.startSec ?? selection.startSec, endSec: patch.endSec ?? selection.endSec });
}

export function selectionDurationSec(selection: SweetSpectralSelection) {
  return Math.max(0, selection.endSec - selection.startSec);
}

export function selectionFrequencyRange(selection: SweetSpectralSelection) {
  return {
    minHz: clampNumber(selection.minHz ?? 20, 20, 20000),
    maxHz: clampNumber(selection.maxHz ?? 20000, 20, 20000),
  };
}

export function createSelectionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `sel_${crypto.randomUUID()}`;
  return `sel_${Math.random().toString(36).slice(2, 10)}`;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}