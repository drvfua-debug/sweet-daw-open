import { describe, expect, it } from "vitest";
import { createStoredZip } from "./SimpleZip";

describe("createStoredZip", () => {
  it("creates a standard stored zip with local and central directory records", async () => {
    const blob = await createStoredZip([
      { path: "meta/export_manifest.json", data: "{\"ok\":true}" },
      { path: "stems_processed/00_vocal_processed.wav", data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(blob.type).toBe("application/zip");
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(findSignature(bytes, [0x50, 0x4b, 0x01, 0x02])).toBeGreaterThan(0);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 22 + 8, true)).toBe(2);
  });
});

function findSignature(bytes: Uint8Array, signature: number[]) {
  for (let index = 0; index <= bytes.length - signature.length; index += 1) {
    if (signature.every((value, offset) => bytes[index + offset] === value)) return index;
  }
  return -1;
}
