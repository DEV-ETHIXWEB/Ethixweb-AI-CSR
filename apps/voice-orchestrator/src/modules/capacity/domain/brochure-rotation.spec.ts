import { selectBrochureSegment } from "./brochure-rotation";
import type { VoiceBrochureConfig } from "./capacity-config";

function config(overrides: Partial<VoiceBrochureConfig> = {}): VoiceBrochureConfig {
  return {
    enabled: true,
    businessName: "All Phase Plumbing",
    segments: [
      { id: "seg-1", text: "Thanks for calling All Phase Plumbing." },
      { id: "seg-2", text: "We offer 24/7 emergency plumbing." },
      { id: "seg-3", text: "We serve the greater metro area." },
    ],
    rotationIntervalMs: 15_000,
    ...overrides,
  };
}

describe("selectBrochureSegment", () => {
  it("returns null when the brochure is disabled — never plays disabled tenant content", () => {
    expect(selectBrochureSegment(config({ enabled: false }), 0)).toBeNull();
  });

  it("returns null when no segments are configured, even if enabled", () => {
    expect(selectBrochureSegment(config({ segments: [] }), 5000)).toBeNull();
  });

  it("returns the first segment at waitedMs=0", () => {
    expect(selectBrochureSegment(config(), 0)?.id).toBe("seg-1");
  });

  it("rotates to the next segment after one rotation interval elapses", () => {
    expect(selectBrochureSegment(config(), 15_000)?.id).toBe("seg-2");
    expect(selectBrochureSegment(config(), 30_000)?.id).toBe("seg-3");
  });

  it("wraps around rather than running out of segments — never repeats the same message continuously without rotating through the set first", () => {
    expect(selectBrochureSegment(config(), 45_000)?.id).toBe("seg-1");
  });

  it("only ever returns tenant-approved segments — never fabricates content not present in config", () => {
    const segment = selectBrochureSegment(config(), 0);
    expect(config().segments.map((s) => s.id)).toContain(segment?.id);
  });
});
