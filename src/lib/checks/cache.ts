import type { CheckResult } from "./types";

/**
 * Кеш на резултатите от проверки: Cloudflare KV в продукция (binding CHECK_CACHE,
 * виж wrangler.jsonc и README), иначе in-memory fallback за локална разработка.
 * Кешират се само успешни ("ok") резултати — fallback/error състоянията не се
 * кешират, за да се възстановява услугата мигновено след проблем при източника.
 */

export const CACHE_TTL_SECONDS = 120; // KV изисква минимум 60

export interface KVLike {
  get(key: string, type: "json"): Promise<CheckResult | null>;
  put(key: string, value: string, opts: { expirationTtl: number }): Promise<void>;
}

const memory = new Map<string, { value: CheckResult; expires: number }>();

export async function cacheGet(kv: KVLike | undefined, key: string): Promise<CheckResult | null> {
  if (kv) {
    try {
      return await kv.get(key, "json");
    } catch {
      return null;
    }
  }
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  memory.delete(key);
  return null;
}

export async function cachePut(kv: KVLike | undefined, key: string, value: CheckResult): Promise<void> {
  if (kv) {
    try {
      await kv.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL_SECONDS });
    } catch {
      /* кешът никога не чупи проверката */
    }
    return;
  }
  memory.set(key, { value, expires: Date.now() + CACHE_TTL_SECONDS * 1000 });
}
