import type { Database } from 'bun:sqlite';

import type { AddressBookEntry } from '../../core/types';

export class AddressBookRepo {
  constructor(private readonly db: Database) {}

  get(accountName: string, alias: string): AddressBookEntry | null {
    const row = this.db.prepare('SELECT * FROM address_book WHERE account_name = ? AND alias = ?').get(accountName, alias) as Record<string, unknown> | null;
    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  list(accountName?: string): AddressBookEntry[] {
    const rows = (
      accountName
        ? this.db.prepare('SELECT * FROM address_book WHERE account_name = ? ORDER BY alias ASC').all(accountName)
        : this.db.prepare('SELECT * FROM address_book ORDER BY account_name ASC, alias ASC').all()
    ) as Record<string, unknown>[];

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
      account_name: entry.accountName,
      alias: entry.alias,
      asset: entry.asset,
      network: entry.network,
      address: entry.address,
      tag: entry.tag ?? null,
      note: entry.note ?? null,
    });
  }

  remove(accountName: string, alias: string): void {
    this.db.prepare('DELETE FROM address_book WHERE account_name = ? AND alias = ?').run(accountName, alias);
  }

  renameAccount(from: string, to: string): void {
    if (from === to) {
      return;
    }

    const entries = this.list(from);
    for (const entry of entries) {
      this.save({
        ...entry,
        accountName: to,
      });
    }

    this.db.prepare('DELETE FROM address_book WHERE account_name = ?').run(from);
  }

  private mapRow(row: Record<string, unknown>): AddressBookEntry {
    return {
      accountName: String(row.account_name),
      alias: String(row.alias),
      asset: String(row.asset),
      network: String(row.network),
      address: String(row.address),
      tag: row.tag ? String(row.tag) : undefined,
      note: row.note ? String(row.note) : undefined,
    };
  }
}
