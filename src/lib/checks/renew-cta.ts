/**
 * Връзката „какво да направя сега“ в картите с резултат (изтичащ или липсващ
 * срок). Целта идва от src/data/renew-links.ts; при партньорска връзка се
 * добавят rel="sponsored" и видимо разкритие под нея.
 */
import { renewLink, RENEW_LINKS, type RenewKind, type RenewLinkConfig } from "../../data/renew-links.ts";

const RENEW_KIND: Record<string, RenewKind> = { vignette: "vignette", insurance: "go", inspection: "gtp" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renewCtaHtml(
  checkKind: string,
  style: "link" | "button",
  links: Record<RenewKind, RenewLinkConfig> = RENEW_LINKS,
): string {
  const kind = RENEW_KIND[checkKind];
  if (!kind) return "";
  const link = renewLink(kind, links);
  const cls =
    style === "button"
      ? "btn-primary mt-3 w-full sm:w-auto"
      : "mt-2 inline-block text-sm font-semibold text-accent hover:underline";
  const attrs = link.partner ? ' target="_blank" rel="sponsored nofollow noopener"' : "";
  const text = style === "button" ? link.label : `${link.label} →`;
  const disclosure = link.disclosure ? `<p class="mt-1.5 text-xs text-ink-faint" data-partner-disclosure>${esc(link.disclosure)}</p>` : "";
  return `<a href="${esc(link.href)}" class="${cls}"${attrs}>${esc(text)}</a>${disclosure}`;
}
