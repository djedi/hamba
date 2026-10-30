import { describe, it, expect } from "vitest";
import { getInitials, pickAvatarSource } from "./accountAppearance";

const acc = (o: Record<string, unknown>) => ({ email: "jane.doe@example.com", name: "", display_name: null, ...o }) as never;

describe("getInitials", () => {
  it("uses first and last word of display name", () => {
    expect(getInitials(acc({ display_name: "jane q doe" }))).toBe("JD");
  });
  it("single word gives one letter", () => {
    expect(getInitials(acc({ name: "madonna" }))).toBe("M");
  });
  it("prefers display_name over name", () => {
    expect(getInitials(acc({ display_name: "Bob Ross", name: "Zed" }))).toBe("BR");
  });
  it("falls back to email local part", () => {
    expect(getInitials(acc({}))).toBe("J");
    expect(getInitials(acc({ name: "  " }))).toBe("J");
  });
});

describe("pickAvatarSource", () => {
  it("upload beats gravatar", () => {
    expect(pickAvatarSource({ has_avatar: true }, "ok")).toBe("upload");
  });
  it("gravatar when unknown or ok", () => {
    expect(pickAvatarSource({ has_avatar: false }, undefined)).toBe("gravatar");
    expect(pickAvatarSource({}, "ok")).toBe("gravatar");
  });
  it("initials when gravatar missing", () => {
    expect(pickAvatarSource({ has_avatar: false }, "none")).toBe("initials");
  });
});
