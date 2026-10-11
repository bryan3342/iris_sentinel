import type { Rect } from '@iris/protocol';
import type { SelectResult } from '../content/select';
import type { PickResult } from './gaze-panel';
import { isRisky } from './gaze-session';
import type { TargetList } from './target-list';

type Target = TargetList['targets'][number];
/** What a spoken request to open a target led to: opened, picked for the person's confirm, or nothing. */
export type OpenResult = 'OPENED' | 'STALE' | PickResult;

export interface OpenDeps {
  /** A fresh scan of the active tab, or null when it cannot be read. */
  read: () => Promise<TargetList | null>;
  /** Clicks a target in the page, which checks everything again first. */
  select: (list: TargetList, target: Target, blinked: boolean) => Promise<SelectResult>;
  /** Picks a target for the person's own confirm: a double blink, or resting the mouse on it. */
  pick: (id: number) => PickResult;
}

/**
 * Opens target `id` for a spoken request. Speaking is deliberate, so a safe target opens at once; one
 * that may submit, pay, delete or send, or that Iris cannot classify, is only picked, and opens with the
 * person's own confirm. `seen` is where the target was when it was found: if it has moved since, its
 * number may now mean something else, so nothing opens.
 */
export async function openByVoice(id: number, seen: Rect | undefined, { read, select, pick }: OpenDeps): Promise<OpenResult> {
  const list = await read();
  const target = list?.targets.find((t) => t.id === id);
  if (!list || !target) return 'NO_SUCH_NUMBER';
  if (seen && (Math.abs(seen.x - target.rect.x) > 4 || Math.abs(seen.y - target.rect.y) > 4)) return 'STALE';
  if (isRisky(target)) return pick(id);
  const result = await select(list, target, false);
  if (result === 'NEEDS_DOUBLE_BLINK') return pick(id); // the page judged it risky after all
  return result === 'SELECTED' ? 'OPENED' : 'STALE';
}
