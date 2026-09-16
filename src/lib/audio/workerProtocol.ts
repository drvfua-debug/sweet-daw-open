import type { SweetChunk, SweetProcessingJobKind, SweetProcessingJobProgress } from "./processingTypes";

export type SweetWorkerRequest =
  | { type: "process-chunk"; jobId: string; kind: SweetProcessingJobKind; chunk: SweetChunk; payload?: unknown }
  | { type: "cancel"; jobId: string };

export type SweetWorkerResponse<TResult = unknown> =
  | { type: "progress"; jobId: string; progress: SweetProcessingJobProgress }
  | { type: "chunk-result"; jobId: string; chunkIndex: number; result: TResult }
  | { type: "cancelled"; jobId: string }
  | { type: "error"; jobId: string; error: string };