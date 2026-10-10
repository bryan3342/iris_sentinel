import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { install, uninstall } from './macos';

// Run by `npm run install:host` and `npm run uninstall:host`, bundled to
// dist/install-macos.mjs next to the built companion.

if (process.platform !== 'darwin') {
  console.error('The companion installer covers macOS only for now.');
  process.exit(1);
}
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`Node ${process.versions.node} is too old: the companion needs Node 20 or newer.`);
  process.exit(1);
}

if (process.argv[2] === '--uninstall') {
  await uninstall(homedir());
  console.log('Removed the Iris companion and its Chrome registration.');
} else {
  const paths = await install({
    home: homedir(),
    nodePath: process.execPath,
    bundleSource: fileURLToPath(new URL('./companion.mjs', import.meta.url)),
    nodeModulesSource: fileURLToPath(new URL('../node_modules', import.meta.url)),
  });
  console.log(
    [
      'Installed the Iris companion:',
      `  program:       ${paths.bundlePath}`,
      `  Presage SDK:   ${paths.runtimeDir}`,
      `  launcher:      ${paths.launcherPath} (runs ${process.execPath})`,
      `  Chrome entry:  ${paths.manifestPath}`,
      'Run this again after pulling companion changes.',
    ].join('\n'),
  );
}
