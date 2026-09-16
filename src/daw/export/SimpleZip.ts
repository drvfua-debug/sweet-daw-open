export type ZipEntryInput = {
  path: string;
  data: Blob | ArrayBuffer | Uint8Array | string;
  lastModified?: Date;
};

type PreparedZipEntry = {
  pathBytes: Uint8Array;
  dataBytes: Uint8Array;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dosTime: number;
  dosDate: number;
};

const textEncoder = new TextEncoder();
const CRC_TABLE = buildCrcTable();

export async function createStoredZip(entries: ZipEntryInput[]) {
  const prepared: PreparedZipEntry[] = [];
  const parts: BlobPart[] = [];
  let offset = 0;

  for (const entry of entries) {
    const pathBytes = textEncoder.encode(normalizeZipPath(entry.path));
    const dataBytes = await toUint8Array(entry.data);
    const { dosTime, dosDate } = toDosDateTime(entry.lastModified ?? new Date());
    const crc32 = computeCrc32(dataBytes);
    const localHeader = createLocalHeader(pathBytes, dataBytes.byteLength, crc32, dosTime, dosDate);

    prepared.push({
      pathBytes,
      dataBytes,
      crc32,
      compressedSize: dataBytes.byteLength,
      uncompressedSize: dataBytes.byteLength,
      localHeaderOffset: offset,
      dosTime,
      dosDate,
    });
    parts.push(localHeader, toBlobPart(pathBytes), toBlobPart(dataBytes));
    offset += localHeader.byteLength + pathBytes.byteLength + dataBytes.byteLength;
  }

  const centralDirectoryOffset = offset;
  for (const entry of prepared) {
    const centralHeader = createCentralDirectoryHeader(entry);
    parts.push(centralHeader, toBlobPart(entry.pathBytes));
    offset += centralHeader.byteLength + entry.pathBytes.byteLength;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  parts.push(createEndOfCentralDirectory(prepared.length, centralDirectorySize, centralDirectoryOffset));
  return new Blob(parts, { type: "application/zip" });
}

function normalizeZipPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function toBlobPart(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function toUint8Array(data: Blob | ArrayBuffer | Uint8Array | string) {
  if (typeof data === "string") return textEncoder.encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

function createLocalHeader(pathBytes: Uint8Array, size: number, crc32: number, dosTime: number, dosDate: number) {
  const header = new ArrayBuffer(30);
  const view = new DataView(header);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc32, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, pathBytes.byteLength, true);
  view.setUint16(28, 0, true);
  return header;
}

function createCentralDirectoryHeader(entry: PreparedZipEntry) {
  const header = new ArrayBuffer(46);
  const view = new DataView(header);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.compressedSize, true);
  view.setUint32(24, entry.uncompressedSize, true);
  view.setUint16(28, entry.pathBytes.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.localHeaderOffset, true);
  return header;
}

function createEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
  const record = new ArrayBuffer(22);
  const view = new DataView(record);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);
  return record;
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function computeCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[index] = crc >>> 0;
  }
  return table;
}
