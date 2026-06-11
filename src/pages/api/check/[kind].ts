import type { APIRoute } from "astro";
import { isValidBgPlate, normalizePlate, type CheckKind, type CheckResult } from "@/lib/checks/types";
import { checkVignette } from "@/lib/checks/vignette";
import { checkInsurance } from "@/lib/checks/insurance";
import { checkInspection } from "@/lib/checks/inspection";
import { cacheGet, cachePut, type KVLike } from "@/lib/checks/cache";
import { isRateLimited, clientIp } from "@/lib/checks/rate-limit";

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

export const GET: APIRoute = async ({ params, url, request, locals }) => {
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
  const kv = (locals as { runtime?: { env?: { CHECK_CACHE?: KVLike } } }).runtime?.env?.CHECK_CACHE;
  const cacheKey = `check:${kind}:${plate}`;

  const cached = await cacheGet(kv, cacheKey);
  if (cached) return json(cached);

  const result = await handler(plate);
  if (result.status === "ok") {
    await cachePut(kv, cacheKey, result);
  }
  return json(result);
};
