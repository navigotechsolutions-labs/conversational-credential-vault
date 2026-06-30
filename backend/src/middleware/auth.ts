import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sessionStore } from '../sessionStore';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-super-secret-key-change-me-in-production';

export interface AuthenticatedRequest extends Request {
  sessionId?: string;
  encryptionKey?: Buffer;
}

// Authenticate JWT and check that the key exists in our in-memory session store
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sessionId: string };
    
    // Check if the session and its derived key are still active in memory
    const session = sessionStore.getSession(decoded.sessionId);
    if (!session) {
      return res.status(401).json({
        error: 'Session expired or vault locked. Please enter your master password to unlock.',
        code: 'VAULT_LOCKED'
      });
    }

    // Attach to request
    (req as AuthenticatedRequest).sessionId = decoded.sessionId;
    (req as AuthenticatedRequest).encryptionKey = session.encryptionKey;
    
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired access token' });
  }
}

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for sensitive endpoints (/reveal, /ask, /auth/login)
export const sensitiveLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // limit each IP to 30 requests per minute
  message: { error: 'Too many attempts. Rate limit exceeded, please try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});
