import { Router, Response } from 'express';
import { query } from '../db';
import { encryptSecret, decryptSecret, hashPlaintext, verifyMasterPassword } from '../crypto';
import { requireAuth, sensitiveLimiter } from '../middleware/auth';
import { AuthenticatedRequest } from '../middleware/auth';
import { sessionStore } from '../sessionStore';

const router = Router();

// Apply auth middleware to all item routes
router.use(requireAuth);

// Helper to log access actions
async function logAccess(itemId: string | null, action: string) {
  try {
    await query(
      'INSERT INTO access_log (item_id, action, occurred_at) VALUES ($1, $2, now())',
      [itemId, action]
    );
  } catch (err) {
    console.error('Failed to log access action:', err);
  }
}

// 1. Live Hash Check (for deduplication warning while typing in UI)
router.post('/check-hash', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { hash } = req.body;
    if (!hash) {
      return res.status(400).json({ error: 'Hash is required' });
    }

    const dupResult = await query(
      `SELECT id, title, project, type, service 
       FROM vault_items 
       WHERE secret_value_hash = $1 
       LIMIT 1`,
      [hash]
    );

    if (dupResult.rows.length > 0) {
      return res.json({
        exists: true,
        item: dupResult.rows[0]
      });
    }

    return res.json({ exists: false });
  } catch (err) {
    console.error('Error checking hash:', err);
    return res.status(500).json({ error: 'Failed to verify duplicate status' });
  }
});

// 2. Search / List Items (secrets are masked)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, type, project, tag } = req.query;

    let sql = `
      SELECT id, type, title, service, project, username, url, used_in, notes, tags, last_rotated_at, created_at, updated_at
      FROM vault_items
      WHERE 1=1
    `;
    const params: any[] = [];

    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }

    if (project) {
      params.push(project);
      sql += ` AND project = $${params.length}`;
    }

    if (tag) {
      params.push(tag);
      sql += ` AND $${params.length} = ANY(tags)`;
    }

    if (search && typeof search === 'string' && search.trim() !== '') {
      params.push(search.trim());
      // Combine full-text search rank with ILIKE search for partial matches
      sql += ` AND (
        to_tsvector('english', title || ' ' || coalesce(service,'') || ' ' || coalesce(project,'') || ' ' || coalesce(notes,'')) @@ websearch_to_tsquery('english', $${params.length})
        OR title ILIKE '%' || $${params.length} || '%'
        OR coalesce(service, '') ILIKE '%' || $${params.length} || '%'
        OR coalesce(project, '') ILIKE '%' || $${params.length} || '%'
      )`;
    }

    sql += ' ORDER BY title ASC';

    const result = await query(sql, params);
    
    // Mask secrets on return list
    const items = result.rows.map(item => ({
      ...item,
      secret_value: '••••••••'
    }));

    return res.json(items);
  } catch (err) {
    console.error('Error fetching items:', err);
    return res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// 3. Get Single Item (secret is masked)
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT id, type, title, service, project, username, url, used_in, notes, tags, last_rotated_at, created_at, updated_at
       FROM vault_items
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = {
      ...result.rows[0],
      secret_value: '••••••••'
    };

    // Log view action
    await logAccess(id, 'viewed');

    return res.json(item);
  } catch (err) {
    console.error('Error fetching item:', err);
    return res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// 4. Reveal Secret (requires fresh session or re-authenticating with master password)
router.post('/:id/reveal', sensitiveLimiter, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { masterPassword } = req.body;

    const sessionFresh = sessionStore.isSessionFresh(req.sessionId!);

    // If session is stale (older than 5 minutes), require master password check
    if (!sessionFresh) {
      if (!masterPassword) {
        return res.status(400).json({
          error: 'Session stale. Master password required to reveal secret.',
          code: 'REAUTH_REQUIRED'
        });
      }

      // Verify master password
      const configResult = await query('SELECT master_password_hash FROM vault_config WHERE id = 1');
      const config = configResult.rows[0];
      const passwordValid = await verifyMasterPassword(config.master_password_hash, masterPassword);
      
      if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid master password' });
      }

      // Re-initialize session fresh timestamp
      const session = sessionStore.getSession(req.sessionId!);
      if (session) {
        session.createdAt = Date.now(); // reset age
      }
    }

    // Fetch encrypted secret
    const result = await query(
      'SELECT secret_value_encrypted FROM vault_items WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const encryptedData = result.rows[0].secret_value_encrypted;
    if (!encryptedData) {
      return res.json({ secret_value: null });
    }

    // Decrypt the secret using the session key
    const decrypted = decryptSecret(encryptedData, req.encryptionKey!);

    // Log reveal action
    await logAccess(id, 'revealed');

    return res.json({ secret_value: decrypted });
  } catch (err) {
    console.error('Error revealing secret:', err);
    return res.status(500).json({ error: 'Failed to decrypt secret' });
  }
});

