import type { APIRoute } from "astro";
import { normalizePlate } from "@/lib/checks/types";
import { submitCheck } from "@/lib/checks/gtp-relay";
import { isRateLimited, clientIp } from "@/lib/checks/rate-limit";

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const POST: APIRoute = async ({ request }) => {
  if (isRateLimited(clientIp(request))) {
    return json({ error: "rate_limited", message: "Твърде много заявки. Опитайте отново след минута." }, 429);
  }

  let body: { session?: string; plate?: string; captcha?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const session = body.session ?? "";
  const plate = normalizePlate(body.plate ?? "");
  const captcha = (body.captcha ?? "").trim();
  if (!session || !plate || !captcha) {
    return json({ error: "missing_fields" }, 400);
  }

  const result = await submitCheck(session, plate, captcha);
  return json(result);
};
