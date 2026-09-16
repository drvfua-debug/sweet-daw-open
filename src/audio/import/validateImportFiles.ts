export const IMPORT_LIMITS = {
  maxFiles: 12,
  maxSingleFileBytes: 250 * 1024 * 1024,
  maxTotalBytes: 900 * 1024 * 1024,
};

export type ImportValidationIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  fileName?: string;
};

const KNOWN_AUDIO_EXTENSIONS = new Set([
  "wav",
  "wave",
  "aif",
  "aiff",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "oga",
  "webm",
]);

export function validateImportFiles(files: File[]): ImportValidationIssue[] {
  const issues: ImportValidationIssue[] = [];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  if (files.length > IMPORT_LIMITS.maxFiles) {
    issues.push({
      level: "error",
      code: "too-many-files",
      message: `Import is limited to ${IMPORT_LIMITS.maxFiles} audio files at once on mobile Safari.`,
    });
  }

  if (totalBytes > IMPORT_LIMITS.maxTotalBytes) {
    issues.push({
      level: "warning",
      code: "total-size-large",
      message: `Selected audio is ${(totalBytes / 1024 / 1024).toFixed(1)} MB. iPhone Safari may run out of memory.`,
    });
  }

  for (const file of files) {
    if (file.size <= 0) {
      issues.push({
        level: "error",
        code: "empty-file",
        fileName: file.name,
        message: `${file.name} is empty and cannot be decoded.`,
      });
      continue;
    }

    if (file.size > IMPORT_LIMITS.maxSingleFileBytes) {
      issues.push({
        level: "warning",
        code: "single-file-large",
        fileName: file.name,
        message: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. Decode may be unstable on iPhone Safari.`,
      });
    }

    if (!isLikelyBrowserAudioFile(file)) {
      issues.push({
        level: "warning",
        code: "unknown-audio-type",
        fileName: file.name,
        message: `${file.name} has an unknown audio type. The browser may fail to decode it.`,
      });
    }
  }

  return issues;
}

export function hasBlockingImportIssue(issues: ImportValidationIssue[]) {
  return issues.some((issue) => issue.level === "error");
}

export function summarizeImportValidationIssues(issues: ImportValidationIssue[]) {
  const firstError = issues.find((issue) => issue.level === "error");
  if (firstError) return firstError.message;
  const firstWarning = issues.find((issue) => issue.level === "warning");
  if (firstWarning) return firstWarning.message;
  return null;
}

function isLikelyBrowserAudioFile(file: File) {
  if (file.type.startsWith("audio/")) return true;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return KNOWN_AUDIO_EXTENSIONS.has(extension);
}
