import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IRIS_EXTENSION_ID, NATIVE_HOST_NAME } from '@iris/protocol';

// Registers the companion with Chrome on macOS. Chrome only starts native
// messaging hosts named in a JSON manifest in the user's Chrome folder, and it
// starts them with almost no PATH. So the installer copies the built companion
// out of the repository (which may sit in a protected folder such as ~/Desktop),
// next to the Presage SDK it loads at run time, and writes a launcher that calls
// Node by its full path.

export interface InstallPaths {
  /** The companion's own folder, outside any protected folder. */
  appDir: string;
  bundlePath: string;
  /** The Presage SDK and its dependencies, which cannot be bundled (native libraries). */
  runtimeDir: string;
  /** The program Chrome runs. */
  launcherPath: string;
  /** Chrome's registration file for the companion. */
  manifestPath: string;
}

export function installPaths(home: string): InstallPaths {
  const support = join(home, 'Library', 'Application Support');
  const appDir = join(support, 'Iris', 'companion');
  return {
    appDir,
    bundlePath: join(appDir, 'companion.mjs'),
    runtimeDir: join(appDir, 'node_modules'),
    launcherPath: join(appDir, 'iris-companion'),
    manifestPath: join(support, 'Google', 'Chrome', 'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`),
  };
}

/** The package the companion loads at run time instead of bundling. */
const RUNTIME_ROOT = '@smartspectra/node-sdk';
/** The SDK installs a native package for every platform; only this Mac's is shipped. */
const OTHER_PLATFORM = /^@smartspectra\/node-sdk-(?!darwin-arm64$)/;

/**
 * Every package the Presage SDK loads at run time, found by following
 * `dependencies` from the SDK in `node_modules`. Leaves out other platforms'
 * native packages and type-only `@types` packages.
 */
export async function runtimePackages(nodeModules: string): Promise<string[]> {
  const found = new Set<string>();
  const visit = async (name: string): Promise<void> => {
    if (found.has(name) || OTHER_PLATFORM.test(name) || name.startsWith('@types/')) return;
    found.add(name);
    const pkg = JSON.parse(await readFile(join(nodeModules, name, 'package.json'), 'utf8'));
    for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) await visit(dependency);
  };
  await visit(RUNTIME_ROOT);
  return [...found].sort();
}

/** Quotes a value for /bin/sh: single quotes, with any single quote inside written as '\''. */
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The launcher Chrome runs. It passes Chrome's arguments, such as the caller origin, through. */
export function launcherScript(nodePath: string, bundlePath: string): string {
  return [
    '#!/bin/sh',
    '# Written by `npm run install:host` in companion/. Chrome starts this with',
    '# almost no PATH, so Node is called by its full path.',
    `exec ${shQuote(nodePath)} ${shQuote(bundlePath)} "$@"`,
    '',
  ].join('\n');
}

/** Chrome's native messaging host manifest. Only the Iris extension may start the companion. */
export function hostManifest(launcherPath: string) {
  return {
    name: NATIVE_HOST_NAME,
    description: 'Iris companion: on-device Presage sensing',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${IRIS_EXTENSION_ID}/`],
  };
}

/** Copies the built companion and its runtime into place and registers it with Chrome. Safe to run again. */
export async function install({
  home,
  nodePath,
  bundleSource,
  nodeModulesSource,
}: {
  home: string;
  nodePath: string;
  bundleSource: string;
  /** The companion's own node_modules, holding the Presage SDK. */
  nodeModulesSource: string;
}): Promise<InstallPaths> {
  const paths = installPaths(home);
  const packages = await runtimePackages(nodeModulesSource);
  await mkdir(paths.appDir, { recursive: true });
  await copyFile(bundleSource, paths.bundlePath);
  // Start the runtime fresh so packages from an older install never linger.
  await rm(paths.runtimeDir, { recursive: true, force: true });
  for (const name of packages) {
    // verbatimSymlinks keeps any link relative, so nothing points back into the repository.
    await cp(join(nodeModulesSource, name), join(paths.runtimeDir, name), { recursive: true, verbatimSymlinks: true });
  }
  await writeFile(paths.launcherPath, launcherScript(nodePath, paths.bundlePath));
  await chmod(paths.launcherPath, 0o755);
  await mkdir(dirname(paths.manifestPath), { recursive: true });
  await writeFile(paths.manifestPath, `${JSON.stringify(hostManifest(paths.launcherPath), null, 2)}\n`);
  return paths;
}

/** Removes everything install() wrote. Safe to run when nothing is installed. */
export async function uninstall(home: string): Promise<void> {
  const paths = installPaths(home);
  await rm(paths.manifestPath, { force: true });
  await rm(paths.appDir, { recursive: true, force: true });
}
