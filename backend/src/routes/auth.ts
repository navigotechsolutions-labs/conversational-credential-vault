import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { query } from '../db';
import {
  hashMasterPassword,
  verifyMasterPassword,
  deriveEncryptionKey,
  generateSalt,
  encryptSecret,
  decryptSecret
} from '../crypto';
import { sessionStore } from '../sessionStore';
import { requireAuth, sensitiveLimiter, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-super-secret-key-change-me-in-production';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'fallback-refresh-secret-key-change-me';

// Helper to generate access and refresh tokens
function generateTokens(sessionId: string) {
  const accessToken = jwt.sign({ sessionId }, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ sessionId }, REFRESH_SECRET, { expiresIn: '24h' });
  return { accessToken, refreshToken };
}

// Get vault status: checks if master account is set up, and if user is currently logged in
router.get('/status', async (req: Request, res: Response) => {
  try {
    const configResult = await query('SELECT count(*) FROM vault_config');
    const isSetup = parseInt(configResult.rows[0].count) > 0;

    // Check if current user session is valid if token provided
    let isLoggedIn = false;
    let totpEnabled = false;
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { sessionId: string };
        isLoggedIn = sessionStore.getSession(decoded.sessionId) !== null;
        
        if (isLoggedIn) {
          const detailedResult = await query('SELECT totp_enabled FROM vault_config WHERE id = 1');
          if (detailedResult.rows.length > 0) {
            totpEnabled = detailedResult.rows[0].totp_enabled;
          }
        }
      } catch (err) {
        // Token invalid/expired
      }
    }

    return res.json({ isSetup, isLoggedIn, totpEnabled });
  } catch (err) {
    console.error('Error fetching status:', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

// Setup the master password (first run only)
router.post('/setup', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    // Check if already set up
    const configResult = await query('SELECT count(*) FROM vault_config');
    if (parseInt(configResult.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Vault is already set up' });
    }

    const { masterPassword } = req.body;
    if (!masterPassword || masterPassword.length < 8) {
      return res.status(400).json({ error: 'Master password must be at least 8 characters long' });
    }

    const passwordHash = await hashMasterPassword(masterPassword);
    const encryptionSalt = generateSalt(16);

    await query(
      `INSERT INTO vault_config (id, master_password_hash, encryption_salt, totp_enabled)
       VALUES (1, $1, $2, FALSE)`,
      [passwordHash, encryptionSalt]
    );

    return res.json({ success: true, message: 'Vault initialized successfully. Please log in.' });
  } catch (err) {
    console.error('Error during setup:', err);
    return res.status(500).json({ error: 'Setup failed' });
  }
});

// Login
router.post('/login', sensitiveLimiter, async (req: Request, res: Response) => {
  try {
    const { masterPassword, totpCode } = req.body;

    if (!masterPassword) {
      return res.status(400).json({ error: 'Master password is required' });
    }

    const configResult = await query('SELECT * FROM vault_config WHERE id = 1');
    if (configResult.rows.length === 0) {
      return res.status(400).json({ error: 'Vault is not set up yet' });
    }

    const config = configResult.rows[0];

    // 1. Verify master password
    const passwordValid = await verifyMasterPassword(config.master_password_hash, masterPassword);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid master password' });
    }

    // 2. Verify 2FA if enabled
    if (config.totp_enabled) {
      if (!totpCode) {
        return res.json({ requires2FA: true, message: 'TOTP 2FA code required' });
      }

      const totpValid = authenticator.verify({
        token: totpCode,
        secret: config.totp_secret,
      });

      if (!totpValid) {
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }
    }

    // 3. Derive secret encryption key (Argon2id)
    const encryptionKey = await deriveEncryptionKey(masterPassword, config.encryption_salt);

    // 4. Store the encryption key in-memory
    const sessionId = sessionStore.createSession(encryptionKey);

    // 5. Generate tokens
    const { accessToken, refreshToken } = generateTokens(sessionId);

    // 6. Set refresh token in HttpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    return res.json({
      success: true,
      accessToken,
      expiresIn: 900 // 15 minutes
    });
  } catch (err) {
    console.error('Error during login:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh tokens
router.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token missing' });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET) as { sessionId: string };
    
    // Check if the session is still alive in the memory cache
    const session = sessionStore.getSession(decoded.sessionId);
    if (!session) {
      return res.status(401).json({
        error: 'Session expired or vault locked. Please re-authenticate.',
        code: 'VAULT_LOCKED'
      });
    }

    // Generate new tokens (reuse the same session)
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.sessionId);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.json({
      accessToken,
      expiresIn: 900
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout
router.post('/logout', (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;
  
  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, REFRESH_SECRET) as { sessionId: string };
      // Destroy the encryption key in-memory
      sessionStore.destroySession(decoded.sessionId);
    } catch (err) {
      // Ignore token parse errors during logout
    }
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });

  return res.json({ success: true, message: 'Logged out successfully, memory keys purged.' });
});

