// Copies the MediaPipe WASM runtime and downloads the face model into
// extension/public/mediapipe so the extension ships them locally (Manifest V3
// forbids remote code). The model is pinned by SHA-256.
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MODEL_SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff';

const outDir = join(import.meta.dirname, '..', 'extension', 'public', 'mediapipe');
const modelPath = join(outDir, 'face_landmarker.task');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const require = createRequire(join(import.meta.dirname, '..', 'extension', 'package.json'));
const visionDir = dirname(require.resolve('@mediapipe/tasks-vision'));
await mkdir(outDir, { recursive: true });
// Only the face model and a fresh runtime copy ship; anything an older setup left here would ship too.
for (const entry of await readdir(outDir)) {
  if (entry !== 'face_landmarker.task') await rm(join(outDir, entry), { recursive: true, force: true });
}
await cp(join(visionDir, 'wasm'), join(outDir, 'wasm'), { recursive: true });

const existing = await readFile(modelPath).catch(() => null);
if (existing && sha256(existing) === MODEL_SHA256) process.exit(0);

const response = await fetch(MODEL_URL);
if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
const model = Buffer.from(await response.arrayBuffer());
if (sha256(model) !== MODEL_SHA256) throw new Error('Model checksum mismatch; refusing to use it.');
await writeFile(modelPath, model);
console.log('MediaPipe face model ready.');
