import { writable, get } from "svelte/store";

export type ThemePreference = "light" | "system" | "dark";
export const THEME_ORDER: ThemePreference[] = ["light", "system", "dark"];
const KEY = "settings.theme";

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "dark";
}

export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref !== "system") return pref;
  if (typeof matchMedia === "undefined") return "dark";
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export const themePreference = writable<ThemePreference>(
  typeof localStorage === "undefined" ? "dark" : readStored(),
);

function apply(pref: ThemePreference) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveTheme(pref);
  if (root.getAttribute("data-theme") === resolved) return;
  // Suppress transitions so the swap is instant (no colour flash)
  root.setAttribute("data-theme-switching", "");
  root.setAttribute("data-theme", resolved);
  void root.offsetHeight;
  requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
}

if (typeof window !== "undefined") {
  themePreference.subscribe((pref) => {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      // ignore
    }
    apply(pref);
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (get(themePreference) === "system") apply("system");
  });
}

export function cycleTheme() {
  themePreference.update((p) => THEME_ORDER[(THEME_ORDER.indexOf(p) + 1) % THEME_ORDER.length]);
}
