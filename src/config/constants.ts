import path from 'node:path';

export const APP_NAME = 'Exchange Balance Monitor';
export const DB_PATH = path.resolve(process.cwd(), 'data', 'app.db');
export const MASTER_PASSWORD_CACHE_PATH = path.resolve(process.cwd(), 'data', 'master-password-cache.json');
export const MASTER_PASSWORD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const SETTINGS_ROW_ID = 1;
export const RUNTIME_ROW_ID = 1;
export const LOG_LIMIT = 200;
