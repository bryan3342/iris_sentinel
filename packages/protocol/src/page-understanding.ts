/** v0.1 private-demo protocol. No vendor, browser, or action capabilities. */
export const LIMITS = {
  bodyBytes: 1536 * 1024, imageBytes: 1024 * 1024, imageSide: 2048,
  imagePixels: 3_000_000, upstreamBytes: 256 * 1024,
  ingestionMs: 5_000, upstreamMs: 30_000, requestMs: 40_000,
} as const;
export const OPERATIONS = ['find_target', 'summarize_page', 'describe_image', 'describe_target'] as const;
export type Operation = typeof OPERATIONS[number];
export interface Rect { x: number; y: number; width: number; height: number }
export interface Viewport {
  width: number; height: number; offsetLeft: number; offsetTop: number;
  scale: number; scrollX: number; scrollY: number;
}
export interface Binding {
  tabToken: string; documentToken: string; revision: number; captureId: string;
  viewport: Viewport;
}
export interface ImageInput { mimeType: 'image/png'; data: string; width: number; height: number }
export interface NumberedTarget { id: number; role: 'link' | 'button'; rect: Rect; label?: string }
export interface PageInput {
  protocolVersion: '0.1'; requestId: string; operation: Operation; binding: Binding;
  image: ImageInput; request?: string; targets?: NumberedTarget[];
  targetsTruncated?: boolean; imageId?: number; sourceRect?: Rect; targetId?: number;
}
export type Understanding =
  | { operation: 'find_target'; targetId: number | null; explanation: string }
  /** A summary covers the visible viewport, or with a `sourceRect` only that region (where the user was looking). */
  | { operation: 'summarize_page'; scope: 'visible_viewport' | 'visible_region'; summary: string }
  | { operation: 'describe_image'; imageId: number; description: string }
  | { operation: 'describe_target'; targetId: number; description: string };
