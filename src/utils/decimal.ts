import Decimal from 'decimal.js';

export function decimal(value: string | number): Decimal {
  return new Decimal(value);
}
