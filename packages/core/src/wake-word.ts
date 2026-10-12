/**
 * True when a request is addressed to Iris by name: it starts with "Iris" ("Iris, scroll down"), or
 * holds a greeting and "Iris" anywhere ("Hey Iris, go back"). In a loud room other people's talk can
 * reach the agent in the same turn, ahead of the user's request, so the greeting counts wherever it
 * is; "Iris" alone counts only at the start, since people also talk about Iris. In a loud room Iris
 * acts only on these (see SpeechGate.loud).
 */
export function addressedToIris(said: string): boolean {
  return /^\W*iris\b|\b(?:hey|hi|hello|ok|okay)\W+iris\b/i.test(said);
}
