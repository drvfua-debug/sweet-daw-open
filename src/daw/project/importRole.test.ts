import { describe, expect, it } from "vitest";
import { inferNewAudioImportRole } from "./importRole";

describe("inferNewAudioImportRole", () => {
  it("keeps Suno-style numeric stems on their musical role", () => {
    expect(inferNewAudioImportRole("0 Lead Vocals.wav")).toBe("vocal");
    expect(inferNewAudioImportRole("1 Backing Vocals.wav")).toBe("backingVocal");
    expect(inferNewAudioImportRole("2 Drums.wav")).toBe("drums");
    expect(inferNewAudioImportRole("3 Bass.wav")).toBe("bass");
  });

  it("treats song-title direct WAV files as reference material", () => {
    expect(inferNewAudioImportRole("Firelit.wav")).toBe("reference");
    expect(inferNewAudioImportRole("ナリヒビク.wav")).toBe("reference");
    expect(inferNewAudioImportRole("My Song final mix.wav")).toBe("reference");
  });
});
