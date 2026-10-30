import { describe, it, expect, beforeEach } from "vitest";
import {
  activityLine,
  trackingBadge,
  stripTrackingPixels,
  trackingToast,
  getTrackingPrefs,
  setTrackingPref,
  type TrackingSummary,
} from "./tracking";

const base: TrackingSummary = {
  trackOpens: true,
  trackLinks: true,
  opens: 0,
  clicks: 0,
  firstOpenedAt: null,
  lastOpenedAt: null,
  lastClickedAt: null,
};

describe("activityLine", () => {
  it("returns null without tracking", () => {
    expect(activityLine(null)).toBeNull();
    expect(activityLine({ ...base, trackOpens: false, trackLinks: false })).toBeNull();
  });
  it("describes untouched messages", () => {
    expect(activityLine(base)).toBe("Not opened yet · No link clicks");
  });
  it("describes opens and clicks", () => {
    const now = Math.floor(Date.now() / 1000);
    const line = activityLine({ ...base, opens: 3, clicks: 1, lastOpenedAt: now - 7200 });
    expect(line).toBe("Opened 3 times · last 2h ago · 1 link click");
    expect(activityLine({ ...base, opens: 1, lastOpenedAt: now, trackLinks: false })).toBe("Opened 1 time · last Just now");
  });
});

describe("trackingBadge", () => {
  it("is hidden unless opens are tracked", () => {
    expect(trackingBadge(undefined)).toBeNull();
    expect(trackingBadge({ ...base, trackOpens: false })).toBeNull();
  });
  it("flags opened messages", () => {
    expect(trackingBadge(base)).toMatchObject({ opened: false, count: 0 });
    const b = trackingBadge({ ...base, opens: 2, firstOpenedAt: 1700000000, lastOpenedAt: 1700003600 });
    expect(b).toMatchObject({ opened: true, count: 2 });
    expect(b!.title).toContain("First opened");
    expect(b!.title).toContain("Apple Mail");
  });
});

describe("stripTrackingPixels", () => {
  it("removes our pixel only", () => {
    const html = `<p>Hi</p><img src="https://m.example.com/t/o/abc123.gif" width="1" height="1" alt="" style="display:none"><img src="https://x.com/photo.png">`;
    expect(stripTrackingPixels(html)).toBe(`<p>Hi</p><img src="https://x.com/photo.png">`);
  });
});

describe("trackingToast", () => {
  it("only announces the first open and each click", () => {
    expect(trackingToast({ event: "open", count: 1, subject: "Hello" })).toBe('Recipient opened "Hello"');
    expect(trackingToast({ event: "open", count: 2, subject: "Hello" })).toBeNull();
    expect(trackingToast({ event: "click", count: 5, subject: "Hello" })).toContain("clicked");
  });
});

describe("prefs", () => {
  beforeEach(() => localStorage.clear());
  it("defaults off and persists", () => {
    expect(getTrackingPrefs()).toEqual({ opens: false, links: false });
    setTrackingPref("opens", true);
    expect(getTrackingPrefs()).toEqual({ opens: true, links: false });
  });
});
