import sharp from "sharp";

/** Walk the complete JPEG framing, including scan escapes. Decoders may otherwise
 * silently ignore a second image or trailing payload after the first EOI. */
function framed(bytes: Buffer): boolean {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return false;
  let offset = 2;
  let scan = false;
  while (offset < bytes.length) {
    if (scan) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
    }
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) return false;
    if (scan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    scan = false;
    if (marker === 0xd9) return offset === bytes.length;
    if (marker === 0xd8 || marker === 0 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    offset += length;
    if (marker === 0xda) scan = true;
  }
  return false;
}

/** Native asynchronous decode, bounded before allocation and by a decode timeout. */
export async function validateJpeg(bytes: Buffer, maxWidth: number, maxHeight: number) {
  if (!framed(bytes)) throw new Error("invalid JPEG framing");
  const input = sharp(bytes, { failOn: "warning", limitInputPixels: maxWidth * maxHeight, sequentialRead: true });
  const metadata = await input.metadata();
  if (metadata.format !== "jpeg" || !metadata.width || !metadata.height || metadata.width > maxWidth || metadata.height > maxHeight) {
    throw new Error("invalid JPEG dimensions");
  }
  // Force complete decoding; a valid header alone does not establish a valid image.
  await input.timeout({ seconds: 2 }).raw().toBuffer();
  return { width: metadata.width, height: metadata.height };
}
