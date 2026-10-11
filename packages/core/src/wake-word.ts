/**
 * True when a request is addressed to Iris by name: it starts with "Iris", or with a greeting and
 * "Iris", as in "Iris, scroll down" or "Hey Iris, go back". In a loud room Iris acts only on these,
 * so voices around the user are not taken as requests (see SpeechGate.loud).
 */
export function addressedToIris(said: string): boolean {
  return /^\W*(?:(?:hey|hi|hello|ok|okay)\W+)?iris\b/i.test(said);
}
