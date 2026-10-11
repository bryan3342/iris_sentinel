import { handleVoiceMessage } from './handler';

// Entry for offscreen.html: plays Iris's voice lines on request (see handler.ts).
chrome.runtime.onMessage.addListener(handleVoiceMessage);
