import { readable, writable } from "svelte/store";

/** Matches the CSS breakpoint used for the phone layout (app.css) */
export const MOBILE_QUERY = "(max-width: 768px)";

/** True on phone-sized screens; updates on resize/rotation */
export const isMobile = readable(false, (set) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  const mq = window.matchMedia(MOBILE_QUERY);
  set(mq.matches);
  const onChange = (e: MediaQueryListEvent) => set(e.matches);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
});

/** Slide-out navigation (account rail + sidebar) on phones */
export const isNavDrawerOpen = writable(false);

export const SWIPE_THRESHOLD = 80; // px past which a row swipe commits
export const LONG_PRESS_MS = 450;

/**
 * Horizontal swipe tracking for a touch row. Vertical movement hands control
 * back to the scroller; returns the committed direction on end.
 */
export function createSwipe() {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let mode: "idle" | "pending" | "swiping" | "scrolling" = "idle";

  return {
    get dx() {
      return dx;
    },
    get swiping() {
      return mode === "swiping";
    },
    get scrolling() {
      return mode === "scrolling";
    },
    start(x: number, y: number) {
      startX = x;
      startY = y;
      dx = 0;
      mode = "pending";
    },
    /** Returns true once the gesture is a horizontal swipe */
    move(x: number, y: number): boolean {
      if (mode === "pending") {
        const ax = Math.abs(x - startX);
        const ay = Math.abs(y - startY);
        if (ax < 10 && ay < 10) return false;
        mode = ax > ay * 1.5 ? "swiping" : "scrolling";
      }
      if (mode !== "swiping") return false;
      dx = x - startX;
      return true;
    },
    end(): "left" | "right" | null {
      const committed = mode === "swiping" && Math.abs(dx) >= SWIPE_THRESHOLD ? (dx > 0 ? "right" : "left") : null;
      mode = "idle";
      dx = 0;
      return committed;
    },
    cancel() {
      mode = "idle";
      dx = 0;
    },
  };
}

/**
 * Track the visible viewport height in --app-height so the layout shrinks
 * above the on-screen keyboard (iOS doesn't resize the layout viewport).
 */
export function initViewportHeight(): () => void {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return () => {};
  const update = () => document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
  update();
  vv.addEventListener("resize", update);
  return () => vv.removeEventListener("resize", update);
}