export interface PageResult {
  protocolVersion: '0.1'; requestId: string; binding: Binding; result: Understanding;
}
export interface PageUnderstanding {
  findTarget(input: PageInput, signal: AbortSignal): Promise<Understanding>;
  summarizePage(input: PageInput, signal: AbortSignal): Promise<Understanding>;
  describeImage(input: PageInput, signal: AbortSignal): Promise<Understanding>;
  describeTarget(input: PageInput, signal: AbortSignal): Promise<Understanding>;
}
export class ProtocolError extends Error { constructor() { super('Invalid page understanding data.'); } }
export function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError();
  const obj = value as Record<string, unknown>;
  if (required.some(k => !Object.hasOwn(obj, k)) || Object.keys(obj).some(k => !required.includes(k) && !optional.includes(k))) throw new ProtocolError();
  return obj;
}
export function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ProtocolError();
  return value;
}
export function token(value: unknown): string {
  const result = text(value, 80);
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(result)) throw new ProtocolError();
  return result;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new ProtocolError();
  return value;
}
export function id(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new ProtocolError();
  return value as number;
}
export function validateRect(value: unknown, viewport: Viewport): Rect {
  const r = object(value, ['x', 'y', 'width', 'height']);
  const rect = { x: number(r.x, 0, viewport.width), y: number(r.y, 0, viewport.height),
    width: number(r.width, 0.01, viewport.width), height: number(r.height, 0.01, viewport.height) };
  if (rect.x + rect.width > viewport.width + 0.01 || rect.y + rect.height > viewport.height + 0.01) throw new ProtocolError();
  return rect;
}
export function validateBinding(value: unknown): Binding {
  const b = object(value, ['tabToken', 'documentToken', 'revision', 'captureId', 'viewport']);
  const v = object(b.viewport, ['width', 'height', 'offsetLeft', 'offsetTop', 'scale', 'scrollX', 'scrollY']);
  if (!Number.isSafeInteger(b.revision) || (b.revision as number) < 0) throw new ProtocolError();
  return { tabToken: token(b.tabToken), documentToken: token(b.documentToken), revision: b.revision as number,
    captureId: token(b.captureId), viewport: { width: number(v.width, 1, 20_000), height: number(v.height, 1, 20_000),
      offsetLeft: number(v.offsetLeft, 0, 1_000_000), offsetTop: number(v.offsetTop, 0, 1_000_000),
      scale: number(v.scale, 0.1, 10), scrollX: number(v.scrollX, -1_000_000, 1_000_000), scrollY: number(v.scrollY, -1_000_000, 1_000_000) } };
}
function targets(value: unknown, max: number, viewport: Viewport): NumberedTarget[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new ProtocolError();
  const ids = new Set<number>();
  return value.map(item => {
    const target = object(item, ['id', 'role', 'rect'], ['label']);
    const targetId = id(target.id);
    if (ids.has(targetId) || !['link', 'button'].includes(target.role as string)) throw new ProtocolError();
    ids.add(targetId);
    return { id: targetId, role: target.role as 'link' | 'button', rect: validateRect(target.rect, viewport),
      ...(target.label === undefined ? {} : { label: text(target.label, 200) }) };
  });
}
export function validateInput(value: unknown): PageInput {
  const base = object(value, ['protocolVersion', 'requestId', 'operation', 'binding', 'image'],
    ['request', 'targets', 'targetsTruncated', 'imageId', 'sourceRect', 'targetId']);
  if (base.protocolVersion !== '0.1' || !(OPERATIONS as readonly unknown[]).includes(base.operation)) throw new ProtocolError();
  const operation = base.operation as Operation;
  const required = ['protocolVersion', 'requestId', 'operation', 'binding', 'image'];
  const extra = { find_target: ['request', 'targets', 'targetsTruncated'], summarize_page: [], describe_image: ['imageId', 'sourceRect'],
    describe_target: ['targets', 'targetId', 'sourceRect'] }[operation];
  // A summary may be limited to one region of the viewport.
  object(value, [...required, ...extra], operation === 'summarize_page' ? ['sourceRect'] : []);
  const binding = validateBinding(base.binding);
  const img = object(base.image, ['mimeType', 'data', 'width', 'height']);
  const width = id(img.width), height = id(img.height);
  if (img.mimeType !== 'image/png' || width > LIMITS.imageSide || height > LIMITS.imageSide || width * height > LIMITS.imagePixels) throw new ProtocolError();
  const data = text(img.data, 4 * Math.ceil(LIMITS.imageBytes / 3));
  if (data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new ProtocolError();
  const input: PageInput = { protocolVersion: '0.1', requestId: token(base.requestId), operation, binding,
    image: { mimeType: 'image/png', data, width, height } };
  if (operation === 'find_target') {
    input.request = text(base.request, 500);
    if (typeof base.targetsTruncated !== 'boolean') throw new ProtocolError();
    input.targets = targets(base.targets, 100, binding.viewport);
    input.targetsTruncated = base.targetsTruncated;
  }
  if (operation === 'describe_target') {
    // Exactly the one aimed target, identified twice so a mix-up cannot pass.
    input.targets = targets(base.targets, 1, binding.viewport);
    input.targetId = id(base.targetId);
    if (input.targets[0]!.id !== input.targetId) throw new ProtocolError();
  }
  if (operation === 'describe_image') input.imageId = id(base.imageId);
  if (operation === 'describe_image' || operation === 'describe_target' || base.sourceRect !== undefined) {
    input.sourceRect = validateRect(base.sourceRect, binding.viewport);
    if (Math.abs(width / height - input.sourceRect.width / input.sourceRect.height) > 0.05 * width / height) throw new ProtocolError();
  } else if (Math.abs(width / height - binding.viewport.width / binding.viewport.height) > 0.05 * width / height) throw new ProtocolError();
  return input;
}
export function validateUnderstanding(value: unknown, input: PageInput): Understanding {
  if (input.operation === 'find_target') {
    const r = object(value, ['operation', 'targetId', 'explanation']);
    if (r.operation !== input.operation || (r.targetId !== null && !input.targets?.some(t => t.id === r.targetId))) throw new ProtocolError();
    return { operation: input.operation, targetId: r.targetId as number | null, explanation: text(r.explanation, 500) };
  }
  if (input.operation === 'summarize_page') {
    const r = object(value, ['operation', 'scope', 'summary']);
    const scope = input.sourceRect ? 'visible_region' : 'visible_viewport';
    if (r.operation !== input.operation || r.scope !== scope) throw new ProtocolError();
    return { operation: input.operation, scope, summary: text(r.summary, 2_000) };
  }
  if (input.operation === 'describe_target') {
    const r = object(value, ['operation', 'targetId', 'description']);
    if (r.operation !== input.operation || r.targetId !== input.targetId) throw new ProtocolError();
    return { operation: input.operation, targetId: id(r.targetId), description: text(r.description, 1_500) };
  }
  const r = object(value, ['operation', 'imageId', 'description']);
  if (r.operation !== input.operation || r.imageId !== input.imageId) throw new ProtocolError();
  return { operation: input.operation, imageId: id(r.imageId), description: text(r.description, 1_500) };
}
export function validateResult(value: unknown, input: PageInput): PageResult {
  const r = object(value, ['protocolVersion', 'requestId', 'binding', 'result']);
  const binding = validateBinding(r.binding);
  if (r.protocolVersion !== '0.1' || r.requestId !== input.requestId || JSON.stringify(binding) !== JSON.stringify(input.binding)) throw new ProtocolError();
  return { protocolVersion: '0.1', requestId: input.requestId, binding, result: validateUnderstanding(r.result, input) };
}
