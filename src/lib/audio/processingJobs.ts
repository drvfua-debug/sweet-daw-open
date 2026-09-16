import type { SweetChunk, SweetChunkPlan, SweetProcessingJob, SweetProcessingJobProgress, SweetProcessingJobStatus, SweetProcessingQueueSummary } from "./processingTypes";

export type EnqueueSweetProcessingJob<TParams = unknown, TResult = unknown> = Omit<
  SweetProcessingJob<TParams, TResult>,
  "status" | "progress" | "createdAt" | "updatedAt"
>;

export type RunChunkedArgs<TChunkResult> = {
  plan: SweetChunkPlan;
  signal?: AbortSignal;
  onProgress?: (progress: SweetProcessingJobProgress) => void;
  processChunk: (chunk: SweetChunk) => Promise<TChunkResult> | TChunkResult;
  combine?: (results: TChunkResult[]) => TChunkResult | TChunkResult[];
};

export class SweetProcessingQueue {
  private jobs = new Map<string, SweetProcessingJob>();
  private abortControllers = new Map<string, AbortController>();

  enqueue<TParams, TResult>(job: EnqueueSweetProcessingJob<TParams, TResult>): string {
    const now = Date.now();
    const next: SweetProcessingJob<TParams, TResult> = {
      ...job,
      status: "queued",
      progress: createProgress(0, 0, undefined, now),
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, next as SweetProcessingJob);
    return job.id;
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "done" || job.status === "failed" || job.status === "cancelled") return;
    this.abortControllers.get(jobId)?.abort();
    this.jobs.set(jobId, {
      ...job,
      status: "cancelled",
      error: "Job cancelled.",
      updatedAt: Date.now(),
      progress: { ...job.progress, updatedAt: Date.now() },
    });
  }

  attachAbortController(jobId: string, controller: AbortController): void {
    if (!this.jobs.has(jobId)) return;
    this.abortControllers.set(jobId, controller);
  }

  getJob(jobId: string): SweetProcessingJob | undefined {
    return cloneJob(this.jobs.get(jobId));
  }

  getJobs(): SweetProcessingJob[] {
    return [...this.jobs.values()].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt).map(cloneJob).filter((job): job is SweetProcessingJob => !!job);
  }

  clearDone(): void {
    for (const [id, job] of this.jobs) {
      if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
        this.jobs.delete(id);
        this.abortControllers.delete(id);
      }
    }
  }

  updateStatus(jobId: string, status: SweetProcessingJobStatus, patch: Partial<Pick<SweetProcessingJob, "result" | "error" | "progress">> = {}): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.jobs.set(jobId, { ...job, ...patch, status, updatedAt: Date.now() });
    if (status === "done" || status === "failed" || status === "cancelled") {
      this.abortControllers.delete(jobId);
    }
  }

  getSummary(): SweetProcessingQueueSummary {
    const jobs = this.getJobs();
    const current = jobs.find((job) => job.status === "running") ?? jobs.find((job) => job.status === "queued");
    const lastError = jobs.find((job) => job.error)?.error;
    return {
      runningJobs: jobs.filter((job) => job.status === "running").length,
      queuedJobs: jobs.filter((job) => job.status === "queued").length,
      doneJobs: jobs.filter((job) => job.status === "done").length,
      failedJobs: jobs.filter((job) => job.status === "failed").length,
      cancelledJobs: jobs.filter((job) => job.status === "cancelled").length,
      currentJobLabel: current?.progress.currentLabel ?? current?.kind,
      currentPercent: current?.progress.percent,
      lastError,
    };
  }
}

export async function runChunked<TChunkResult>(args: RunChunkedArgs<TChunkResult>): Promise<TChunkResult | TChunkResult[]> {
  const totalChunks = args.plan.chunks.length;
  const results: TChunkResult[] = [];
  const startedAt = Date.now();
  emitProgress(args, createProgress(0, totalChunks, "Preparing", startedAt));
  throwIfAborted(args.signal);

  if (totalChunks === 0) {
    emitProgress(args, createProgress(0, 0, "Done", startedAt));
    return args.combine ? args.combine(results) : results;
  }

  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = args.plan.chunks[index];
    if (!chunk) continue;
    await yieldToMainThread();
    throwIfAborted(args.signal);
    const result = await args.processChunk(chunk);
    throwIfAborted(args.signal);
    results.push(result);
    emitProgress(args, createProgress(index + 1, totalChunks, `Chunk ${index + 1}/${totalChunks}`, startedAt));
  }

  return args.combine ? args.combine(results) : results;
}

export function createProgress(completedChunks: number, totalChunks: number, currentLabel?: string, startedAt?: number): SweetProcessingJobProgress {
  const safeTotal = Math.max(0, Math.round(totalChunks));
  const safeCompleted = safeTotal === 0 ? 0 : Math.min(safeTotal, Math.max(0, Math.round(completedChunks)));
  const percent = safeTotal === 0 ? 100 : Math.round((safeCompleted / safeTotal) * 1000) / 10;
  const now = Date.now();
  return {
    completedChunks: safeCompleted,
    totalChunks: safeTotal,
    percent: Number.isFinite(percent) ? percent : 0,
    currentLabel,
    startedAt,
    updatedAt: now,
  };
}

export function createAbortError(message = "Processing job cancelled."): Error {
  if (typeof DOMException !== "undefined") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function emitProgress<TChunkResult>(args: RunChunkedArgs<TChunkResult>, progress: SweetProcessingJobProgress) {
  args.onProgress?.(progress);
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw createAbortError();
}

function yieldToMainThread() {
  const requestIdle = (globalThis as typeof globalThis & { requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number }).requestIdleCallback;
  if (typeof requestIdle === "function") {
    return new Promise<void>((resolve) => requestIdle(() => resolve(), { timeout: 24 }));
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function cloneJob(job: SweetProcessingJob | undefined): SweetProcessingJob | undefined {
  if (!job) return undefined;
  return {
    ...job,
    progress: { ...job.progress },
  };
}
