import type { APIRoute } from "astro";
import { handleSignup } from "@/lib/reminders/api";
import { runtimeEnv } from "@/lib/runtime-env";

export const prerender = false;

/** Заявка за напомняне по имейл (double opt-in). 404, докато D1 и EMAIL не са настроени. */
export const POST: APIRoute = async ({ request }) => handleSignup(request, await runtimeEnv());
