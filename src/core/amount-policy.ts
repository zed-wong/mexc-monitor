import type { AssetRule } from './types';
import { decimal } from '../utils/decimal';

export function computeWithdrawAmount(balance: string, settings: AssetRule): string | null {
  const current = decimal(balance);
  const max = decimal(settings.maxBalance);

  if (current.lte(max)) {
    return null;
  }

  return current.minus(settings.targetBalance).toFixed();
}
