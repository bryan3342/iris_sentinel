import { QualityChanges, qualityFor, VitalsWindow } from '../src/presage/map';
import { stateForError } from '../src/presage/rules';
import { PresageSession } from '../src/presage/session';
import { readPresageKey } from '../src/secrets/keychain';

// `npm run check:presage [seconds]` runs Presage on this Mac, without Chrome,
// through the companion's own code, and reports which signals arrived. It
// prints no readings and never the key. It turns on the camera and uses about
// a minute of Presage credit.

type Signal = 'pulse' | 'breathing' | 'hrv';
const SIGNALS: Signal[] = ['pulse', 'breathing', 'hrv'];

const requested = Number(process.argv[2]);
const seconds = Number.isFinite(requested) && requested > 0 ? requested : 60;

const key = await readPresageKey();
if (!key) {
  console.error('No Presage key in the Keychain. Store it once with:');
  console.error('  security add-generic-password -U -s iris-presage -a iris -w');
  process.exit(1);
}

const startedAt = Date.now();
const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
const say = (line: string) => console.log(`[${elapsed().padStart(6)}] ${line}`);
const quality = new QualityChanges();
const vitals = new VitalsWindow();
const firstSeen: Record<Signal, string | null> = { pulse: null, breathing: null, hrv: null };
const firstStable: Record<Signal, string | null> = { pulse: null, breathing: null, hrv: null };
let failure: string | null = null;
let finish: () => void = () => undefined;
const finished = new Promise<void>((resolve) => (finish = resolve));
// Diagnostics for the summary: how much data flowed, and how often the camera view was usable.
let measuringAt: number | null = null;
let packets = 0;
const framesByQuality = new Map<string, number>();

const session = new PresageSession(key, {
  onRunning: () => {
    measuringAt ??= Date.now();
    say('measuring (sit still, face the camera)');
  },
  onQuality: (code, hint) => {
    const name = qualityFor(code) ?? code;
    framesByQuality.set(name, (framesByQuality.get(name) ?? 0) + 1);
    const change = quality.next(code, hint);
    if (change) say(`camera: ${change.quality}${change.hint ? `, "${change.hint}"` : ''}`);
  },
  onMetrics: (metrics) => {
    packets++;
    vitals.add(metrics);
  },
  onError: (code) => {
    failure = stateForError(code);
    say(`error ${code}: the companion would report "${failure}"`);
    finish();
  },
});

say(`checking Presage for ${seconds}s...`);
session.start();
const tick = setInterval(() => {
  const taken = vitals.take();
  for (const signal of SIGNALS) {
    const reading = taken[signal];
    if (!reading) continue;
    if (firstSeen[signal] === null) {
      firstSeen[signal] = elapsed();
      say(`first ${signal} reading`);
    }
    if (reading.stable && firstStable[signal] === null) {
      firstStable[signal] = elapsed();
      say(`${signal} is now stable`);
    }
  }
}, 1000);
setTimeout(finish, seconds * 1000);

await finished;
clearInterval(tick);
await session.stop();

console.log('\nPresage check (no readings shown):');
for (const signal of SIGNALS) {
  const seen = firstSeen[signal];
  console.log(`  ${signal.padEnd(10)}${seen ? `received from ${seen}, stable from ${firstStable[signal] ?? 'not yet'}` : 'NOT received'}`);
}
const measuredSeconds = measuringAt === null ? 0 : (Date.now() - measuringAt) / 1000;
console.log(`  packets   ${packets} (about ${measuredSeconds > 0 ? (packets / measuredSeconds).toFixed(0) : 0} a second; about 30 is normal)`);
const frames = [...framesByQuality.values()].reduce((sum, n) => sum + n, 0);
const shares = [...framesByQuality.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([name, n]) => `${name} ${Math.round((100 * n) / frames)}%`);
console.log(`  camera    ${frames ? shares.join(', ') : 'no camera reports'} (share of frames)`);
const works = failure === null && firstSeen.pulse !== null && firstSeen.breathing !== null;
console.log(works ? 'Result: Presage works on this computer.' : `Result: problem (${failure ?? 'pulse or breathing never arrived'}).`);
process.exit(works ? 0 : 1);
