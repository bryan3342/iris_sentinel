// Shared by the panel's buttons and the voice tools, so a failure reads the same either way.
const SETUP = 'The Iris server is not set up for this. Check server/.dev.vars against the Gemini runbook, then restart the server.';
const CHANGED = 'The page changed or the request was cancelled, so any result was discarded.';
/** What each failure means for the person using Iris. */
const HINTS: Record<string, string> = {
  REQUEST_FAILED: 'The Iris server is not running. In a terminal: cd server, then npm run dev.',
  INVALID_INPUT: 'Iris did not understand that request.',
  NO_HISTORY: 'There is no page to go to in that direction.',
  UNAUTHENTICATED: SETUP,
  PAGE_NOT_ALLOWED: 'Use an ordinary web page in the focused window, and allow Iris on it.',
  UNSUPPORTED_PAGE: 'This page cannot be captured safely: it is zoomed, very large, or has video or embedded frames.',
  PAGE_CHANGED: CHANGED, PAGE_CHANGED_OR_CANCELLED: CHANGED, CANCELLED_OR_TIMEOUT: 'The request timed out or was cancelled.',
  TIMEOUT: 'The request timed out.', REQUEST_IN_FLIGHT: 'A request is already running.',
  RATE_LIMITED: 'Iris allows ten requests a minute. Wait a moment, then try again.',
  NO_TARGETS: 'No links or buttons are visible on this page.',
  NO_AIMED_TARGET: 'Rest your eyes, or the mouse, on a numbered target for a moment first.',
  LIST_IMAGES_FIRST: 'List the visible image numbers first.', IMAGE_NOT_FOUND: 'No visible image has that number.',
  DISABLED: SETUP, NOT_CONFIGURED: SETUP, CONTENT_NOT_APPROVED: SETUP, FORBIDDEN: SETUP,
  UPSTREAM_UNAVAILABLE: 'Gemini is busy or over quota. Wait, then try again.',
  UPSTREAM_REJECTED: 'Gemini refused the request. Check GEMINI_API_KEY and GEMINI_MODEL in server/.dev.vars.',
  INVALID_MODEL_RESULT: 'Gemini returned an answer Iris could not use.',
};

/** The error code Iris raised, or REQUEST_FAILED for anything else (never raw upstream text). */
export function failureCode(error: unknown): string {
  return error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'REQUEST_FAILED';
}

/** The code and what to do about it. The code stays visible for the runbook's troubleshooting table. */
export function describeFailure(code: string): string {
  return `${code}. ${HINTS[code] ?? HINTS.REQUEST_FAILED!}`;
}
