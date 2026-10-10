import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { install, type Run, uninstall } from './macos';

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

const execFileAsync = promisify(execFile);
const run: Run = (file, args) => execFileAsync(file, args);

if (process.argv[2] === '--uninstall') {
  await uninstall(homedir());
  console.log('Removed the Iris companion, Iris Companion.app and its Chrome registration.');
} else {
  try {
    const paths = await install({
      home: homedir(),
      nodePath: process.execPath,
      bundleSource: fileURLToPath(new URL('./companion.mjs', import.meta.url)),
      nodeModulesSource: fileURLToPath(new URL('../node_modules', import.meta.url)),
      launcherSource: fileURLToPath(new URL('../install/launcher.c', import.meta.url)),
      run,
    });
    console.log(
      [
        'Installed the Iris companion:',
        `  program:       ${paths.bundlePath}`,
        `  Presage SDK:   ${paths.runtimeDir}`,
        `  app:           ${paths.appBundle} (runs ${process.execPath})`,
        `  Chrome entry:  ${paths.manifestPath}`,
        'The first time the Iris panel opens, macOS asks whether "Iris Companion" may use the camera: choose Allow.',
        'Run this again after pulling companion changes.',
      ].join('\n'),
    );
  } catch (error) {
    console.error(`Install failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Building Iris Companion.app needs Apple's command line tools. Install them with: xcode-select --install");
    process.exit(1);
  }
}