// 5. Create Item (with deduplication check)
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      type,
      title,
      service,
      project,
      username,
      secret_value,
      url,
      used_in,
      notes,
      tags
    } = req.body;

    if (!type || !title) {
      return res.status(400).json({ error: 'Type and title are required' });
    }

    let secret_value_encrypted: Buffer | null = null;
    let secret_value_hash: string | null = null;

    if (type === 'api_key' || type === 'password') {
      if (!secret_value) {
        return res.status(400).json({ error: `Secret value is required for type ${type}` });
      }

      // Deduplication check
      secret_value_hash = hashPlaintext(secret_value);
      const dupResult = await query(
        `SELECT id, title, project, type 
         FROM vault_items 
         WHERE secret_value_hash = $1 
         LIMIT 1`,
        [secret_value_hash]
      );

      if (dupResult.rows.length > 0) {
        const dup = dupResult.rows[0];
        return res.status(409).json({
          error: 'DUPLICATE_KEY',
          message: `This key already exists as '${dup.title}' in project '${dup.project || 'None'}'.`,
          duplicateItem: dup
        });
      }

      // Encrypt the secret
      const encryption = encryptSecret(secret_value, req.encryptionKey!);
      secret_value_encrypted = encryption.encrypted;
    }

    const insertResult = await query(
      `INSERT INTO vault_items (
        type, title, service, project, username, secret_value_encrypted, secret_value_hash, url, used_in, notes, tags, last_rotated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, type, title, service, project, username, url, used_in, notes, tags, last_rotated_at, created_at, updated_at`,
      [
        type,
        title,
        service || null,
        project || null,
        username || null,
        secret_value_encrypted,
        secret_value_hash,
        url || null,
        used_in || [],
        notes || null,
        tags || [],
        (type === 'api_key' || type === 'password') ? new Date() : null
      ]
    );

    const newItem = insertResult.rows[0];
    await logAccess(newItem.id, 'created');

    return res.status(211).json({
      ...newItem,
      secret_value: '••••••••'
    });
  } catch (err) {
    console.error('Error creating item:', err);
    return res.status(500).json({ error: 'Failed to create item' });
  }
});

// 6. Update Item
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const {
      type,
      title,
      service,
      project,
      username,
      secret_value,
      url,
      used_in,
      notes,
      tags
    } = req.body;

    if (!type || !title) {
      return res.status(400).json({ error: 'Type and title are required' });
    }

    // Fetch existing item
    const currentResult = await query(
      'SELECT type, secret_value_encrypted, secret_value_hash FROM vault_items WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const currentItem = currentResult.rows[0];
    let secret_value_encrypted = currentItem.secret_value_encrypted;
    let secret_value_hash = currentItem.secret_value_hash;
    let last_rotated_at = currentItem.last_rotated_at;

    // Check if new secret value is provided
    if (secret_value && secret_value !== '••••••••') {
      secret_value_hash = hashPlaintext(secret_value);

      // Deduplication check against other rows
      const dupResult = await query(
        `SELECT id, title, project, type 
         FROM vault_items 
         WHERE secret_value_hash = $1 AND id != $2
         LIMIT 1`,
        [secret_value_hash, id]
      );

      if (dupResult.rows.length > 0) {
        const dup = dupResult.rows[0];
        return res.status(409).json({
          error: 'DUPLICATE_KEY',
          message: `This key already exists as '${dup.title}' in project '${dup.project || 'None'}'.`,
          duplicateItem: dup
        });
      }

      const encryption = encryptSecret(secret_value, req.encryptionKey!);
      secret_value_encrypted = encryption.encrypted;
      last_rotated_at = new Date();
    }

    await query(
      `UPDATE vault_items
       SET type = $1, title = $2, service = $3, project = $4, username = $5,
           secret_value_encrypted = $6, secret_value_hash = $7, url = $8,
           used_in = $9, notes = $10, tags = $11, last_rotated_at = coalesce($12, last_rotated_at),
           updated_at = now()
       WHERE id = $13`,
      [
        type,
        title,
        service || null,
        project || null,
        username || null,
        secret_value_encrypted,
        secret_value_hash,
        url || null,
        used_in || [],
        notes || null,
        tags || [],
        last_rotated_at,
        id
      ]
    );

    await logAccess(id, 'updated');

    return res.json({ success: true, message: 'Item updated successfully' });
  } catch (err) {
    console.error('Error updating item:', err);
    return res.status(500).json({ error: 'Failed to update item' });
  }
});

// 7. Delete Item
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Log deleted action before deletion due to ON DELETE CASCADE or SET NULL
    await logAccess(id, 'deleted');

    const deleteResult = await query('DELETE FROM vault_items WHERE id = $1', [id]);
    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    return res.json({ success: true, message: 'Item deleted successfully' });
  } catch (err) {
    console.error('Error deleting item:', err);
    return res.status(500).json({ error: 'Failed to delete item' });
  }
});

export default router;