// --- 2FA Config Endpoints (Requires Auth) ---

// Setup 2FA: Generates a secret and returns a QR code
router.post('/setup-2fa', requireAuth, async (req: Request, res: Response) => {
  try {
    const tempSecret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri('user', 'Core Vault', tempSecret);
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    // Save temporary secret to user session in memory (we add it to the active sessions if we want,
    // or just let the user store it. Wait, to prevent DB write before verification, we can return the secret
    // to the client, and the client sends it back when verifying. This is stateless on the server side!)
    return res.json({
      secret: tempSecret,
      qrCodeUrl
    });
  } catch (err) {
    console.error('Error generating 2FA:', err);
    return res.status(500).json({ error: 'Failed to generate 2FA' });
  }
});

// Verify and enable 2FA
router.post('/verify-2fa', requireAuth, async (req: Request, res: Response) => {
  try {
    const { secret, code } = req.body;
    if (!secret || !code) {
      return res.status(400).json({ error: 'Secret and verification code are required' });
    }

    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Save secret to database and enable 2FA
    await query(
      'UPDATE vault_config SET totp_secret = $1, totp_enabled = TRUE, updated_at = now() WHERE id = 1',
      [secret]
    );

    return res.json({ success: true, message: '2FA enabled successfully' });
  } catch (err) {
    console.error('Error enabling 2FA:', err);
    return res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

// Disable 2FA
router.post('/disable-2fa', requireAuth, async (req: Request, res: Response) => {
  try {
    const { masterPassword } = req.body;
    if (!masterPassword) {
      return res.status(400).json({ error: 'Master password required to disable 2FA' });
    }

    // Verify master password
    const configResult = await query('SELECT master_password_hash FROM vault_config WHERE id = 1');
    const config = configResult.rows[0];
    const passwordValid = await verifyMasterPassword(config.master_password_hash, masterPassword);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid master password' });
    }

    await query(
      'UPDATE vault_config SET totp_secret = NULL, totp_enabled = FALSE, updated_at = now() WHERE id = 1'
    );

    return res.json({ success: true, message: '2FA disabled successfully' });
  } catch (err) {
    console.error('Error disabling 2FA:', err);
    return res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// Change master password and re-encrypt all credentials
router.post('/change-password', requireAuth, sensitiveLimiter, async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old password and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long' });
  }

  try {
    // 1. Verify old master password
    const configResult = await query('SELECT * FROM vault_config WHERE id = 1');
    const config = configResult.rows[0];
    const passwordValid = await verifyMasterPassword(config.master_password_hash, oldPassword);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid old master password' });
    }

    // 2. Fetch all credentials to re-encrypt
    const itemsResult = await query(
      'SELECT id, secret_value_encrypted FROM vault_items WHERE secret_value_encrypted IS NOT NULL'
    );

    const oldKey = authReq.encryptionKey!;
    
    // 3. Derive new encryption key
    const newSalt = generateSalt(16);
    const newKey = await deriveEncryptionKey(newPassword, newSalt);

    // 4. Re-encrypt all items in memory first to ensure no errors
    const reEncryptedItems: { id: string; encrypted: Buffer }[] = [];
    for (const row of itemsResult.rows) {
      try {
        const decrypted = decryptSecret(row.secret_value_encrypted, oldKey);
        const { encrypted } = encryptSecret(decrypted, newKey);
        reEncryptedItems.push({ id: row.id, encrypted });
      } catch (decryptErr) {
        console.error(`Failed to decrypt item ${row.id} during password change:`, decryptErr);
        return res.status(500).json({ 
          error: 'Re-encryption aborted. Failed to decrypt existing credentials with old key. No changes were made.' 
        });
      }
    }

    // 5. Update items in DB inside a transaction
    await query('BEGIN');
    
    for (const item of reEncryptedItems) {
      await query(
        'UPDATE vault_items SET secret_value_encrypted = $1, updated_at = now() WHERE id = $2',
        [item.encrypted, item.id]
      );
    }

    // 6. Update master password hash and salt in vault_config
    const newPasswordHash = await hashMasterPassword(newPassword);
    await query(
      'UPDATE vault_config SET master_password_hash = $1, encryption_salt = $2, updated_at = now() WHERE id = 1',
      [newPasswordHash, newSalt]
    );

    await query('COMMIT');

    // 7. Update in-memory session key so current session stays valid
    const session = sessionStore.getSession(authReq.sessionId!);
    if (session) {
      session.encryptionKey = newKey;
    }

    return res.json({ success: true, message: 'Master password changed and credentials re-encrypted successfully.' });
  } catch (err) {
    await query('ROLLBACK');
    console.error('Password change failed:', err);
    return res.status(500).json({ error: 'Failed to change master password' });
  }
});

export default router;
