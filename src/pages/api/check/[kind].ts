import type { APIRoute } from "astro";
import { isValidBgPlate, normalizePlate, type CheckKind, type CheckResult } from "@/lib/checks/types";
import { checkVignette } from "@/lib/checks/vignette";
import { checkInsurance } from "@/lib/checks/insurance";
import { checkInspection } from "@/lib/checks/inspection";
import { cacheGet, cachePut, type KVLike } from "@/lib/checks/cache";
import { isRateLimited, clientIp } from "@/lib/checks/rate-limit";
import { logCheck, outcomeOf } from "@/lib/checks/stats";

export const prerender = false;

const HANDLERS: Record<CheckKind, (plate: string) => Promise<CheckResult>> = {
  vignette: checkVignette,
  insurance: checkInsurance,
  inspection: checkInspection,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });

/**
 * Cloudflare KV binding-ът в Astro 6 се чете от модула "cloudflare:workers"
 * (Astro.locals.runtime.env е премахнат). Модулът съществува само на workerd,
 * затова import-ът е динамичен и при Node build-а тихо връща undefined.
 */
let kvResolved = false;
let kvBinding: KVLike | undefined;

async function getKv(): Promise<KVLike | undefined> {
  if (!kvResolved) {
    kvResolved = true;
    try {
      const specifier = "cloudflare:workers";
      const mod = (await import(/* @vite-ignore */ specifier)) as {
        env?: { CHECK_CACHE?: KVLike };
      };
      kvBinding = mod.env?.CHECK_CACHE;
    } catch {
      kvBinding = undefined;
    }
  }
  return kvBinding;
}

export const GET: APIRoute = async ({ params, url, request }) => {
  const kind = params.kind as CheckKind;
  const handler = HANDLERS[kind];
  if (!handler) {
    return json({ error: "unknown_check" }, 404);
  }

  if (isRateLimited(clientIp(request))) {
    return json(
      { error: "rate_limited", message: "Твърде много заявки. Опитайте отново след минута." },
      429,
    );
  }

  const plate = normalizePlate(url.searchParams.get("plate") ?? "");
  if (!isValidBgPlate(plate)) {
    return json(
      { error: "invalid_plate", message: "Невалиден регистрационен номер. Пример: СВ 1234 АВ" },
      400,
    );
  }

  // Cloudflare KV binding (ако е настроен); локално работи in-memory fallback
  const kv = await getKv();
  const cacheKey = `check:${kind}:${plate}`;

  const cached = await cacheGet(kv, cacheKey);
  if (cached) {
    void logCheck(kind, outcomeOf(cached));
    return json(cached);
  }

  const result = await handler(plate);
  if (result.status === "ok") {
    await cachePut(kv, cacheKey, result);
  }
  void logCheck(kind, outcomeOf(result));
  return json(result);
};
