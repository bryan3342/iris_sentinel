const EVERY_MS = 50;

/**
 * Reports microphone loudness (dBFS) every 50 ms until stopped. Levels only: no audio is recorded,
 * kept or sent. Throws MICROPHONE when access is not granted, and AUDIO_BLOCKED when Chrome will not
 * run audio in the side panel until it is clicked once.
 */
export async function micLevels(onLevel: (db: number, t: number) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: false,
    // No gain control, so the background stays at its true level and speech stands out from it.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  }).catch(() => { throw new Error('MICROPHONE'); });
  const context = new AudioContext();
  const stop = () => { stream.getTracks().forEach((track) => track.stop()); void context.close().catch(() => {}); };
  // A blocked resume stays pending until a click, so it is given half a second.
  if (context.state === 'suspended') await Promise.race([context.resume().catch(() => {}), new Promise((done) => setTimeout(done, 500))]);
  if (context.state !== 'running') { stop(); throw new Error('AUDIO_BLOCKED'); }
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let power = 0;
    for (const v of samples) power += v * v;
    onLevel(10 * Math.log10(power / samples.length + 1e-12), performance.now());
  }, EVERY_MS);
  return () => { clearInterval(timer); stop(); };
}
