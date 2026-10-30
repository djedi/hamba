import type { Account } from "./api";

/** Keep in sync with PALETTE in backend/src/appearance.rs */
export const ACCOUNT_COLORS = [
  "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#b45309",
  "#15803d", "#0f766e", "#0891b2", "#4f46e5", "#a21caf", "#475569",
];

export const DEFAULT_ACCOUNT_COLOR = "#475569";

type NameSource = Pick<Account, "email" | "name" | "display_name">;

/** First letters of the first and last word of the display name (max 2), else email local part's first letter */
export function getInitials(account: NameSource): string {
  const name = (account.display_name || account.name || "").trim();
  const words = name.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length > 0) {
    const first = Array.from(words[0])[0];
    const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
    return (first + last).toUpperCase();
  }
  const local = account.email.split("@")[0] || account.email;
  return (Array.from(local.trim())[0] ?? "?").toUpperCase();
}

export type AvatarSource = "upload" | "gravatar" | "initials";

/** Uploaded image wins, then Gravatar (when not known to be missing), then initials */
export function pickAvatarSource(
  account: Pick<Account, "has_avatar">,
  gravatar: "ok" | "none" | undefined
): AvatarSource {
  if (account.has_avatar) return "upload";
  if (gravatar !== "none") return "gravatar";
  return "initials";
}

// --- Gravatar -------------------------------------------------------------

const STORAGE_KEY = "hamba:gravatar";
const gravatarCache = new Map<string, "ok" | "none">();
const hashCache = new Map<string, string>();
const inflight = new Map<string, Promise<"ok" | "none">>();
let loaded = false;

function loadStored() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
        if (v === "ok" || v === "none") gravatarCache.set(k, v);
      }
    }
  } catch {
    // ignore
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(gravatarCache)));
  } catch {
    // ignore
  }
}

export function getCachedGravatar(email: string): "ok" | "none" | undefined {
  loadStored();
  return gravatarCache.get(email.trim().toLowerCase());
}

export async function gravatarHash(email: string): Promise<string> {
  const key = email.trim().toLowerCase();
  const hit = hashCache.get(key);
  if (hit) return hit;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  hashCache.set(key, hex);
  return hex;
}

export function gravatarUrl(hash: string, size: number): string {
  return `https://gravatar.com/avatar/${hash}?s=${size * 2}&d=404`;
}

/** Resolve whether the email has a Gravatar; result cached per email (memory + localStorage) */
export function checkGravatar(email: string, size: number): Promise<"ok" | "none"> {
  const key = email.trim().toLowerCase();
  const cached = getCachedGravatar(key);
  if (cached) return Promise.resolve(cached);
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      try {
        const url = gravatarUrl(await gravatarHash(key), size);
        const result = await new Promise<"ok" | "none">((resolve) => {
          const img = new Image();
          img.onload = () => resolve("ok");
          img.onerror = () => resolve("none");
          img.src = url;
        });
        gravatarCache.set(key, result);
        persist();
        return result;
      } catch {
        return "none" as const;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  return p;
}

/** Test helper */
export function _resetGravatarCache() {
  gravatarCache.clear();
  hashCache.clear();
  inflight.clear();
  loaded = false;
}
