import type { Database } from 'bun:sqlite';

import { LOG_LIMIT } from '../../config/constants';
import type { EventLog } from '../../core/types';

export class EventLogRepo {
  constructor(private readonly db: Database) {}

  append(log: EventLog): void {
    this.db.prepare(
      `INSERT INTO event_logs (created_at, level, type, message, meta_json)
       VALUES (@created_at, @level, @type, @message, @meta_json)`,
    ).run({
      created_at: log.createdAt,
      level: log.level,
      type: log.type,
      message: log.message,
      meta_json: log.metaJson ?? null,
    });
  }

  listRecent(limit = LOG_LIMIT): EventLog[] {
    const rows = this.db
      .prepare(`SELECT * FROM event_logs ORDER BY id DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: Number(row.id),
      createdAt: String(row.created_at),
      level: row.level as EventLog['level'],
      type: String(row.type),
      message: String(row.message),
      metaJson: row.meta_json ? String(row.meta_json) : undefined,
    }));
  }
}
