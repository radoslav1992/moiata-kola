import type { APIRoute } from "astro";
import { handleChallenge } from "@/lib/reminders/api";
import { runtimeEnv } from "@/lib/runtime-env";

export const prerender = false;

/** ALTCHA challenge за формата за напомняне. 404, докато функцията не е настроена. */
export const GET: APIRoute = async ({ request }) => handleChallenge(request, await runtimeEnv());
