import type { AssetRule } from './types';
import { decimal } from '../utils/decimal';

export function computeWithdrawAmount(
  balance: string,
  settings: AssetRule,
  quotePriceUsdt?: string | null,
): string | null {
  const current = decimal(balance);
  const max = decimal(settings.maxBalance);

  const quantityTriggered = current.gt(max);

  if (quantityTriggered) {
    return current.minus(settings.targetBalance).toFixed();
  }

  if (settings.maxBalanceUsdt && settings.targetBalanceUsdt) {
    if (!quotePriceUsdt) {
      return null;
    }

    const currentValueUsdt = current.mul(quotePriceUsdt);
    if (currentValueUsdt.lte(settings.maxBalanceUsdt)) {
      return null;
    }

    const targetAmount = decimal(settings.targetBalanceUsdt).div(quotePriceUsdt);
    return current.minus(targetAmount).toFixed();
  }

  return null;
}
