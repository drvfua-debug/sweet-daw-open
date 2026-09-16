import { describe, expect, it } from "vitest";
import { createTrack } from "../../daw/model/Project";
import { hasSoloTrack, isReferenceTrack, isTrackAudible } from "./TrackGraph";

describe("TrackGraph reference safety", () => {
  it("treats reference tracks as analysis-only even when unmuted or soloed", () => {
    const reference = createTrack("Reference Mix", 0, "reference", "reference");
    const vocal = createTrack("Lead Vocal", 1, "vocal", "vocal");
    reference.mute = false;
    reference.solo = true;

    expect(isReferenceTrack(reference)).toBe(true);
    expect(hasSoloTrack([reference, vocal])).toBe(false);
    expect(isTrackAudible(reference, false)).toBe(false);
    expect(isTrackAudible(vocal, hasSoloTrack([reference, vocal]))).toBe(true);
  });
});
