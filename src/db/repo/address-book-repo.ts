import type { Database } from 'bun:sqlite';

import type { AddressBookEntry } from '../../core/types';

export class AddressBookRepo {
  private static readonly ANY_ASSET = '*';
  private static readonly GLOBAL_SCOPE = '__global__';

  constructor(private readonly db: Database) {}

  get(alias: string): AddressBookEntry | null {
    const row = this.db.prepare('SELECT * FROM address_book WHERE account_name = ? AND alias = ?').get(AddressBookRepo.GLOBAL_SCOPE, alias) as Record<string, unknown> | null;
    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  list(): AddressBookEntry[] {
    const rows = this.db.prepare('SELECT * FROM address_book WHERE account_name = ? ORDER BY alias ASC').all(AddressBookRepo.GLOBAL_SCOPE) as Record<string, unknown>[];

    return rows.map((row) => this.mapRow(row));
  }

  save(entry: AddressBookEntry): void {
    this.db.prepare(`
      INSERT INTO address_book (
        account_name, alias, asset, network, address, tag, note
      ) VALUES (
        @account_name, @alias, @asset, @network, @address, @tag, @note
      )
      ON CONFLICT(account_name, alias) DO UPDATE SET
        asset = excluded.asset,
        network = excluded.network,
        address = excluded.address,
        tag = excluded.tag,
        note = excluded.note
    `).run({
      account_name: AddressBookRepo.GLOBAL_SCOPE,
      alias: entry.alias,
      asset: entry.asset ?? AddressBookRepo.ANY_ASSET,
      network: entry.network,
      address: entry.address,
      tag: entry.tag ?? null,
      note: entry.note ?? null,
    });
  }

  remove(alias: string): void {
    this.db.prepare('DELETE FROM address_book WHERE account_name = ? AND alias = ?').run(AddressBookRepo.GLOBAL_SCOPE, alias);
  }

  private mapRow(row: Record<string, unknown>): AddressBookEntry {
    return {
      alias: String(row.alias),
      asset: String(row.asset) === AddressBookRepo.ANY_ASSET ? undefined : String(row.asset),
      network: String(row.network),
      address: String(row.address),
      tag: row.tag ? String(row.tag) : undefined,
      note: row.note ? String(row.note) : undefined,
    };
  }
}
