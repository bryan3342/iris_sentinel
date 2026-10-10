import { execFile, execFileSync, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IRIS_EXTENSION_ID, NATIVE_HOST_NAME } from '@iris/protocol';
import {
  appInfoPlist,
  compilerArgs,
  hostManifest,
  install,
  installPaths,
  type Run,
  runtimePackages,
  uninstall,
} from '../../companion/install/macos';

// Every test installs into a throwaway home folder, never the real ~/Library.
let home: string;
let bundleSource: string;
let nodeModulesSource: string;
let calls: [string, string[]][];

const LAUNCHER_SOURCE = fileURLToPath(new URL('../../companion/install/launcher.c', import.meta.url));

/** A node_modules shaped like the real one: the SDK, a native package per platform, and shared dependencies. */
const FAKE_PACKAGES: Record<string, Record<string, string>> = {
  '@smartspectra/node-sdk': {
    koffi: '*',
    protobufjs: '*',
    '@smartspectra/node-sdk-darwin-arm64': '*',
    '@smartspectra/node-sdk-linux-x64': '*',
    '@smartspectra/node-sdk-win32-x64': '*',
  },
  '@smartspectra/node-sdk-darwin-arm64': {},
  '@smartspectra/node-sdk-linux-x64': {},
  '@smartspectra/node-sdk-win32-x64': {},
  koffi: {},
  protobufjs: { long: '*', '@types/node': '*' },
  long: {},
  '@types/node': { 'undici-types': '*' },
  'undici-types': {},
  esbuild: {},
};

/** Stands in for the compiler and the code signer, recording what install() asked of them. */
const fakeRun: Run = async (file, args) => {
  calls.push([file, [...args]]);
};

beforeEach(async () => {
  calls = [];
  home = await mkdtemp(join(tmpdir(), 'iris-install-'));
  bundleSource = join(home, 'built-companion.mjs');
  await writeFile(bundleSource, '// built companion\n');
  nodeModulesSource = join(home, 'repo-node_modules');
  for (const [name, dependencies] of Object.entries(FAKE_PACKAGES)) {
    await mkdir(join(nodeModulesSource, name), { recursive: true });
    await writeFile(join(nodeModulesSource, name, 'package.json'), JSON.stringify({ name, dependencies }));
    await writeFile(join(nodeModulesSource, name, 'index.js'), `// ${name}\n`);
  }
});

afterEach(() => rm(home, { recursive: true, force: true }));

const exists = (path: string) => access(path).then(() => true, () => false);
const installAt = () =>
  install({ home, nodePath: '/usr/local/bin/node', bundleSource, nodeModulesSource, launcherSource: LAUNCHER_SOURCE, run: fakeRun });

