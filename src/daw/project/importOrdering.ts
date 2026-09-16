type NamedFileLike = Pick<File, "name">;

export function sortFilesForStemImport<T extends NamedFileLike>(files: T[]): T[] {
  return files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => compareImportFiles(a.file.name, b.file.name) || a.index - b.index)
    .map((entry) => entry.file);
}

export function compareImportFiles(aName: string, bName: string): number {
  const aNumber = getLeadingStemNumber(aName);
  const bNumber = getLeadingStemNumber(bName);

  if (aNumber !== null && bNumber !== null && aNumber !== bNumber) {
    return aNumber - bNumber;
  }

  if (aNumber !== null && bNumber === null) return -1;
  if (aNumber === null && bNumber !== null) return 1;

  return aName.localeCompare(bName, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function getLeadingStemNumber(fileName: string): number | null {
  const baseName = fileName.replace(/\.[^.]+$/, "").trim();
  const match = baseName.match(/^(\d+)(?:$|[\s_.-])/);
  if (!match?.[1]) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function hasLeadingStemNumber(fileName: string) {
  return getLeadingStemNumber(fileName) !== null;
}
