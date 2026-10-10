import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { provisionDemoSession } from './provision-demo-session.mjs';

// Dedicated synthetic-only manual harness: never reads .dev.vars or vendor keys.
const extensionId = process.argv[2];
if (!/^[a-p]{32}$/.test(extensionId || '')) {
  console.error('Usage: node scripts/manual-demo.mjs <32-letter Iris extension ID>');
  process.exit(1);
}
const fixture = await readFile(new URL('../../tests/fixtures/page-understanding.html', import.meta.url));
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022' });
const session = provisionDemoSession();
const worker = new Miniflare({ modules: true, script: outputFiles[0].text, compatibilityDate: '2026-04-26',
  host: '127.0.0.1', port: 8787,
  bindings: { EXTENSION_ORIGIN: `chrome-extension://${extensionId}`, DEMO_SESSIONS: JSON.stringify(session.serverBinding),
    ENABLE_PAGE_UNDERSTANDING: 'true', PAGE_CONTENT_APPROVED: 'false', ENABLE_LOCAL_LABELS: 'false',
    PAGE_UNDERSTANDING_PROVIDER: 'synthetic', SYNTHETIC_DELAY_MS: '2000' },
  outboundService: () => { throw new Error('External calls are disabled in the manual demo'); },
});
const page = createServer((request, response) => {
  if (request.url !== '/') { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(fixture);
});
try {
  await worker.ready;
  await new Promise((resolve, reject) => { page.once('error', reject); page.listen(8765, '127.0.0.1', resolve); });
} catch (error) {
  page.close(); await worker.dispose(); throw error;
}
console.log('Synthetic-only manual demo. No database, vendor keys, or external requests.');
console.log('Fixture: http://127.0.0.1:8765/');
console.log('Gateway: http://127.0.0.1:8787');
console.log(`Private session token (enter in Iris, do not share): ${session.sessionToken}`);
console.log(`Expires: ${new Date(session.expiresAt).toLocaleTimeString()}. Restart to provision another session.`);
console.log('Responses wait 2 seconds so you can test cancellation and page changes. Ctrl+C stops both servers.');
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  page.close(); await worker.dispose(); process.exit(0);
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
