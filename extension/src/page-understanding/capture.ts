import { LIMITS, object, token, validateBinding, validateRect, type ImageInput, type NumberedTarget, type Rect } from '@iris/protocol';
import type { PageSnapshot, PageTargets } from './page-helper';

export function eligibleTab(tab: { incognito?: boolean; url?: string; pendingUrl?: string }): boolean {
  if (tab.incognito || !tab.url || tab.pendingUrl) return false;
  try {
    const url = new URL(tab.url);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname !== 'chromewebstore.google.com' &&
      !(url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'));
  } catch { return false; }
}
/** Validates what a page reported about its targets. Shared by page understanding and gaze. */
export function validateTargets(value: unknown, gaze = false): PageTargets {
  const s = object(value, ['documentToken', 'revision', 'viewport', 'targets', 'targetsTruncated']);
  const b = validateBinding({ tabToken: 'abcdefghijklmnop', documentToken: s.documentToken, revision: s.revision, captureId: 'abcdefghijklmnop', viewport: s.viewport });
  if (!Array.isArray(s.targets) || s.targets.length > 100 || typeof s.targetsTruncated !== 'boolean') throw new Error('INVALID_SNAPSHOT');
  const ids = new Set<number>();
  const targets = s.targets.map(value => {
    // Gaze targets carry a risk flag and no label; page understanding's carry neither flag nor anything new.
    const t = gaze ? object(value, ['id', 'role', 'rect', 'risky']) : object(value, ['id', 'role', 'rect'], ['label']);
    if (!['link', 'button'].includes(t.role as string) || (t.label !== undefined && (typeof t.label !== 'string' || !t.label.trim() || t.label.length > 200)) ||
      (gaze && typeof t.risky !== 'boolean')) throw new Error('INVALID_SNAPSHOT');
    return { id: positiveId(t.id, ids), role: t.role as NumberedTarget['role'], rect: validateRect(t.rect, b.viewport),
      ...(t.label === undefined ? {} : { label: t.label as string }), ...(gaze ? { risky: t.risky as boolean } : {}) };
  });
  return { documentToken: token(s.documentToken), revision: b.revision, viewport: b.viewport, targets, targetsTruncated: s.targetsTruncated };
}
function positiveId(value: unknown, ids: Set<number>): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || ids.has(value as number)) throw new Error('INVALID_SNAPSHOT');
  ids.add(value as number); return value as number;
}
export function validateSnapshot(value: unknown): PageSnapshot {
  const s = object(value, ['documentToken', 'revision', 'viewport', 'targets', 'targetsTruncated', 'images', 'masks', 'blocked']);
  const base = validateTargets({ documentToken: s.documentToken, revision: s.revision, viewport: s.viewport, targets: s.targets, targetsTruncated: s.targetsTruncated });
  if (!Array.isArray(s.images) || s.images.length > 100 || !Array.isArray(s.masks) || s.masks.length > 1000 || typeof s.blocked !== 'boolean') throw new Error('INVALID_SNAPSHOT');
  const imageIds = new Set<number>();
  return { ...base, blocked: s.blocked,
    images: s.images.map(value => { const i = object(value, ['id', 'rect']); return { id: positiveId(i.id, imageIds), rect: validateRect(i.rect, base.viewport) }; }),
    masks: s.masks.map(value => validateRect(value, base.viewport)) };
}
export function assertSameSnapshot(before: PageSnapshot, after: PageSnapshot): void {
  if (after.blocked || JSON.stringify(before) !== JSON.stringify(after)) throw new Error('PAGE_CHANGED');
}
export function maskPixels(context: CanvasRenderingContext2D, masks: Rect[], scaleX: number, scaleY: number): void {
  context.fillStyle = '#000';
  for (const rect of masks) {
    const x = Math.floor(rect.x * scaleX), y = Math.floor(rect.y * scaleY);
    context.fillRect(x, y, Math.ceil((rect.x + rect.width) * scaleX) - x, Math.ceil((rect.y + rect.height) * scaleY) - y);
  }
}
/** Local bitmap processing only. No URLs fetched from page/model data. */
export async function prepareImage(dataUrl: string, snapshot: PageSnapshot, crop?: Rect, numbered = false): Promise<ImageInput> {
  if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 32 * 1024 * 1024) throw new Error('INVALID_CAPTURE');
  const binary = atob(dataUrl.slice('data:image/png;base64,'.length));
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: 'image/png' }));
  const canvas = document.createElement('canvas'), output = document.createElement('canvas');
  try {
    if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 32_000_000 ||
      Math.abs(bitmap.width / bitmap.height - snapshot.viewport.width / snapshot.viewport.height) > 0.02 * bitmap.width / bitmap.height) throw new Error('UNSUPPORTED_VIEWPORT');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('CAPTURE_UNAVAILABLE');
    context.drawImage(bitmap, 0, 0);
    const sx = bitmap.width / snapshot.viewport.width, sy = bitmap.height / snapshot.viewport.height;
    maskPixels(context, snapshot.masks, sx, sy);
    const rect = crop ?? { x: 0, y: 0, width: snapshot.viewport.width, height: snapshot.viewport.height };
    const sourceWidth = rect.width * sx, sourceHeight = rect.height * sy;
    let factor = Math.min(1, LIMITS.imageSide / sourceWidth, LIMITS.imageSide / sourceHeight, Math.sqrt(LIMITS.imagePixels / (sourceWidth * sourceHeight)));
    for (let attempt = 0; attempt < 5; attempt++, factor *= 0.75) {
      output.width = Math.max(1, Math.floor(sourceWidth * factor)); output.height = Math.max(1, Math.floor(sourceHeight * factor));
      const dest = output.getContext('2d'); if (!dest) throw new Error('CAPTURE_UNAVAILABLE');
      dest.drawImage(canvas, rect.x * sx, rect.y * sy, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
      if (numbered) {
        // Map viewport coordinates into the (possibly cropped) output bitmap.
        const tx = output.width / rect.width, ty = output.height / rect.height;
        dest.font = 'bold 14px sans-serif'; dest.textBaseline = 'top';
        for (const target of snapshot.targets) {
          const left = (target.rect.x - rect.x) * tx, top = (target.rect.y - rect.y) * ty;
          if (left + 30 <= 0 || top + 18 <= 0 || left >= output.width || top >= output.height) continue;
          const x = Math.min(output.width - 30, Math.max(0, left));
          const y = Math.min(output.height - 18, Math.max(0, top));
          dest.fillStyle = '#fff'; dest.fillRect(x, y, 30, 18); dest.fillStyle = '#000'; dest.fillText(String(target.id), x + 2, y + 1);
        }
      }
      const data = output.toDataURL('image/png').slice('data:image/png;base64,'.length);
      if (data.length <= 4 * Math.ceil(LIMITS.imageBytes / 3)) return { mimeType: 'image/png', width: output.width, height: output.height, data };
    }
    throw new Error('IMAGE_TOO_LARGE');
  } finally { bitmap.close(); canvas.width = canvas.height = output.width = output.height = 0; }
}
