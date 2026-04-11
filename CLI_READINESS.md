# CLI Readiness Checklist

This file tracks the remaining work needed before `mexc-monitor` is ready for practical day-to-day CLI use.

## 1. Runtime State Isolation

- Problem: runtime state is currently shared globally, so cooldown, last error, and withdraw-in-progress can leak across accounts or asset rules.
- Goal: persist runtime state per `account + asset`, and make CLI status/reporting use the correct scope.
- Verification:
  - Two different rules can hold distinct cooldown and last error values.
  - `watch-all` and `withdraw-all` no longer overwrite each other's runtime state.

## 2. Observability and Operator Feedback

- Problem: output is still thin for operators running the CLI repeatedly or in long-lived sessions.
- Goal: improve `status`, `logs`, and `history` so they can be filtered and used to inspect one account/rule clearly.
- Verification:
  - Runtime status can be viewed per account and asset.
  - Logs/history can be filtered and remain readable from the terminal.

## 3. Live Mode Safety

- Problem: `live` mode still relies mostly on account config and basic limits; there is no explicit command-time acknowledgement.
- Goal: require explicit confirmation when a command may perform real withdrawals.
- Verification:
  - Live withdraw commands fail fast without an explicit confirmation flag.
  - Dry-run behavior remains unchanged.

## 4. Automated Tests

- Problem: correctness still depends too much on manual CLI testing.
- Goal: add focused tests for amount policy, risk control, config validation, and runtime persistence.
- Verification:
  - `bun test` covers the main decision logic and scoped runtime storage.

## 5. Real Exchange Validation

- Problem: the code has not yet been verified end-to-end against real MEXC credentials.
- Goal: keep this as the final external validation step after local correctness is in place.
- Verification:
  - `account test`, `balance`, dry-run `withdraw`, and one small live withdraw succeed with real credentials.

## Status

- [x] Runtime state isolation
- [x] Observability and operator feedback
- [x] Live mode safety
- [x] Automated tests
- [ ] Real exchange validation
