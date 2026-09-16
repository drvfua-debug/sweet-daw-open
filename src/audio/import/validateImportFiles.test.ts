import { describe, expect, it } from "vitest";
import { IMPORT_LIMITS, validateImportFiles } from "./validateImportFiles";

function makeFile(name: string, size: number, type = "") {
  return { name, size, type } as File;
}

describe("validateImportFiles", () => {
  it("blocks more than 12 files at once", () => {
    const files = Array.from({ length: IMPORT_LIMITS.maxFiles + 1 }, (_, index) =>
      makeFile(`${index}_stem.wav`, 4, "audio/wav"),
    );

    expect(validateImportFiles(files).some((issue) => issue.code === "too-many-files" && issue.level === "error")).toBe(true);
  });

  it("blocks empty files", () => {
    const issues = validateImportFiles([makeFile("empty.wav", 0, "audio/wav")]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "empty-file",
          level: "error",
        }),
      ]),
    );
  });

  it("allows known audio extensions even when MIME is empty", () => {
    const issues = validateImportFiles([makeFile("2 Drums.wav", 4)]);

    expect(issues.some((issue) => issue.code === "unknown-audio-type")).toBe(false);
  });

  it("warns on unknown browser audio types", () => {
    const issues = validateImportFiles([makeFile("maybe-audio.bin", 4)]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unknown-audio-type",
          level: "warning",
        }),
      ]),
    );
  });

  it("warns when total import size is large", () => {
    const files = [
      makeFile("a.wav", IMPORT_LIMITS.maxTotalBytes / 2 + 1, "audio/wav"),
      makeFile("b.wav", IMPORT_LIMITS.maxTotalBytes / 2 + 1, "audio/wav"),
    ];

    expect(validateImportFiles(files).some((issue) => issue.code === "total-size-large")).toBe(true);
  });
});
