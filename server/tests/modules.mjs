import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const paths = ['server/src/index', 'server/src/page-understanding', 'server/src/access',
  'server/src/http', 'server/src/png', 'server/src/multimodal', 'packages/protocol/src/page-understanding'];
const result = await build({
  stdin: { contents: paths.filter(p => existsSync(`${root}${p}.ts`)).map(p => `export * from './${p}';`).join('\n'),
    resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
});
export const modules = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
