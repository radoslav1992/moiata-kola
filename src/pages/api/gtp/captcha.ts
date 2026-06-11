import type { APIRoute } from "astro";
import { getCaptcha } from "@/lib/checks/gtp-relay";
import { isRateLimited, clientIp } from "@/lib/checks/rate-limit";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  if (isRateLimited(clientIp(request))) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  try {
    const { session, image } = await getCaptcha();
    return new Response(JSON.stringify({ session, image }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "captcha_unavailable",
        reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      }),
      { status: 502, headers: { "content-type": "application/json; charset=utf-8" } },
    );
  }
};
