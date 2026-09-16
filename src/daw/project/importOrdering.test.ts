import { describe, expect, it } from "vitest";
import { sortFilesForStemImport } from "./importOrdering";

describe("sortFilesForStemImport", () => {
  it("keeps Suno-style numeric stems in track order", () => {
    const files = [
      { name: "10.wav" },
      { name: "2.wav" },
      { name: "0.wav" },
      { name: "1.wav" },
    ];

    expect(sortFilesForStemImport(files).map((file) => file.name)).toEqual([
      "0.wav",
      "1.wav",
      "2.wav",
      "10.wav",
    ]);
  });

  it("uses natural sorting for named files", () => {
    const files = [
      { name: "stem 10.wav" },
      { name: "stem 2.wav" },
      { name: "bass.wav" },
    ];

    expect(sortFilesForStemImport(files).map((file) => file.name)).toEqual([
      "bass.wav",
      "stem 2.wav",
      "stem 10.wav",
    ]);
  });
});
