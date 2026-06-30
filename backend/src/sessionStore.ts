import crypto from 'crypto';

interface SessionData {
  encryptionKey: Buffer;
  createdAt: number;
  expiresAt: number;
}

class SessionStore {
  private sessions = new Map<string, SessionData>();

  constructor() {
    // Run garbage collection every 1 minute to purge expired keys from memory
    setInterval(() => this.cleanup(), 60000);
  }

  // Create a new session and store the derived key
  // Default TTL is 15 minutes (900,000 ms) matching the JWT access token lifetime
  createSession(encryptionKey: Buffer, ttlMs = 15 * 60 * 1000): string {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    this.sessions.set(sessionId, {
      encryptionKey,
      createdAt: now,
      expiresAt: now + ttlMs,
    });
    return sessionId;
  }

  // Retrieve session data if valid and not expired, extending its lifespan
  getSession(sessionId: string, extendTtlMs = 15 * 60 * 1000): SessionData | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Extend session expiration
    session.expiresAt = Date.now() + extendTtlMs;
    return session;
  }

  // Check if session was created less than N minutes ago
  isSessionFresh(sessionId: string, maxAgeMs = 5 * 60 * 1000): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;
    return Date.now() - session.createdAt < maxAgeMs;
  }

  // Delete a session (on logout)
  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // Clean up all expired sessions
  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, data] of this.sessions.entries()) {
      if (now > data.expiresAt) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

export const sessionStore = new SessionStore();
