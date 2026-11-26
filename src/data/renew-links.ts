/**
 * Връзката „какво да направя сега“ за всеки вид срок: към собствена страница
 * на сайта или — ако е договорено партньорство — към партньор.
 *
 * Ползва се от напомнянията по имейл (src/lib/reminders/email.ts) и от картите
 * с резултат (PlateCheck.astro, gtp-client.ts). Това е единственото място,
 * където се добавя партньорски линк:
 *
 *   partnerUrl:  пълният URL при партньора (празно = връзката води към `path`)
 *   partnerName: името му, както да се изпише в разкритието
 *
 * Щом partnerUrl е зададен, навсякъде, където връзката се показва, се добавя
 * разкритието от renewLink().disclosure („Връзката е партньорска: …“), а самата
 * връзка е с rel="sponsored". Без партньор няма разкритие и нищо не се променя.
 */

export type RenewKind = "vignette" | "gtp" | "go";

export interface RenewLinkConfig {
  /** Страница на сайта — целта по подразбиране */
  path: string;
  label: string;
  partnerUrl: string;
  partnerName: string;
}

export const RENEW_LINKS: Record<RenewKind, RenewLinkConfig> = {
  vignette: { path: "/vinetka/kupi", label: "Купи винетка онлайн", partnerUrl: "", partnerName: "" },
  gtp: { path: "/gtp/cena", label: "Виж цените за ГТП", partnerUrl: "", partnerName: "" },
  go: {
    path: "/grazhdanska-otgovornost/proverka#oferti",
    label: "Сравни оферти за ГО",
    partnerUrl: "",
    partnerName: "",
  },
};

export interface RenewLink {
  /** Път в сайта или пълен URL при партньор */
  href: string;
  label: string;
  partner: boolean;
  /** Текст за показване до връзката; null, когато връзката не е партньорска */
  disclosure: string | null;
}

export function renewLink(kind: RenewKind, links: Record<RenewKind, RenewLinkConfig> = RENEW_LINKS): RenewLink {
  const cfg = links[kind];
  const partnerUrl = cfg.partnerUrl.trim();
  if (!partnerUrl) return { href: cfg.path, label: cfg.label, partner: false, disclosure: null };
  const who = cfg.partnerName.trim() || new URL(partnerUrl).hostname.replace(/^www\./, "");
  return {
    href: partnerUrl,
    label: cfg.label,
    partner: true,
    disclosure: `Връзката е партньорска: при покупка през нея получаваме комисиона от ${who}.`,
  };
}
