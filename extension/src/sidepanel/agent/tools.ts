import { pageScroll, type ScrollDirection } from '../../content/scroll';
import { activeTab, type PageCoordinator } from '../../page-understanding/coordinator';
import type { GazePanel } from '../gaze-panel';
import type { PageMarks } from '../page-marks';
import type { OpenResult } from '../voice-open';
import { choice, untrusted, voiceTool, words } from './tool';
import type { VoiceTools } from './voice';

export interface ToolDeps {
  coordinator: Pick<PageCoordinator, 'inspect'>;
  marks: Pick<PageMarks, 'aimed'>;
  gaze: Pick<GazePanel, 'pick' | 'open' | 'lookedAt'>;
  /** Shows what a tool did in the side panel, as the agent also says it. */
  report: (text: string) => void;
}

const SCROLLS: Record<ScrollDirection, string> = { down: 'Scrolled down.', up: 'Scrolled up.', top: 'At the top of the page.', bottom: 'At the bottom of the page.' };

/** What the person hears after asking to open number `id`; throws when nothing was opened or picked. */
function openedSay(id: number, result: OpenResult): string {
  switch (result) {
    case 'OPENED': return `Opened number ${id}.`;
    case 'PICKED_EYES': return `Number ${id} may submit, pay, delete or send, so it is selected: blink twice to open it.`;
    case 'STALE': throw new Error('PAGE_CHANGED');
    default: throw new Error(result); // NO_AIMING or NO_SUCH_NUMBER
  }
}

/**
 * The page actions the voice agent can ask for. Scrolling and history move the page at once;
 * summaries, descriptions and finding a target go through page understanding (Gemini) only because
 * the user asked. Asking to click a number, or a target Gemini finds, opens a safe one at once
 * through the gaze panel (the page checks it again first); anything that may submit, pay, delete or
 * send is only selected, and the user opens it with a double blink. Finding a target without asking
 * to click it only selects it.
 */
export function browserTools({ coordinator, marks, gaze, report }: ToolDeps): VoiceTools {
  const tool = voiceTool(report);
  return {
    scroll_page: tool(async ({ direction }) => {
      const to = choice(direction, ['down', 'up', 'top', 'bottom'] as const);
      const tab = await activeTab();
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: pageScroll, args: [to] });
      if (result?.result === 'AT_TOP') return 'Already at the top of the page.';
      if (result?.result === 'AT_BOTTOM') return 'Already at the bottom of the page.';
      return SCROLLS[to];
    }),
    navigate_history: tool(async ({ direction }) => {
      const to = choice(direction, ['back', 'forward'] as const);
      const tab = await activeTab();
      try { await (to === 'back' ? chrome.tabs.goBack(tab.id!) : chrome.tabs.goForward(tab.id!)); }
      catch { throw new Error('NO_HISTORY'); }
      return to === 'back' ? 'Went back to the previous page.' : 'Went forward.';
    }),
    summarize_whole_page: tool(async () => {
      const { result } = await coordinator.inspect({ operation: 'summarize_page' });
      return result.result.operation === 'summarize_page' ? untrusted(result.result.summary) : 'No summary.';
    }),
    // Only what the user looked at, never the whole page instead: that takes asking for the whole page.
    summarize_looked_at: tool(async () => {
      const lookedAt = gaze.lookedAt();
      if (!lookedAt) throw new Error('NOTHING_LOOKED_AT');
      const { result } = await coordinator.inspect({ operation: 'summarize_page', lookedAt });
      return result.result.operation === 'summarize_page' ? untrusted(result.result.summary) : 'No summary.';
    }),
    describe_looked_at: tool(async () => {
      const aimed = marks.aimed;
      const { result } = await coordinator.inspect({ operation: 'describe_target',
        aimed: aimed && { documentToken: aimed.list.documentToken, id: aimed.target.id, rect: aimed.target.rect } });
      return result.result.operation === 'describe_target' ? `Number ${result.result.targetId}: ${untrusted(result.result.description)}` : 'No description.';
    }),
    find_on_page: tool(async ({ description }) => {
      const { result } = await coordinator.inspect({ operation: 'find_target', request: words(description) });
      if (result.result.operation !== 'find_target') return 'No match.';
      if (result.result.targetId === null) return `No clear match. ${untrusted(result.result.explanation)}`;
      const id = result.result.targetId;
      const picked = gaze.pick(id);
      const next = picked === 'PICKED_EYES' ? 'It is selected. Blink twice to open it.' : 'Eye aiming starts once setup is finished, then you can open it.';
      return `It is number ${id}. ${next} ${untrusted(result.result.explanation)}`;
    }),
    click_on: tool(async ({ description }) => {
      const { result, found } = await coordinator.inspect({ operation: 'find_target', request: words(description) });
      if (result.result.operation !== 'find_target') return 'No match.';
      const id = result.result.targetId;
      if (id === null) return `No clear match. ${untrusted(result.result.explanation)}`;
      return `${openedSay(id, await gaze.open(id, found ?? undefined))} ${untrusted(result.result.explanation)}`;
    }),
    select_number: tool(async ({ number }) => {
      if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1 || number > 999) throw new Error('INVALID_INPUT');
      return openedSay(number, await gaze.open(number));
    }),
  };
}
