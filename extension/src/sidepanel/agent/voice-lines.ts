import lines from './voice-lines.json';

/** Iris's fixed spoken lines. The audio, in the agent's voice, ships in public/voice (npm run voice:lines). */
export const VOICE_LINES = lines;
export type VoiceLine = keyof typeof lines;

/**
 * Says one fixed line in Iris's voice: output only, with no microphone and nothing expected back.
 * It plays in an offscreen document, which Chrome lets play sound without a click. Resolves true
 * once the line has played to the end.
 */
export async function playLine(line: VoiceLine): Promise<boolean> {
  try {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "Plays Iris's spoken greeting, which ships with the extension." });
  } catch { /* already open: Chrome allows one */ }
  try {
    return (await chrome.runtime.sendMessage({ target: 'offscreen', line })) === true;
  } catch {
    return false;
  }
}
