import crypto from 'crypto';
import argon2 from 'argon2';

// Derive a 256-bit AES key from the master password using Argon2id
export async function deriveEncryptionKey(password: string, saltHex: string): Promise<Buffer> {
  const salt = Buffer.from(saltHex, 'hex');
  return argon2.hash(password, {
    raw: true,
    type: argon2.argon2id,
    salt,
    hashLength: 32,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4
  });
}

// Hash master password for verification (standard Argon2id encoded string)
export async function hashMasterPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    timeCost: 3,
    memoryCost: 65536,
    parallelism: 4
  });
}

// Verify master password
export async function verifyMasterPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch (err) {
    console.error('Password verification error:', err);
    return false;
  }
}

// Encrypt a secret value using AES-256-GCM
// Returns: iv (12 bytes) + ciphertext + authTag (16 bytes)
export function encryptSecret(plaintext: string, key: Buffer): { encrypted: Buffer; hash: string } {
  // Generate SHA-256 hash for deduplication before encryption
  const hash = crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const authTag = cipher.getAuthTag();
  const encryptedPayload = Buffer.concat([iv, encrypted, authTag]);

  return {
    encrypted: encryptedPayload,
    hash
  };
}

// Decrypt a secret value using AES-256-GCM
export function decryptSecret(encryptedPayload: Buffer, key: Buffer): string {
  if (encryptedPayload.length < 28) {
    throw new Error('Invalid encrypted payload: too short');
  }

  const iv = encryptedPayload.subarray(0, 12);
  const authTag = encryptedPayload.subarray(encryptedPayload.length - 16);
  const ciphertext = encryptedPayload.subarray(12, encryptedPayload.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

// Helper to generate a secure random hex salt
export function generateSalt(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

// Helper to calculate SHA-256 hash of a string
export function hashPlaintext(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext, 'utf8').digest('hex');
}
