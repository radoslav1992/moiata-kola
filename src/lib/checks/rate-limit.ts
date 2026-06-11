/**
 * Лек per-IP rate limit в паметта на Worker-а: 30 заявки/минута на IP.
 *
 * Това е защита в дълбочина, не основната линия — на Cloudflare паметта е
 * per-isolate, така че реалният лимит се налага със зоново WAF Rate limiting
 * правило върху /api/check/* (стъпките са в README). Този слой пази локалния
 * Node deploy и реже най-грубите скриптове дори в рамките на един isolate.
 */

const WINDOW_MS = 60_000;
const LIMIT = 30;
const MAX_TRACKED_IPS = 10_000;

const hits = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    if (hits.size >= MAX_TRACKED_IPS) hits.clear();
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > LIMIT;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
