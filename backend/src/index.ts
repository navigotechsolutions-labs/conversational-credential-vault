import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRouter from './routes/auth';
import itemsRouter from './routes/items';
import chatRouter from './routes/chat';
import settingsRouter from './routes/settings';
import backupRouter from './routes/backup';
import { apiLimiter } from './middleware/auth';

dotenv.config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 8333;

// Configure CORS to support credentials (for HttpOnly refresh cookies)
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Apply standard security headers
app.use(helmet());

// Cookie parsing for refresh tokens
app.use(cookieParser());

// General rate limiter
app.use('/api', apiLimiter);

// JSON body parser (except for the import endpoint which parses raw binary)
// We define json parser middleware but exclude /api/import so raw body parser in backup.ts handles it
app.use((req, res, next) => {
  if (req.path === '/api/import') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// Route mountings
app.use('/api/auth', authRouter);
app.use('/api/items', itemsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/settings', settingsRouter);
app.use('/api', backupRouter); // Mounts /export and /import

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'Internal server error occurred' });
});

// Start listening
app.listen(PORT, () => {
  console.log(`Core Vault backend running on port ${PORT}`);
});
