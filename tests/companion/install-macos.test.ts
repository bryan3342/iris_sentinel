import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IRIS_EXTENSION_ID, NATIVE_HOST_NAME } from '@iris/protocol';
import { hostManifest, install, launcherScript, runtimePackages, shQuote, uninstall } from '../../companion/install/macos';

// Every test installs into a throwaway home folder, never the real ~/Library.
let home: string;
let bundleSource: string;
let nodeModulesSource: string;

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

beforeEach(async () => {
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
const installAt = (nodePath = '/usr/local/bin/node') => install({ home, nodePath, bundleSource, nodeModulesSource });

describe('shQuote', () => {
  it('wraps a path with spaces in single quotes', () => {
    expect(shQuote('/Users/me/Library/Application Support')).toBe("'/Users/me/Library/Application Support'");
  });

  it('keeps a single quote inside the value safe', () => {
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe('launcherScript', () => {
  it("runs Node by its full path and passes Chrome's arguments through", () => {
    const script = launcherScript('/usr/local/bin/node', '/Users/me/Library/Application Support/Iris/companion/companion.mjs');
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain(
      `exec '/usr/local/bin/node' '/Users/me/Library/Application Support/Iris/companion/companion.mjs' "$@"`,
    );
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
  it('copies the companion out of the repository and registers it with Chrome', async () => {
    const paths = await installAt();
    expect(paths.manifestPath).toBe(
      join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.iris.companion.json'),
    );
    expect(await readFile(paths.bundlePath, 'utf8')).toBe('// built companion\n');
    expect((await stat(paths.launcherPath)).mode & 0o111).not.toBe(0);
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

  it('writes a launcher that really starts the program with the caller origin, despite spaces in the path', async () => {
    await writeFile(bundleSource, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    const paths = await installAt(process.execPath);
    const { stdout } = await promisify(execFile)(paths.launcherPath, ['chrome-extension://caller/'], { env: {} });
    expect(JSON.parse(stdout)).toEqual(['chrome-extension://caller/']);
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

describe('uninstall', () => {
  it('removes the companion, its runtime and its Chrome registration', async () => {
    const paths = await installAt();
    await uninstall(home);
    expect(await exists(paths.manifestPath)).toBe(false);
    expect(await exists(paths.appDir)).toBe(false);
  });

  it('is safe when nothing is installed', async () => {
    await expect(uninstall(home)).resolves.toBeUndefined();
  });
});
