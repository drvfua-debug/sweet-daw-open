const impulseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
const MAX_IMPULSE_CACHE_SIZE = 32;

export function getCachedImpulse(context: BaseAudioContext, key: string, factory: () => AudioBuffer): AudioBuffer {
  let perContext = impulseCache.get(context);
  if (!perContext) {
    perContext = new Map<string, AudioBuffer>();
    impulseCache.set(context, perContext);
  }
  const sampleRateKey = `${key}:sr=${context.sampleRate}`;
  const cached = perContext.get(sampleRateKey);
  if (cached) return cached;

  const impulse = factory();
  if (perContext.size >= MAX_IMPULSE_CACHE_SIZE) {
    const firstKey = perContext.keys().next().value;
    if (typeof firstKey === "string") perContext.delete(firstKey);
  }
  perContext.set(sampleRateKey, impulse);
  return impulse;
}

export function getPluginImpulseCacheSize(context: BaseAudioContext): number {
  return impulseCache.get(context)?.size ?? 0;
}
