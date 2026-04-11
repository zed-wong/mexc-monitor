import type { Database } from 'bun:sqlite';

import { LOG_LIMIT } from '../../config/constants';
import type { EventLog } from '../../core/types';

export class EventLogRepo {
  constructor(private readonly db: Database) {}

  append(log: EventLog): void {
    this.db.prepare(
      `INSERT INTO event_logs (account_name, asset, created_at, level, type, message, meta_json)
       VALUES (@account_name, @asset, @created_at, @level, @type, @message, @meta_json)`,
    ).run({
      account_name: log.accountName ?? null,
      asset: log.asset ?? null,
      created_at: log.createdAt,
      level: log.level,
      type: log.type,
      message: log.message,
      meta_json: log.metaJson ?? null,
    });
  }

  listRecent(options?: { limit?: number; accountName?: string; asset?: string; level?: EventLog['level'] }): EventLog[] {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (options?.accountName) {
      where.push('account_name = ?');
      params.push(options.accountName);
    }

    if (options?.asset) {
      where.push('asset = ?');
      params.push(options.asset);
    }

    if (options?.level) {
      where.push('level = ?');
      params.push(options.level);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = options?.limit ?? LOG_LIMIT;
    const rows = this.db
      .prepare(`SELECT * FROM event_logs ${clause} ORDER BY id DESC LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: Number(row.id),
      accountName: row.account_name ? String(row.account_name) : undefined,
      asset: row.asset ? String(row.asset) : undefined,
      createdAt: String(row.created_at),
      level: row.level as EventLog['level'],
      type: String(row.type),
      message: String(row.message),
      metaJson: row.meta_json ? String(row.meta_json) : undefined,
    }));
  }
}
