# mexc-monitor

`mexc-monitor` is a local CLI for watching MEXC balances and automatically withdrawing excess funds to preconfigured addresses.

It is built around a single global CLI master password, encrypted credential storage, operator-friendly diagnostics, and a cautious default workflow.

> [!WARNING]
> Automatic withdrawals are high risk. Start in `dry_run`, verify every rule, and only use `live` mode with `--confirm-live` once you are confident the setup is correct.

## What it does

- Stores MEXC API credentials in SQLite with encryption
- Uses one global CLI master password for all accounts
- Supports threshold-based withdrawals by asset amount or estimated `USDT` value
- Tracks runtime state, audit logs, and withdraw history
- Provides setup and doctor commands for operator guidance
- Supports single-account and multi-account workflows

## Requirements

- Node.js
- npm
- Bun
- MEXC API key and secret

## Install

```bash
npm install
```

Run the CLI in development:

```bash
bun run src/index.ts --help
```

Useful local checks:

```bash
npm run typecheck
bun test
```

## Storage

The CLI stores local state in:

```text
data/app.db
```

This database contains:

- account configuration
- encrypted API credentials
- asset withdrawal rules
- runtime state
- audit logs
- withdraw history
- CLI master-password metadata

## Security model

The project now uses a single global CLI master password.

- The master password is shared by the whole CLI, not by one account
- The first credential write can initialize it automatically
- You can rotate it later with `auth set-master-password`
- If `--master-password` is omitted, the CLI prompts securely in the terminal
- The old `--password` flag still exists as a deprecated compatibility alias

Check or rotate the master password:

```bash
bun run src/index.ts auth status
bun run src/index.ts auth set-master-password
```

To rotate explicitly:

```bash
bun run src/index.ts auth set-master-password \
  --current-master-password 'old-master-password' \
  --new-master-password 'new-master-password'
```

## Quick start

### 1. Create an account

```bash
bun run src/index.ts account add
```

By default, `account add` is interactive. It prompts for:

- the account name
- the account mode
- the check interval
- the withdraw cooldown
- the global CLI master password
- the MEXC API key
- the MEXC API secret

It then stores the account and encrypted credentials locally.

You can still prefill any of those values with flags:

```bash
bun run src/index.ts account add -a main --mode dry_run
bun run src/index.ts account add -a main --interval-ms 10000
bun run src/index.ts account add -a main --withdraw-cooldown-ms 600000
```

Update API credentials through the interactive prompt:

```bash
bun run src/index.ts account add -a main --update-credentials
```

If you prefer non-interactive usage:

```bash
bun run src/index.ts account add \
  -a main \
  --mode dry_run \
  --interval-ms 10000 \
  --withdraw-cooldown-ms 600000 \
  --master-password 'your-cli-master-password'
```

That still prompts for the API key and API secret. The setup only asks for values you did not pass explicitly.

### 2. Test API access

```bash
bun run src/index.ts account test -a main
bun run src/index.ts account test -a main --master-password 'your-cli-master-password'
```

Test every configured account:

```bash
bun run src/index.ts account test-all
bun run src/index.ts account test-all --master-password 'your-cli-master-password'
```

### 3. Add a withdraw rule

Amount-based threshold:

```bash
bun run src/index.ts asset-rule add \
  -a main \
  --asset USDT \
  --network ERC20 \
  --withdraw-address 0xabc... \
  --max-balance 1000 \
  --target-balance 200 \
  --min-withdraw-amount 10
```

USDT-value-based threshold:

```bash
bun run src/index.ts asset-rule add \
  -a main \
  --asset BTC \
  --network BTC \
  --withdraw-address bc1qxxxx \
  --max-balance-usdt 1000 \
  --target-balance-usdt 200 \
  --min-withdraw-amount 0.001
```

You can combine amount thresholds and USDT-value thresholds in the same rule.

### 4. Check balances

```bash
bun run src/index.ts balance -a main
bun run src/index.ts balance -a main --master-password 'your-cli-master-password'
```

The output includes:

- free balance per asset
- estimated `USDT` value when a quote is available
- total estimated account value

### 5. Run a single withdraw check

```bash
bun run src/index.ts withdraw -a main
bun run src/index.ts withdraw -a main --master-password 'your-cli-master-password'
```

