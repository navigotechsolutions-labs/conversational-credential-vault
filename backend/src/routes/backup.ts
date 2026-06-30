import { Router, Response } from 'express';
import express from 'express';
import { query } from '../db';
import { encryptSecret, decryptSecret } from '../crypto';
import { requireAuth, sensitiveLimiter } from '../middleware/auth';
import { AuthenticatedRequest } from '../middleware/auth';
import crypto from 'crypto';

const router = Router();

// Require authentication for all export/import operations
router.use(requireAuth);

// Helper to encrypt a buffer with a key
function encryptBackup(payload: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(payload, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]);
}

// Helper to decrypt a buffer with a key
function decryptBackup(encryptedPayload: Buffer, key: Buffer): string {
  if (encryptedPayload.length < 28) {
    throw new Error('Encrypted backup is corrupted or too short.');
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

// 1. Export Encrypted Backup
router.get('/export', sensitiveLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Retrieve all vault items including encrypted columns
    const result = await query(
      `SELECT type, title, service, project, username, secret_value_encrypted, secret_value_hash, url, used_in, notes, tags, last_rotated_at, created_at, updated_at
       FROM vault_items`
    );

    const backupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      items: result.rows.map(row => ({
        ...row,
        // Convert bytea Buffer to hex string for JSON compatibility
        secret_value_encrypted: row.secret_value_encrypted 
          ? row.secret_value_encrypted.toString('hex') 
          : null
      }))
    };

    const jsonString = JSON.stringify(backupData);
    
    // Encrypt backup file with current user's session key
    const encryptedBuffer = encryptBackup(jsonString, req.encryptionKey!);

    res.setHeader('Content-Disposition', 'attachment; filename="core-vault-backup.json.enc"');
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.send(encryptedBuffer);
  } catch (err) {
    console.error('Export failed:', err);
    return res.status(500).json({ error: 'Failed to generate backup file' });
  }
});

// 2. Import Encrypted Backup
// Uses raw middleware to process binary upload directly
router.post(
  '/import',
  sensitiveLimiter,
  express.raw({ type: 'application/octet-stream', limit: '20mb' }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const encryptedBuffer = req.body;
      if (!encryptedBuffer || encryptedBuffer.length === 0) {
        return res.status(400).json({ error: 'Empty backup file received.' });
      }

      // Decrypt backup using current session key
      let decryptedData: string;
      try {
        decryptedData = decryptBackup(encryptedBuffer, req.encryptionKey!);
      } catch (decryptErr) {
        return res.status(400).json({ 
          error: 'Decryption failed. The backup file might be corrupted or encrypted with a different master password.' 
        });
      }

      const backup = JSON.parse(decryptedData);
      if (!backup.items || !Array.isArray(backup.items)) {
        return res.status(400).json({ error: 'Invalid backup structure. Missing items list.' });
      }

      let importedCount = 0;
      let skippedCount = 0;

      for (const item of backup.items) {
        const {
          type,
          title,
          service,
          project,
          username,
          secret_value_encrypted,
          secret_value_hash,
          url,
          used_in,
          notes,
          tags,
          last_rotated_at
        } = item;

        // Skip duplicates based on title + project + username OR hash
        let duplicateCheck;
        if (secret_value_hash) {
          duplicateCheck = await query(
            'SELECT id FROM vault_items WHERE secret_value_hash = $1',
            [secret_value_hash]
          );
        } else {
          duplicateCheck = await query(
            `SELECT id FROM vault_items 
             WHERE title = $1 AND coalesce(project, '') = $2 AND coalesce(username, '') = $3`,
            [title, project || '', username || '']
          );
        }

        if (duplicateCheck.rows.length > 0) {
          skippedCount++;
          continue;
        }

        // Convert encrypted secret hex back to Buffer
        const encryptedBufferVal = secret_value_encrypted 
          ? Buffer.from(secret_value_encrypted, 'hex') 
          : null;

        await query(
          `INSERT INTO vault_items (
            type, title, service, project, username, secret_value_encrypted, secret_value_hash, url, used_in, notes, tags, last_rotated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            type,
            title,
            service || null,
            project || null,
            username || null,
            encryptedBufferVal,
            secret_value_hash || null,
            url || null,
            used_in || [],
            notes || null,
            tags || [],
            last_rotated_at ? new Date(last_rotated_at) : null
          ]
        );
        importedCount++;
      }

      return res.json({
        success: true,
        message: `Import completed. Imported: ${importedCount}, Skipped: ${skippedCount} duplicate items.`
      });
    } catch (err) {
      console.error('Import failed:', err);
      return res.status(500).json({ error: 'Failed to import backup data' });
    }
  }
);

export default router;
