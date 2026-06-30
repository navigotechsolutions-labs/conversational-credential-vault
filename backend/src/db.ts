import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool(
  connectionString
    ? { connectionString }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'core_vault',
      }
);

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error acquiring client:', err.stack);
  } else {
    console.log('Connected to database successfully');
    release();
  }
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
