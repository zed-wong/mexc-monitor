# mexc-monitor

`mexc-monitor` is a local CLI for watching MEXC balances and automatically withdrawing excess funds to preconfigured addresses.

It is built around a single global CLI master password, encrypted credential storage, operator-friendly diagnostics, and a cautious default workflow.

> [!WARNING]
> Automatic withdrawals are high risk. Start in `dry_run`, verify every rule, and only use `live` mode with `--confirm-live` once you are confident the setup is correct.

## What it does

- Stores MEXC API credentials in SQLite with encryption
- Uses one global CLI master password for all accounts
- Supports threshold-based withdrawals by asset amount or estimated `USDT` value
- Tracks audit logs and withdraw attempt history
- Provides a `doctor` command for operator guidance
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
bun run src/index.ts balance check-one -a main
bun run src/index.ts balance check-one -a main --master-password 'your-cli-master-password'
```

Test every configured account:

```bash
bun run src/index.ts balance check-all
bun run src/index.ts balance check-all --master-password 'your-cli-master-password'
```

`account test` and `account test-all` remain available as reference aliases for `balance check-one` and `balance check-all`.

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

### 4. Verify balances and API health

```bash
bun run src/index.ts balance check-one -a main
bun run src/index.ts balance check-one -a main --master-password 'your-cli-master-password'
```

The output includes:

- free balance per asset
- estimated `USDT` value when a quote is available
- total estimated account value

### 5. Run a single withdraw check

```bash
bun run src/index.ts withdraw check-one -a main
bun run src/index.ts withdraw check-one -a main --master-password 'your-cli-master-password'
```

For `live` accounts, add explicit confirmation:

```bash
bun run src/index.ts withdraw check-one \
  -a main \
  --master-password 'your-cli-master-password' \
  --confirm-live
```

### 6. Start continuous monitoring

```bash
bun run src/index.ts withdraw check-one-loop -a main
bun run src/index.ts withdraw check-one-loop -a main --master-password 'your-cli-master-password'
```

For `live` mode:

```bash
bun run src/index.ts withdraw check-one-loop \
  -a main \
  --master-password 'your-cli-master-password' \
  --confirm-live
```

## Command reference

### 1. Start here

```bash
bun run src/index.ts account add
bun run src/index.ts balance check-one -a main
bun run src/index.ts asset-rule add -a main --asset BTC --network BTC --withdraw-address bc1qxxxx --max-balance-usdt 1500 --target-balance-usdt 300
bun run src/index.ts withdraw check-one -a main
bun run src/index.ts withdraw check-one-loop -a main --interval-ms 30000
```

### 2. Scale to all accounts

```bash
bun run src/index.ts balance check-all
bun run src/index.ts balance check-all-loop
bun run src/index.ts withdraw check-all
bun run src/index.ts withdraw check-all-loop
```

Non-interactive multi-account examples:

```bash
bun run src/index.ts balance check-all-loop --master-password 'your-cli-master-password'
bun run src/index.ts withdraw check-all --master-password 'your-cli-master-password'
bun run src/index.ts withdraw check-all-loop --master-password 'your-cli-master-password'
```

For `live` accounts, add `--confirm-live` to `withdraw check-one`, `withdraw check-all`, `withdraw check-one-loop`, and `withdraw check-all-loop`.

### 3. Check what is going on

```bash
bun run src/index.ts doctor
bun run src/index.ts doctor -a main

bun run src/index.ts logs
bun run src/index.ts logs -a main --asset BTC
bun run src/index.ts logs --level error

bun run src/index.ts withdraw attempts
bun run src/index.ts withdraw attempts -a main
bun run src/index.ts withdraw attempts --status failed
```

### 4. Manage accounts

```bash
bun run src/index.ts account add
bun run src/index.ts account add -a main --update-credentials
bun run src/index.ts account list
bun run src/index.ts account show -a main
bun run src/index.ts account rename -a main --to prod
bun run src/index.ts account remove -a main
```

### 5. Manage asset rules

```bash
bun run src/index.ts asset-rule list -a main
bun run src/index.ts asset-rule show -a main --asset BTC
bun run src/index.ts asset-rule add -a main --asset BTC --network BTC --withdraw-address bc1qxxxx --max-balance-usdt 1500 --target-balance-usdt 300
bun run src/index.ts asset-rule update -a main --asset BTC --max-balance-usdt 2000
bun run src/index.ts asset-rule enable -a main --asset BTC
bun run src/index.ts asset-rule disable -a main --asset BTC
bun run src/index.ts asset-rule remove -a main --asset BTC
```

Meaning of each `asset-rule` command:

- `asset-rule add`: create a new withdraw rule for one account and one asset. Use this when you are defining the destination address, network, thresholds, and safety limits for the first time.
- `asset-rule update`: change an existing rule without recreating it. Use this when you need to adjust balances, USDT thresholds, withdraw limits, network, tag, or destination address.
- `asset-rule enable`: turn a rule back on so `withdraw ...` commands can evaluate it again.
- `asset-rule disable`: temporarily stop using a rule without deleting it. This is the safe pause option if you want to keep the rule for later.
- `asset-rule list`: show the summary view for all rules on one account. Use this to see what assets are covered and whether each rule is currently enabled.
- `asset-rule show`: inspect one rule in full detail, including its thresholds and destination fields.
- `asset-rule remove`: permanently delete a rule. Use this only when the rule is no longer needed.

### 6. Auth and maintenance

```bash
bun run src/index.ts auth status
bun run src/index.ts auth set-master-password
```

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
2. Verify API access with `balance check-one`
3. Add one or more asset rules
4. Inspect the first withdraw decision with `withdraw check-one`
5. Review logs and withdraw attempts with `doctor`, `logs`, and `withdraw attempts`
6. Use `withdraw check-one-loop` in `dry_run`
7. Switch to `live` only after the results look correct

## Notes

- The project currently targets `MEXC`
- `USDT` value estimates depend on exchange quote availability
- Missing quotes do not break balance checks; they only remove the estimate
- Interactive master-password prompts require a TTY
