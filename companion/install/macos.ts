import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IRIS_EXTENSION_ID, NATIVE_HOST_NAME } from '@iris/protocol';

// Registers the companion with Chrome on macOS. Chrome only starts native
// messaging hosts named in a JSON manifest in the user's Chrome folder; it starts
// them with almost no PATH, and does not pass on its own camera permission. So
// the installer copies the built companion out of the repository (which may sit
// in a protected folder such as ~/Desktop), next to the Presage SDK it loads at
// run time, and wraps it in a small app, "Iris Companion.app". The app's
// launcher (launcher.c) starts Node as its child, so macOS asks once whether
// Iris Companion may use the camera and remembers the answer.

/** Runs a program directly, with no shell. Rejects if it fails. */
export type Run = (file: string, args: readonly string[]) => Promise<unknown>;

export interface InstallPaths {
  /** The companion's own folder, outside any protected folder. */
  appDir: string;
  bundlePath: string;
  /** The Presage SDK and its dependencies, which cannot be bundled (native libraries). */
  runtimeDir: string;
  /** The small macOS app that macOS grants camera permission to. */
  appBundle: string;
  /** The app's launcher: the program Chrome runs. */
  launcherPath: string;
  /** Chrome's registration file for the companion. */
  manifestPath: string;
}

export function installPaths(home: string): InstallPaths {
  const support = join(home, 'Library', 'Application Support');
  const appDir = join(support, 'Iris', 'companion');
  const appBundle = join(support, 'Iris', 'Iris Companion.app');
  return {
    appDir,
    bundlePath: join(appDir, 'companion.mjs'),
    runtimeDir: join(appDir, 'node_modules'),
    appBundle,
    launcherPath: join(appBundle, 'Contents', 'MacOS', 'iris-companion'),
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

/**
 * The app's Info.plist. NSCameraUsageDescription is the explanation macOS shows
 * when it asks for the camera; LSUIElement keeps the app out of the Dock.
 */
export function appInfoPlist(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>CFBundleIdentifier</key><string>${NATIVE_HOST_NAME}</string>`,
    '  <key>CFBundleName</key><string>Iris Companion</string>',
    '  <key>CFBundleDisplayName</key><string>Iris Companion</string>',
    '  <key>CFBundleExecutable</key><string>iris-companion</string>',
    '  <key>CFBundlePackageType</key><string>APPL</string>',
    '  <key>CFBundleVersion</key><string>1</string>',
    '  <key>CFBundleShortVersionString</key><string>0.1.0</string>',
    '  <key>LSUIElement</key><true/>',
    '  <key>NSCameraUsageDescription</key><string>Iris measures heart rate, breathing and blinks from the camera to notice when you are tiring. Video never leaves this computer.</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** Compiler arguments for the launcher, with the Node and companion paths built in as C strings. */
export function compilerArgs({
  source,
  output,
  nodePath,
  bundlePath,
}: {
  source: string;
  output: string;
  nodePath: string;
  bundlePath: string;
}): string[] {
  // A JSON string is also a valid C string literal: quoted, with " and \ escaped.
  return ['-O2', '-Wall', '-o', output, source, `-DNODE_PATH=${JSON.stringify(nodePath)}`, `-DBUNDLE_PATH=${JSON.stringify(bundlePath)}`];
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

/**
 * Copies the built companion and its runtime into place, builds Iris
 * Companion.app around it, and registers the app's launcher with Chrome.
 * Safe to run again.
 */
export async function install({
  home,
  nodePath,
  bundleSource,
  nodeModulesSource,
  launcherSource,
  run,
}: {
  home: string;
  nodePath: string;
  bundleSource: string;
  /** The companion's own node_modules, holding the Presage SDK. */
  nodeModulesSource: string;
  /** launcher.c. */
  launcherSource: string;
  /** Runs the compiler and the code signer. */
  run: Run;
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

  // The app: launcher, Info.plist and a local (ad-hoc) signature, which macOS needs to recognize it.
  await rm(paths.appBundle, { recursive: true, force: true });
  await mkdir(dirname(paths.launcherPath), { recursive: true });
  await writeFile(join(paths.appBundle, 'Contents', 'Info.plist'), appInfoPlist());
  await run('/usr/bin/cc', compilerArgs({ source: launcherSource, output: paths.launcherPath, nodePath, bundlePath: paths.bundlePath }));
  await run('/usr/bin/codesign', ['--force', '--sign', '-', paths.appBundle]);
  // Earlier versions installed a shell launcher here; the app replaces it.
  await rm(join(paths.appDir, 'iris-companion'), { force: true });

  await mkdir(dirname(paths.manifestPath), { recursive: true });
  await writeFile(paths.manifestPath, `${JSON.stringify(hostManifest(paths.launcherPath), null, 2)}\n`);
  return paths;
}

/** Removes everything install() wrote. Safe to run when nothing is installed. */
export async function uninstall(home: string): Promise<void> {
  const paths = installPaths(home);
  await rm(paths.manifestPath, { force: true });
  await rm(paths.appBundle, { recursive: true, force: true });
  await rm(paths.appDir, { recursive: true, force: true });
}
