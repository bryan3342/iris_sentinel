import { LIMITS, type ImageInput } from '../../packages/protocol/src/page-understanding';
import { HttpError, readBytes } from './http';

function invalid(): never { throw new HttpError(400, 'INVALID_IMAGE'); }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Canvas PNG subset: 8-bit RGB/RGBA, noninterlaced, no animation or text chunks.
 * Checks CRCs and bounded inflation including scanline filters, not just headers.
 */
export async function validatePng(image: ImageInput, signal: AbortSignal): Promise<void> {
  let binary: string;
  try { binary = atob(image.data); } catch { invalid(); }
  if (binary.length > LIMITS.imageBytes || btoa(binary) !== image.data) invalid();
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (bytes.length < 45 || bytes.slice(0, 8).some((b, i) => b !== [137, 80, 78, 71, 13, 10, 26, 10][i])) invalid();
  const view = new DataView(bytes.buffer); const compressed: Uint8Array[] = [];
  const ancillary = new Set<string>();
  let offset = 8, channels = 0, ended = false;
  while (offset < bytes.length) {
    signal.throwIfAborted();
    if (offset + 12 > bytes.length) invalid();
    const length = view.getUint32(offset);
    if (length > LIMITS.imageBytes || offset + length + 12 > bytes.length) invalid();
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) invalid();
    if (offset === 8 && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13 || view.getUint32(offset + 8) !== image.width || view.getUint32(offset + 12) !== image.height ||
        data[8] !== 8 || ![2, 6].includes(data[9]) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) invalid();
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      if (!channels) invalid();
      compressed.push(data);
    } else if (type === 'IEND') {
      if (length !== 0 || compressed.length === 0 || offset + 12 !== bytes.length) invalid();
      ended = true;
    } else {
      if (!['sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(type) || ancillary.has(type) || compressed.length) invalid();
      if (type === 'sRGB' && (length !== 1 || data[0] > 3) ||
        type === 'gAMA' && (length !== 4 || view.getUint32(offset + 8) === 0) ||
        type === 'cHRM' && length !== 32 || type === 'pHYs' && (length !== 9 || data[8] > 1)) invalid();
      ancillary.add(type);
    }
    offset += length + 12;
  }
  if (!ended) invalid();
  const size = compressed.reduce((n, part) => n + part.length, 0);
  const packed = new Uint8Array(size); let position = 0;
  for (const part of compressed) { packed.set(part, position); position += part.length; }
  const stride = image.width * channels + 1, expected = stride * image.height;
  try {
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'));
    const raw = await readBytes(stream, expected, signal);
    if (raw.length !== expected) invalid();
    for (let row = 0; row < image.height; row++) if (raw[row * stride] > 4) invalid();
  } catch (error) {
    if (signal.aborted) throw new HttpError(504, 'TIMEOUT');
    invalid();
  }
}
