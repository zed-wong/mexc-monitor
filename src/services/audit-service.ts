import type { EventLog, WithdrawHistoryItem } from '../core/types';
import type { EventLogRepo } from '../db/repo/event-log-repo';
import type { WithdrawHistoryRepo } from '../db/repo/withdraw-history-repo';
import { nowIso } from '../utils/time';

export class AuditService {
  constructor(
    private readonly eventLogRepo: EventLogRepo,
    private readonly withdrawHistoryRepo: WithdrawHistoryRepo,
  ) {}

  log(
    level: EventLog['level'],
    type: string,
    message: string,
    meta?: unknown,
    scope?: { accountName?: string; asset?: string },
  ): void {
    this.eventLogRepo.append({
      accountName: scope?.accountName,
      asset: scope?.asset,
      createdAt: nowIso(),
      level,
      type,
      message,
      metaJson: meta ? JSON.stringify(meta) : undefined,
    });
  }

  recordWithdraw(item: WithdrawHistoryItem): void {
    this.withdrawHistoryRepo.append(item);
  }
}
