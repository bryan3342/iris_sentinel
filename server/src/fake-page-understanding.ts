import type { PageInput, PageUnderstanding, Understanding } from '../../packages/protocol/src/page-understanding';

/** Deterministic local harness, never a deployed provider or an accuracy evaluation. */
export class FakePageUnderstanding implements PageUnderstanding {
  constructor(private delayMs = 0) {}
  private async ready(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.delayMs) return;
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, this.delayMs);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  async findTarget(_input: PageInput, signal: AbortSignal): Promise<Understanding> {
    await this.ready(signal);
    return { operation: 'find_target', targetId: null, explanation: 'Synthetic provider: no actual matching was performed.' };
  }
  async summarizePage(_input: PageInput, signal: AbortSignal): Promise<Understanding> {
    await this.ready(signal);
    return { operation: 'summarize_page', scope: 'visible_viewport', summary: 'Synthetic provider: only the visible viewport was supplied; no actual summary was generated.' };
  }
  async describeImage(input: PageInput, signal: AbortSignal): Promise<Understanding> {
    await this.ready(signal);
    return { operation: 'describe_image', imageId: input.imageId!, description: 'Synthetic provider: a visible image crop was supplied; no actual description was generated.' };
  }
  async describeTarget(input: PageInput, signal: AbortSignal): Promise<Understanding> {
    await this.ready(signal);
    return { operation: 'describe_target', targetId: input.targetId!, description: 'Synthetic provider: an outlined target crop was supplied; no actual description was generated.' };
  }
}
