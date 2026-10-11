// Hidden page that plays Iris's fixed voice lines, which ship inside the extension (public/voice).
// Chrome lets an offscreen document made for audio playback play sound with no click, and it needs
// no microphone, server or network. Only the side panel may ask, and only for a line by name.

/** Plays one line; answers true once it has played to the end, false if it could not play. */
export function handleVoiceMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (played: boolean) => void): boolean {
  const request = message as { target?: unknown; line?: unknown } | null;
  if (request?.target !== 'offscreen') return false;
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('sidepanel.html') ||
    typeof request.line !== 'string' || !/^[a-z]+$/.test(request.line)) { respond(false); return false; }
  const audio = new Audio(chrome.runtime.getURL(`voice/${request.line}.mp3`));
  audio.addEventListener('ended', () => respond(true), { once: true });
  audio.addEventListener('error', () => respond(false), { once: true });
  audio.play().catch(() => respond(false));
  return true;
}
