import type { APIRoute } from "astro";
import { isValidBgPlate, normalizePlate, type CheckKind } from "@/lib/checks/types";
import { checkVignette } from "@/lib/checks/vignette";
import { checkInsurance } from "@/lib/checks/insurance";
import { checkInspection } from "@/lib/checks/inspection";

export const prerender = false;

const HANDLERS: Record<CheckKind, (plate: string) => Promise<unknown>> = {
  vignette: checkVignette,
  insurance: checkInsurance,
  inspection: checkInspection,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Кратък edge-кеш на резултата за същия номер
      "cache-control": "public, max-age=60",
    },
  });

export const GET: APIRoute = async ({ params, url }) => {
  const kind = params.kind as CheckKind;
  const handler = HANDLERS[kind];
  if (!handler) {
    return json({ error: "unknown_check" }, 404);
  }

  const plate = normalizePlate(url.searchParams.get("plate") ?? "");
  if (!isValidBgPlate(plate)) {
    return json(
      { error: "invalid_plate", message: "Невалиден регистрационен номер. Пример: СВ 1234 АВ" },
      400,
    );
  }

  return json(await handler(plate));
};
