import fs from 'node:fs';
import path from 'node:path';
import { Database } from 'bun:sqlite';

import { DB_PATH } from '../config/constants';

export function openDatabase(): Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  return new Database(DB_PATH, { create: true, strict: true });
}
