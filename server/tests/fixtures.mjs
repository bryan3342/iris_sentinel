import { deflateSync } from 'node:zlib';
import { webcrypto } from 'node:crypto';
import { modules } from './modules.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

export function png(width = 2, height = 2, overrides = {}) {
  function chunk(type, data) {
    const contents = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of contents) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length);
    contents.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return result;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = overrides.rows ?? Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    ...(overrides.extra ? [chunk(overrides.extra, Buffer.from('private'))] : []),
    chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
export const input = (operation = 'find_target') => ({
  protocolVersion: '0.1', requestId: 'request_abcdefghijklmnop', operation,
  binding: { tabToken: 'tab_abcdefghijklmnop', documentToken: 'doc_abcdefghijklmnop', revision: 1, captureId: 'capture_abcdefghijklmnop',
    viewport: { width: 2, height: 2, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 } },
  image: { mimeType: 'image/png', width: 2, height: 2, data: png() },
  ...(operation === 'find_target' ? { request: 'Find the icon', targets: [{ id: 7, role: 'button', rect: { x: 0, y: 0, width: 1, height: 1 } }], targetsTruncated: false } : {}),
  ...(operation === 'describe_image' ? { imageId: 3, sourceRect: { x: 0, y: 0, width: 2, height: 2 } } : {}),
});
export const result = operation => operation === 'find_target' ? { operation, targetId: 7, explanation: 'The supplied icon matches.' }
  : operation === 'summarize_page' ? { operation, scope: 'visible_viewport', summary: 'Only the visible viewport: a synthetic page.' }
  : { operation, imageId: 3, description: 'A synthetic image crop.' };
