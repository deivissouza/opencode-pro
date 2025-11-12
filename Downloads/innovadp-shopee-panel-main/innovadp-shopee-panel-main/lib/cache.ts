type Entry = { value: any; expires: number };

const cache = new Map<string, Entry>();

export function setCache(key: string, value: any, ttlMs: number) {
  const expires = Date.now() + Math.max(0, ttlMs);
  cache.set(key, { value, expires });
}

export function getCache<T = any>(key: string): T | undefined {
  const ent = cache.get(key);
  if (!ent) return undefined;
  if (ent.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return ent.value as T;
}

export function delCache(key: string) {
  cache.delete(key);
}

