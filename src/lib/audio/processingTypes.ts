export type SweetProcessingJobKind =
  | "analysis"
  | "spectrogram"
  | "repair-preview"
  | "repair-render"
  | "unmask-analysis"
  | "reference-delta"
  | "master-polish-preview"
  | "export-render";

export type SweetProcessingJobStatus = "queued" | "running" | "paused" | "cancelled" | "failed" | "done";

export interface SweetProcessingJobProgress {
  completedChunks: number;
  totalChunks: number;
  percent: number;
  currentLabel?: string;
  startedAt?: number;
  updatedAt?: number;
}

export interface SweetProcessingJob<TParams = unknown, TResult = unknown> {
  id: string;
  kind: SweetProcessingJobKind;
  status: SweetProcessingJobStatus;
  priority: number;
  params: TParams;
  result?: TResult;
  error?: string;
  progress: SweetProcessingJobProgress;
  createdAt: number;
  updatedAt: number;
}

export interface SweetChunkPlan {
  sampleRate: number;
  totalFrames: number;
  chunkFrames: number;
  overlapFrames: number;
  chunks: SweetChunk[];
}

export interface SweetChunk {
  index: number;
  startFrame: number;
  endFrame: number;
  readStartFrame: number;
  readEndFrame: number;
}

export interface SweetProcessingQueueSummary {
  runningJobs: number;
  queuedJobs: number;
  doneJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  currentJobLabel?: string;
  currentPercent?: number;
  lastError?: string;
}