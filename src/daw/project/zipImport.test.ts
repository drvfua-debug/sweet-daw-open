import { describe, expect, it } from "vitest";
import { isIgnoredAudioImportEntryName } from "./zipImport";

describe("isIgnoredAudioImportEntryName", () => {
  it("ignores AppleDouble and OS metadata files before audio import", () => {
    expect(isIgnoredAudioImportEntryName("._2 Drums.wav")).toBe(true);
    expect(isIgnoredAudioImportEntryName("__MACOSX/._2 Drums.wav")).toBe(true);
    expect(isIgnoredAudioImportEntryName("stems/.DS_Store")).toBe(true);
    expect(isIgnoredAudioImportEntryName("stems/2 Drums.wav")).toBe(false);
  });
});
