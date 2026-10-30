/**
 * Helpers for read receipts / link tracking in the UI.
 */
import { formatRelativeDate } from "./dateUtils";

export interface TrackingSummary {
  trackOpens: boolean;
  trackLinks: boolean;
  opens: number;
  clicks: number;
  firstOpenedAt: number | null;
  lastOpenedAt: number | null;
  lastClickedAt: number | null;
}

export interface TrackingEvent {
  type: "open" | "click";
  url: string | null;
  createdAt: number;
  userAgent: string | null;
}

export const PRIVACY_NOTE =
  "Opens can be inaccurate: Apple Mail Privacy Protection and image proxies may report false opens, and blocked images are never counted.";

export const TRACKING_UNAVAILABLE =
  "Tracking needs a public URL. Set PUBLIC_URL on the backend (e.g. a tunnel to port 8877) and restart.";

const OPENS_KEY = "settings.trackOpens";
const LINKS_KEY = "settings.trackLinks";

export function getTrackingPrefs(): { opens: boolean; links: boolean } {
  try {
    return {
      opens: localStorage.getItem(OPENS_KEY) === "true",
      links: localStorage.getItem(LINKS_KEY) === "true",
    };
  } catch {
    return { opens: false, links: false };
  }
}

export function setTrackingPref(kind: "opens" | "links", value: boolean): void {
  try {
    localStorage.setItem(kind === "opens" ? OPENS_KEY : LINKS_KEY, String(value));
  } catch {
    // storage unavailable
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Opened 3 times · last 2h ago · 1 link click" (null when nothing is tracked) */
export function activityLine(t: TrackingSummary | null | undefined): string | null {
  if (!t || (!t.trackOpens && !t.trackLinks)) return null;
  const parts: string[] = [];
  if (t.trackOpens) {
    if (t.opens > 0) {
      parts.push(`Opened ${plural(t.opens, "time", "times")}`);
      if (t.lastOpenedAt) parts.push(`last ${formatRelativeDate(t.lastOpenedAt)}`);
    } else {
      parts.push("Not opened yet");
    }
  }
  if (t.trackLinks) {
    parts.push(t.clicks > 0 ? plural(t.clicks, "link click", "link clicks") : "No link clicks");
  }
  return parts.join(" · ");
}

const fmtTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Sent-list badge: shown only when opens are tracked */
export function trackingBadge(t: TrackingSummary | null | undefined): { opened: boolean; count: number; title: string } | null {
  if (!t || !t.trackOpens) return null;
  if (t.opens === 0) return { opened: false, count: 0, title: `Not opened yet. ${PRIVACY_NOTE}` };
  const first = t.firstOpenedAt ? `First opened ${fmtTime(t.firstOpenedAt)}` : "";
  const last = t.lastOpenedAt && t.opens > 1 ? `, last ${fmtTime(t.lastOpenedAt)}` : "";
  return { opened: true, count: t.opens, title: `${first}${last}. ${PRIVACY_NOTE}` };
}

/** Remove our own tracking pixels so viewing a sent message never counts as an open */
export function stripTrackingPixels(html: string): string {
  return html.replace(/<img\b[^>]*\bsrc\s*=\s*["'][^"']*\/t\/o\/[A-Za-z0-9]+\.gif[^"']*["'][^>]*>/gi, "");
}

/** Toast text for a realtime tracking event (null = stay quiet, e.g. repeat opens) */
export function trackingToast(data: { event: string; count: number; subject?: string }): string | null {
  const subject = data.subject || "your email";
  if (data.event === "open") return data.count === 1 ? `Recipient opened "${subject}"` : null;
  if (data.event === "click") return `Recipient clicked a link in "${subject}"`;
  return null;
}
