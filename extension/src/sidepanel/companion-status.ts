import type { CompanionState } from '@iris/protocol';
import { companionLink, type LinkState } from '../providers/companion/link';

// Side panel row for the Presage companion. Opening the panel connects to the
// companion, and closing the panel ends it, so body sensing only runs while
// Iris is open. Fuller status (quality hints, warm-up, readings) comes later.

const LINK_TEXT: Record<LinkState, string> = {
  idle: 'Body signals: off.',
  unavailable: 'Body signals: only available in the installed extension.',
  connecting: 'Body signals: connecting to the companion...',
  connected: 'Body signals: companion connected.',
  'not-installed': 'Body signals: companion not installed. Run npm run install:host in companion/, then reopen this panel.',
  outdated: 'Body signals: companion is out of date. Run npm run install:host in companion/ again.',
  disconnected: 'Body signals: companion stopped. Close and reopen this panel to try again.',
};

/** One line describing the link, plus what the companion reports once connected. */
export function companionStatusText(link: LinkState, companion: CompanionState | null): string {
  if (link !== 'connected' || companion === null) return LINK_TEXT[link];
  return `Body signals: companion connected (${companion}).`;
}

/** Side panel row that connects to the companion as soon as it is shown. */
export function companionPanel(): HTMLElement {
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const link = companionLink();
  let companion: CompanionState | null = null;
  const render = () => (status.textContent = companionStatusText(link.state, companion));
  link.onState((state) => {
    if (state !== 'connected') companion = null;
    render();
  });
  link.onStatus((state) => {
    companion = state;
    render();
  });
  render();
  void link.start();
  return status;
}
