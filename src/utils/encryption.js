const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;

/**
 * Retrieves and validates the encryption key from environment variables.
 * @returns {Buffer} 32-byte encryption key
 * @throws {Error} If ENCRYPTION_KEY is missing or invalid
 */
function getKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Checks whether encryption is available (ENCRYPTION_KEY is set and valid).
 * @returns {boolean}
 */
function isConfigured() {
  const keyHex = process.env.ENCRYPTION_KEY;
  return typeof keyHex === 'string' && keyHex.length === 64;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * @param {string} plaintext - The string to encrypt
 * @returns {string} Colon-separated hex string: iv:authTag:ciphertext
 * @throws {Error} If encryption key is missing or input is invalid
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) {
    throw new Error('encrypt() requires a non-null string input');
  }

  if (typeof plaintext !== 'string') {
    throw new Error('encrypt() requires a string input');
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * @param {string} encryptedString - Colon-separated hex string: iv:authTag:ciphertext
 * @returns {string} The decrypted plaintext
 * @throws {Error} If decryption fails, input is malformed, or key is missing
 */
function decrypt(encryptedString) {
  if (!encryptedString || typeof encryptedString !== 'string') {
    throw new Error('decrypt() requires a non-empty string input');
  }

  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error(
      'decrypt() received a malformed encrypted string. ' +
      'Expected format: iv:authTag:ciphertext (3 colon-separated hex values)'
    );
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  if (ivHex.length !== IV_LENGTH * 2) {
    throw new Error(`decrypt() received an invalid IV length. Expected ${IV_LENGTH * 2} hex chars, got ${ivHex.length}`);
  }

  if (authTagHex.length !== AUTH_TAG_LENGTH * 2) {
    throw new Error(`decrypt() received an invalid auth tag length. Expected ${AUTH_TAG_LENGTH * 2} hex chars, got ${authTagHex.length}`);
  }

  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    throw new Error(`Decryption failed: ${err.message}. The data may be corrupted or the encryption key may have changed.`);
  }
}

module.exports = { encrypt, decrypt, isConfigured };