const hasCompiler = (() => {
  try {
    execFileSync('cc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('appInfoPlist', () => {
  it('names the app, its launcher and why it wants the camera', () => {
    const plist = appInfoPlist();
    expect(plist).toContain(`<key>CFBundleIdentifier</key><string>${NATIVE_HOST_NAME}</string>`);
    expect(plist).toContain('<key>CFBundleExecutable</key><string>iris-companion</string>');
    expect(plist).toContain('<key>LSUIElement</key><true/>');
    expect(plist).toMatch(/<key>NSCameraUsageDescription<\/key><string>[^<]*Video never leaves this computer\.<\/string>/);
  });
});

describe('compilerArgs', () => {
  it('builds the Node and companion paths in as C strings, spaces included', () => {
    const args = compilerArgs({
      source: '/repo/launcher.c',
      output: '/app/iris-companion',
      nodePath: '/usr/local/bin/node',
      bundlePath: '/Users/me/Library/Application Support/Iris/companion/companion.mjs',
    });
    expect(args).toContain('-DNODE_PATH="/usr/local/bin/node"');
    expect(args).toContain('-DBUNDLE_PATH="/Users/me/Library/Application Support/Iris/companion/companion.mjs"');
    expect(args.slice(args.indexOf('-o'), args.indexOf('-o') + 3)).toEqual(['-o', '/app/iris-companion', '/repo/launcher.c']);
  });

  it('escapes quotes and backslashes in a path', () => {
    expect(compilerArgs({ source: 's', output: 'o', nodePath: 'a"b\\c', bundlePath: 'x' })).toContain('-DNODE_PATH="a\\"b\\\\c"');
  });
});

describe('hostManifest', () => {
  it('lets only the Iris extension start the companion', () => {
    expect(hostManifest('/x/iris-companion')).toEqual({
      name: NATIVE_HOST_NAME,
      description: expect.any(String),
      path: '/x/iris-companion',
      type: 'stdio',
      allowed_origins: [`chrome-extension://${IRIS_EXTENSION_ID}/`],
    });
  });
});

describe('runtimePackages', () => {
  it("follows the SDK's dependencies, keeping only this Mac's native package and no type-only packages", async () => {
    expect(await runtimePackages(nodeModulesSource)).toEqual([
      '@smartspectra/node-sdk',
      '@smartspectra/node-sdk-darwin-arm64',
      'koffi',
      'long',
      'protobufjs',
    ]);
  });
});

describe('install', () => {
  it('builds Iris Companion.app around the companion and registers its launcher with Chrome', async () => {
    const paths = await installAt();
    expect(paths.launcherPath).toBe(join(home, 'Library/Application Support/Iris/Iris Companion.app/Contents/MacOS/iris-companion'));
    expect(await readFile(paths.bundlePath, 'utf8')).toBe('// built companion\n');
    expect(await readFile(join(paths.appBundle, 'Contents/Info.plist'), 'utf8')).toBe(appInfoPlist());
    expect(calls).toEqual([
      ['/usr/bin/cc', compilerArgs({ source: LAUNCHER_SOURCE, output: paths.launcherPath, nodePath: '/usr/local/bin/node', bundlePath: paths.bundlePath })],
      ['/usr/bin/codesign', ['--force', '--sign', '-', paths.appBundle]],
    ]);
    const manifest = JSON.parse(await readFile(paths.manifestPath, 'utf8'));
    expect(manifest.path).toBe(paths.launcherPath);
    expect(manifest.allowed_origins).toEqual([`chrome-extension://${IRIS_EXTENSION_ID}/`]);
  });

  it('ships the Presage runtime next to the companion, without other platforms or dev tools', async () => {
    const paths = await installAt();
    expect(await readFile(join(paths.runtimeDir, 'koffi/index.js'), 'utf8')).toBe('// koffi\n');
    expect(await exists(join(paths.runtimeDir, '@smartspectra/node-sdk-darwin-arm64/package.json'))).toBe(true);
    expect(await exists(join(paths.runtimeDir, '@smartspectra/node-sdk-linux-x64'))).toBe(false);
    expect(await exists(join(paths.runtimeDir, 'esbuild'))).toBe(false);
    expect(await exists(join(paths.runtimeDir, '@types/node'))).toBe(false);
  });

  it('removes the shell launcher earlier versions installed', async () => {
    const { appDir } = installPaths(home);
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, 'iris-companion'), '#!/bin/sh\n');
    await installAt();
    expect(await exists(join(appDir, 'iris-companion'))).toBe(false);
  });

  it('can run again over an existing install, dropping packages the new runtime no longer needs', async () => {
    const first = await installAt();
    await mkdir(join(first.runtimeDir, 'left-over'), { recursive: true });
    await writeFile(bundleSource, '// newer build\n');
    const paths = await installAt();
    expect(await readFile(paths.bundlePath, 'utf8')).toBe('// newer build\n');
    expect(await exists(join(paths.runtimeDir, 'left-over'))).toBe(false);
    expect(await exists(join(paths.runtimeDir, 'koffi'))).toBe(true);
  });
});

describe('launcher.c', () => {
  it.skipIf(!hasCompiler)(
    "starts the companion with Chrome's arguments, passes stdin and stdout through, and returns its exit code",
    async () => {
      // A stand-in companion in a folder with a space, like "Application Support".
      const folder = join(home, 'Application Support');
      await mkdir(folder, { recursive: true });
      const companion = join(folder, 'companion.mjs');
      await writeFile(
        companion,
        "let input = ''; process.stdin.on('data', (d) => (input += d)); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input })); process.exit(3); });\n",
      );
      const launcher = join(home, 'iris-companion');
      await promisify(execFile)('cc', compilerArgs({ source: LAUNCHER_SOURCE, output: launcher, nodePath: process.execPath, bundlePath: companion }));

      const child = spawn(launcher, ['chrome-extension://caller/'], { env: {} });
      let stdout = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stdin.end('framed message');
      const code = await new Promise((resolve) => child.on('exit', resolve));
      expect(code).toBe(3);
      expect(JSON.parse(stdout)).toEqual({ args: ['chrome-extension://caller/'], input: 'framed message' });
    },
  );
});

describe('uninstall', () => {
  it('removes the companion, its runtime, the app and its Chrome registration', async () => {
    const paths = await installAt();
    await uninstall(home);
    expect(await exists(paths.manifestPath)).toBe(false);
    expect(await exists(paths.appBundle)).toBe(false);
    expect(await exists(paths.appDir)).toBe(false);
  });

  it('is safe when nothing is installed', async () => {
    await expect(uninstall(home)).resolves.toBeUndefined();
  });
});
