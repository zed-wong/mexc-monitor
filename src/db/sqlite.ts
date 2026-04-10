import { Database } from 'bun:sqlite';

import { DB_PATH } from '../config/constants';

export function openDatabase(): Database {
  return new Database(DB_PATH, { create: true, strict: true });
}
