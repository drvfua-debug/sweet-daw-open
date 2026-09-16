const AUDIO_EXTENSIONS = new Set(["wav", "mp3", "m4a", "aac", "aif", "aiff", "flac", "ogg"]);

export type ZipAudioEntry = {
  name: string;
  file: File;
  compressedSize: number;
  uncompressedSize: number;
};

type CentralDirectoryEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

export function isZipFile(file: File) {
  return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

export function isIgnoredAudioImportEntryName(name: string) {
  const normalized = name.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const baseName = parts[parts.length - 1] ?? "";
  return (
    !baseName ||
    normalized.endsWith("/") ||
    parts.includes("__MACOSX") ||
    baseName.startsWith("._") ||
    baseName === ".DS_Store" ||
    baseName === "Thumbs.db"
  );
}

export async function expandAudioFilesFromZip(file: File): Promise<ZipAudioEntry[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const centralDirectoryOffset = findCentralDirectoryOffset(view);
  const totalEntries = view.getUint16(centralDirectoryOffset + 10, true);
  let cursor = view.getUint32(centralDirectoryOffset + 16, true);
  const entries: ZipAudioEntry[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    const entry = readCentralDirectoryEntry(bytes, view, cursor);
    cursor = entry.nextCursor;

    if (!isSupportedAudioEntry(entry.entry.name)) continue;
    const blob = await readZipEntryBlob(bytes, view, entry.entry);
    const safeName = sanitizeZipEntryName(entry.entry.name);
    entries.push({
      name: safeName,
      file: new File([blob], safeName, { type: getMimeTypeForName(safeName) }),
      compressedSize: entry.entry.compressedSize,
      uncompressedSize: entry.entry.uncompressedSize,
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

async function readZipEntryBlob(bytes: Uint8Array, view: DataView, entry: CentralDirectoryEntry) {
  const localOffset = entry.localHeaderOffset;
  if (view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new Error(`Invalid ZIP local header for ${entry.name}`);
  }

  const fileNameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  const compressed = bytes.slice(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return new Blob([compressed], { type: getMimeTypeForName(entry.name) });
  }

  if (entry.compressionMethod === 8) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser cannot decompress deflated ZIP files.");
    }
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).blob();
  }

  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}`);
}

function readCentralDirectoryEntry(bytes: Uint8Array, view: DataView, cursor: number) {
  if (view.getUint32(cursor, true) !== 0x02014b50) {
    throw new Error("Invalid ZIP central directory.");
  }

  const compressionMethod = view.getUint16(cursor + 10, true);
  const compressedSize = view.getUint32(cursor + 20, true);
  const uncompressedSize = view.getUint32(cursor + 24, true);
  const fileNameLength = view.getUint16(cursor + 28, true);
  const extraLength = view.getUint16(cursor + 30, true);
  const commentLength = view.getUint16(cursor + 32, true);
  const localHeaderOffset = view.getUint32(cursor + 42, true);
  const nameBytes = bytes.slice(cursor + 46, cursor + 46 + fileNameLength);
  const name = new TextDecoder().decode(nameBytes);
  const nextCursor = cursor + 46 + fileNameLength + extraLength + commentLength;

  return {
    entry: {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    },
    nextCursor,
  };
}

function findCentralDirectoryOffset(view: DataView) {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("ZIP central directory was not found.");
}

function isSupportedAudioEntry(name: string) {
  if (isIgnoredAudioImportEntryName(name)) return false;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSIONS.has(extension);
}

function sanitizeZipEntryName(name: string) {
  const normalized = name.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || "audio.wav";
}

function getMimeTypeForName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "wav") return "audio/wav";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a" || extension === "aac") return "audio/mp4";
  if (extension === "aif" || extension === "aiff") return "audio/aiff";
  if (extension === "flac") return "audio/flac";
  if (extension === "ogg") return "audio/ogg";
  return "audio/*";
}
