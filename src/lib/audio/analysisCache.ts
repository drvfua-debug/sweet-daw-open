export interface SweetAnalysisCacheEntry<TValue = unknown> {
  key: string;
  value: TValue;
  version: string;
  createdAt: number;
  updatedAt: number;
}

export class SweetAnalysisCache<TValue = unknown> {
  private entries = new Map<string, SweetAnalysisCacheEntry<TValue>>();
  private accessTick = 0;

  constructor(private readonly maxEntries = 64) {}

  get(key: string, version?: string): TValue | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (version && entry.version !== version) return undefined;
    entry.updatedAt = this.nextStamp();
    return entry.value;
  }

  set(key: string, value: TValue, version = "v1"): void {
    const now = this.nextStamp();
    this.entries.set(key, { key, value, version, createdAt: this.entries.get(key)?.createdAt ?? now, updatedAt: now });
    this.trim();
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  snapshot(): SweetAnalysisCacheEntry<TValue>[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

  private nextStamp() {
    this.accessTick += 1;
    return Date.now() * 1000 + this.accessTick;
  }

  private trim() {
    while (this.entries.size > this.maxEntries) {
      const oldest = [...this.entries.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (!oldest) break;
      this.entries.delete(oldest.key);
    }
  }
}