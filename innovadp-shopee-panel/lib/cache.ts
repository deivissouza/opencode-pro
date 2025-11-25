import { kv } from "./redis";

export async function setCache(key: string, value: any, ttlInSeconds: number) {
  try {
    await kv.set(key, value, { ex: ttlInSeconds });
  } catch (error) {
    console.error(`[Cache] Falha ao definir chave ${key}:`, error);
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    return await kv.get<T>(key);
  } catch (error) {
    console.error(`[Cache] Falha ao ler chave ${key}:`, error);
    return null;
  }
}

export async function delCache(key: string) {
  try {
    await kv.del(key);
  } catch (error) {
    console.error(`[Cache] Falha ao deletar chave ${key}:`, error);
  }
}
