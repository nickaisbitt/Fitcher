// vitest globals (describe, it, expect, vi, beforeAll, afterAll) are injected via vitest.config.js globals: true

const VALID_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const ALTERNATE_KEY = 'ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00';

let encrypt, decrypt, isConfigured;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = VALID_KEY;
  // Require after setting env so getKey() works on first call
  ({ encrypt, decrypt, isConfigured } = require('../../src/utils/encryption'));
});

afterAll(() => {
  delete process.env.ENCRYPTION_KEY;
});

// Restore ENCRYPTION_KEY after tests that modify it
afterEach(() => {
  process.env.ENCRYPTION_KEY = VALID_KEY;
});

// ═════════════════════════════════════════════════════════════════
// Basic encrypt / decrypt behaviour (8 tests)
// ═════════════════════════════════════════════════════════════════
describe('encrypt / decrypt basics', () => {
  it('encrypt returns a string in format iv:authTag:ciphertext', () => {
    const result = encrypt('hello');
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
    // IV = 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // Auth tag = 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext is non-empty hex
    expect(parts[2].length).toBeGreaterThan(0);
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
  });

  it('encrypt produces different output for same input (random IV)', () => {
    const a = encrypt('duplicate');
    const b = encrypt('duplicate');
    expect(a).not.toBe(b);
    // Specifically, the IVs should differ
    expect(a.split(':')[0]).not.toBe(b.split(':')[0]);
  });

  it('decrypt reverses encrypt correctly', () => {
    const encrypted = encrypt('secret data');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe('secret data');
  });

  it('round-trip: encrypt then decrypt returns original string', () => {
    const original = 'round trip test value 🚀';
    expect(decrypt(encrypt(original))).toBe(original);
  });

  it('works with empty string', () => {
    const encrypted = encrypt('');
    expect(typeof encrypted).toBe('string');
    expect(decrypt(encrypted)).toBe('');
  });

  it('works with very long string (10000 chars)', () => {
    const longStr = 'x'.repeat(10000);
    const encrypted = encrypt(longStr);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(longStr);
    expect(decrypted).toHaveLength(10000);
  });

  it('works with special characters (unicode, emoji, newlines)', () => {
    const special = '你好世界 🌍🔑\n\ttab\r\nnewline €£¥ ñ ü ö ä';
    expect(decrypt(encrypt(special))).toBe(special);
  });

  it('works with JSON stringified objects', () => {
    const obj = { userId: 42, keys: ['KRAKEN_KEY', 'BINANCE_KEY'], nested: { deep: true } };
    const json = JSON.stringify(obj);
    const result = decrypt(encrypt(json));
    expect(result).toBe(json);
    expect(JSON.parse(result)).toEqual(obj);
  });
});

// ═════════════════════════════════════════════════════════════════
// Error cases (7 tests)
// ═════════════════════════════════════════════════════════════════
describe('encrypt / decrypt error cases', () => {
  it('encrypt throws when ENCRYPTION_KEY not set', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY');
  });

  it('encrypt throws when ENCRYPTION_KEY is wrong length', () => {
    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(() => encrypt('test')).toThrow('64-character hex string');
  });

  it('decrypt throws on malformed input (missing colons)', () => {
    expect(() => decrypt('nocol0nshere')).toThrow('malformed');
  });

  it('decrypt throws on wrong key', () => {
    const encrypted = encrypt('sensitive');
    // Switch to a different valid key
    process.env.ENCRYPTION_KEY = ALTERNATE_KEY;
    expect(() => decrypt(encrypted)).toThrow('Decryption failed');
  });

  it('decrypt throws on tampered ciphertext', () => {
    const encrypted = encrypt('tamper test');
    const parts = encrypted.split(':');
    // Flip a character in the ciphertext
    const tampered = parts[2].split('');
    tampered[0] = tampered[0] === 'a' ? 'b' : 'a';
    const bad = `${parts[0]}:${parts[1]}:${tampered.join('')}`;
    expect(() => decrypt(bad)).toThrow('Decryption failed');
  });

  it('decrypt throws on tampered auth tag', () => {
    const encrypted = encrypt('auth tag test');
    const parts = encrypted.split(':');
    // Flip a character in the auth tag
    const tagChars = parts[1].split('');
    tagChars[0] = tagChars[0] === 'a' ? 'b' : 'a';
    const bad = `${parts[0]}:${tagChars.join('')}:${parts[2]}`;
    expect(() => decrypt(bad)).toThrow('Decryption failed');
  });

  it('decrypt throws on tampered IV', () => {
    const encrypted = encrypt('iv test');
    const parts = encrypted.split(':');
    // Flip a character in the IV
    const ivChars = parts[0].split('');
    ivChars[0] = ivChars[0] === 'a' ? 'b' : 'a';
    const bad = `${ivChars.join('')}:${parts[1]}:${parts[2]}`;
    expect(() => decrypt(bad)).toThrow('Decryption failed');
  });
});

// ═════════════════════════════════════════════════════════════════
// isConfigured (2 tests)
// ═════════════════════════════════════════════════════════════════
describe('isConfigured', () => {
  it('returns true when key is set', () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    expect(isConfigured()).toBe(true);
  });

  it('returns false when key is missing', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(isConfigured()).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════
// Additional invariants (3 tests)
// ═════════════════════════════════════════════════════════════════
describe('additional invariants', () => {
  it('encrypted output is different from plaintext', () => {
    const plain = 'my secret api key';
    const encrypted = encrypt(plain);
    expect(encrypted).not.toBe(plain);
    // The ciphertext portion should not contain the plaintext literally
    expect(encrypted).not.toContain(plain);
  });

  it('decrypted output exactly matches original (byte-level)', () => {
    const original = 'byte-level \x00\x01\x02 check';
    const decrypted = decrypt(encrypt(original));
    expect(Buffer.from(decrypted, 'utf8').equals(Buffer.from(original, 'utf8'))).toBe(true);
  });

  it('concurrent encryptions do not interfere', async () => {
    const inputs = Array.from({ length: 50 }, (_, i) => `concurrent-value-${i}`);
    const results = await Promise.all(
      inputs.map(async (input) => {
        // Wrap in a microtask to allow interleaving
        await new Promise((r) => setTimeout(r, 0));
        const encrypted = encrypt(input);
        return decrypt(encrypted);
      })
    );
    results.forEach((result, i) => {
      expect(result).toBe(inputs[i]);
    });
  });
});