For `live` accounts, add explicit confirmation:

```bash
bun run src/index.ts withdraw \
  -a main \
  --master-password 'your-cli-master-password' \
  --confirm-live
```

### 6. Start continuous monitoring

Balance-only watch:

```bash
bun run src/index.ts watch -a main
bun run src/index.ts watch -a main --master-password 'your-cli-master-password'
```

Monitor and evaluate withdrawals continuously:

```bash
bun run src/index.ts watch-withdraw -a main
bun run src/index.ts watch-withdraw -a main --master-password 'your-cli-master-password'
```

For `live` mode:

```bash
bun run src/index.ts watch-withdraw \
  -a main \
  --master-password 'your-cli-master-password' \
  --confirm-live
```

## Command reference

### Readiness and diagnostics

```bash
bun run src/index.ts setup
bun run src/index.ts doctor
bun run src/index.ts doctor -a main
```

### Auth

```bash
bun run src/index.ts auth status
bun run src/index.ts auth set-master-password
```

### Account management

```bash
bun run src/index.ts account list
bun run src/index.ts account show -a main
bun run src/index.ts account rename -a main --to prod
bun run src/index.ts account remove -a main
```

### Account health checks

```bash
bun run src/index.ts account test -a main
bun run src/index.ts account test-all
```

### Asset rule management

```bash
bun run src/index.ts asset-rule list -a main
bun run src/index.ts asset-rule show -a main --asset BTC
bun run src/index.ts asset-rule add -a main --asset BTC --network BTC --withdraw-address bc1qxxxx --max-balance-usdt 1500 --target-balance-usdt 300
bun run src/index.ts asset-rule update -a main --asset BTC --max-balance-usdt 2000
bun run src/index.ts asset-rule enable -a main --asset BTC
bun run src/index.ts asset-rule disable -a main --asset BTC
bun run src/index.ts asset-rule remove -a main --asset BTC
```

### Runtime state, logs, and history

```bash
bun run src/index.ts status
bun run src/index.ts status -a main
bun run src/index.ts status -a main --asset BTC

bun run src/index.ts logs
bun run src/index.ts logs -a main --asset BTC
bun run src/index.ts logs --level error

bun run src/index.ts history
bun run src/index.ts history -a main
bun run src/index.ts history --status failed
```

### Balance and watch commands

```bash
bun run src/index.ts balance -a main
bun run src/index.ts watch -a main --interval-ms 30000
bun run src/index.ts watch-withdraw -a main --interval-ms 30000
```

### Multi-account commands

```bash
bun run src/index.ts watch-all
bun run src/index.ts withdraw-all
bun run src/index.ts watch-withdraw-all
```

Non-interactive multi-account examples:

```bash
bun run src/index.ts watch-all --master-password 'your-cli-master-password'
bun run src/index.ts withdraw-all --master-password 'your-cli-master-password'
bun run src/index.ts watch-withdraw-all --master-password 'your-cli-master-password'
```

For `live` accounts, add `--confirm-live` to `withdraw`, `withdraw-all`, `watch-withdraw`, and `watch-withdraw-all`.

## Rule model

Each asset rule belongs to one account and one asset.

Supported threshold types:

1. Amount thresholds

- `maxBalance`: trigger when balance rises above this amount
- `targetBalance`: withdraw back down to this amount

2. Estimated `USDT` value thresholds

- `maxBalanceUsdt`: trigger when estimated value rises above this amount
- `targetBalanceUsdt`: withdraw back down to this target value

Additional controls:

- `minWithdrawAmount`
- `maxWithdrawAmount`
- cooldown windows
- paused runtime states
- in-progress withdraw protection
- `dry_run` vs `live`

## Typical operator workflow

1. Create an account and keep it in `dry_run`
2. Verify API access with `account test`
3. Add one or more asset rules
4. Check balances with `balance`
5. Run `withdraw` to inspect the plan
6. Use `watch-withdraw` in `dry_run`
7. Switch to `live` only after the results look correct

## Notes

- The project currently targets `MEXC`
- `USDT` value estimates depend on exchange quote availability
- Missing quotes do not break balance checks; they only remove the estimate
- Interactive master-password prompts require a TTY
