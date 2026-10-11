import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IRIS_EXTENSION_ID } from '@iris/protocol';

const manifest = JSON.parse(readFileSync(new URL('../../extension/public/manifest.json', import.meta.url), 'utf8')) as {
  key: string;
  permissions: string[];
};

/** Chrome's extension ID: the first 32 hex digits of the public key's SHA-256, written with the letters a to p. */
function extensionIdFor(publicKeyBase64: string): string {
  const hex = createHash('sha256').update(Buffer.from(publicKeyBase64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode('a'.charCodeAt(0) + parseInt(digit, 16))).join('');
}

describe('extension manifest', () => {
  it('pins the extension ID that the companion expects', () => {
    expect(extensionIdFor(manifest.key)).toBe(IRIS_EXTENSION_ID);
  });

  it('may talk to the native messaging companion', () => {
    expect(manifest.permissions).toContain('nativeMessaging');
  });

  it('may keep calibrations in extension storage', () => {
    expect(manifest.permissions).toContain('storage');
  });

  it('may search the web for a spoken request with the person\'s own default search engine', () => {
    expect(manifest.permissions).toContain('search');
  });

  it('never asks to read every tab\'s address: tab titles come only from websites Iris is allowed on', () => {
    expect(manifest.permissions).not.toContain('tabs');
  });
});
