import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth, sensitiveLimiter } from '../middleware/auth';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(requireAuth);
router.use(sensitiveLimiter);

const envPath = path.resolve(__dirname, '../../.env');

// Helper to update the .env file on disk
function updateEnvFile(updates: Record<string, string>) {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  // Split lines, filter out empty lines to avoid line bloat
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  const newLines = [...lines];

  for (const [key, val] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*`);
    const lineIndex = newLines.findIndex(l => regex.test(l));

    if (lineIndex !== -1) {
      newLines[lineIndex] = `${key}=${val}`;
    } else {
      newLines.push(`${key}=${val}`);
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n') + '\n', 'utf8');
}

// GET current settings status (returns whether keys are set, without exposing them)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const geminiKey = process.env.GEMINI_API_KEY || '';
    const hostingerToken = process.env.HOSTINGER_API_TOKEN || '';
    const corsOrigin = process.env.CORS_ORIGIN || 'https://core.navigotechsolutions.com';

    return res.json({
      geminiApiKeyConfigured: geminiKey.trim() !== '',
      hostingerApiTokenConfigured: hostingerToken.trim() !== '',
      corsOrigin
    });
  } catch (err) {
    console.error('Failed to get settings status:', err);
    return res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// POST to update settings
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { geminiApiKey, hostingerApiToken, corsOrigin } = req.body;
    const updates: Record<string, string> = {};

    // Only update if value is changed and is not the masked placeholder
    if (geminiApiKey !== undefined && geminiApiKey.trim() !== '' && geminiApiKey !== '••••••••••••••••') {
      updates['GEMINI_API_KEY'] = geminiApiKey.trim();
      process.env.GEMINI_API_KEY = geminiApiKey.trim();
    }
    
    if (hostingerApiToken !== undefined && hostingerApiToken.trim() !== '' && hostingerApiToken !== '••••••••••••••••') {
      updates['HOSTINGER_API_TOKEN'] = hostingerApiToken.trim();
      process.env.HOSTINGER_API_TOKEN = hostingerApiToken.trim();
    }

    if (corsOrigin !== undefined && corsOrigin.trim() !== '') {
      updates['CORS_ORIGIN'] = corsOrigin.trim();
      process.env.CORS_ORIGIN = corsOrigin.trim();
    }

    if (Object.keys(updates).length > 0) {
      updateEnvFile(updates);
    }

    return res.json({ message: 'System configurations updated successfully!' });
  } catch (err) {
    console.error('Failed to update system settings:', err);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;
