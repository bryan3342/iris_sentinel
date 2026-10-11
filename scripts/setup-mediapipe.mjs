// Copies the MediaPipe WASM runtime and downloads the face and hand models into
// extension/public/mediapipe so the extension ships them locally (Manifest V3
// forbids remote code). Each model is pinned by SHA-256.
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const MODELS_URL = 'https://storage.googleapis.com/mediapipe-models';
const MODELS = [
  {
    file: 'face_landmarker.task',
    url: `${MODELS_URL}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  {
    file: 'hand_landmarker.task',
    url: `${MODELS_URL}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
    sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
  },
];

const outDir = join(import.meta.dirname, '..', 'extension', 'public', 'mediapipe');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const require = createRequire(join(import.meta.dirname, '..', 'extension', 'package.json'));
const visionDir = dirname(require.resolve('@mediapipe/tasks-vision'));
await mkdir(outDir, { recursive: true });
// Only the models and a fresh runtime copy ship; anything an older setup left here would ship too.
const keep = new Set(MODELS.map((model) => model.file));
for (const entry of await readdir(outDir)) {
  if (!keep.has(entry)) await rm(join(outDir, entry), { recursive: true, force: true });
}
await cp(join(visionDir, 'wasm'), join(outDir, 'wasm'), { recursive: true });

for (const model of MODELS) {
  const modelPath = join(outDir, model.file);
  const existing = await readFile(modelPath).catch(() => null);
  if (existing && sha256(existing) === model.sha256) continue;
  const response = await fetch(model.url);
  if (!response.ok) throw new Error(`${model.file} download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== model.sha256) throw new Error(`${model.file} checksum mismatch; refusing to use it.`);
  await writeFile(modelPath, bytes);
  console.log(`MediaPipe ${model.file} ready.`);
}
