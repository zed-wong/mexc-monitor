# mexc-monitor

`mexc-monitor` 是一个本地运行的 CLI，用来监控 MEXC 账户余额，并在超出阈值时自动提现到指定地址。

它的设计重点是：

- 本地运行，不依赖 `.env`
- API 凭证加密存储到 SQLite
- 默认 `dry_run`
- 支持按币数量阈值或按 `USDT` 估值阈值触发提现
- 提供运行状态、审计日志、提现历史和运维诊断命令

> [!WARNING]
> 自动提现是高风险操作。建议先用 `dry_run` 跑通，再切到 `live`，并且只在确认无误后使用 `--confirm-live`。

## 功能概览

- 管理 MEXC 账户和加密凭证
- 配置资产提现规则
- 查看账户余额和 `USDT` 估值
- 单次提现检查
- 持续监控并自动提现
- 查看运行状态、日志、提现历史
- 用 `setup` / `doctor` 获得下一步建议

## 环境要求

- Node.js / npm
- Bun
- MEXC API Key / Secret

安装依赖：

```bash
npm install
```

开发运行：

```bash
bun run src/index.ts --help
```

常用脚本：

```bash
npm run typecheck
bun test
```

## 数据存储

程序会在工作目录下使用 SQLite：

```text
data/app.db
```

其中会保存：

- 账户配置
- 加密后的 API 凭证
- 资产规则
- runtime 状态
- 审计日志
- 提现历史

## 快速开始

### 1. 创建账户

```bash
bun run src/index.ts account add -a main
```

默认模式是 `live`。如果你想显式切到 `dry_run`，或者之后再改模式/轮询配置，只需要带 `-a`，例如：

```bash
bun run src/index.ts account add -a main --mode dry_run
bun run src/index.ts account add -a main --interval-ms 10000
```

创建新账户时，CLI 会交互式提示输入 API key 和 secret，不会出现在 shell history 里。已有账户如果要轮换凭证，执行 `bun run src/index.ts account add -a main --update-credentials`，CLI 也会交互式提示输入统一的 `CLI master password`、API key 和 secret。

`CLI master password` 是整个命令行工具共用的主密码，不是某个账户专属密码。

可以随时配置或轮换：

```bash
bun run src/index.ts auth status
bun run src/index.ts auth set-master-password
```


### 2. 测试 API

```bash
bun run src/index.ts account test -a main
bun run src/index.ts account test -a main --master-password 'your-cli-master-password'
bun run src/index.ts account test-all --master-password 'your-cli-master-password'
```

### 3. 添加提现规则

按币数量触发：

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

按 `USDT` 估值触发：

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

数量阈值和 `USDT` 阈值可以同时设置。

### 4. 查看余额

```bash
bun run src/index.ts balance -a main
bun run src/index.ts balance -a main --master-password 'your-cli-master-password'
```

输出会显示：

- 每个资产余额
- 每个资产的大致 `USDT` 估值
- 账户总估值

### 5. 先跑一次提现检查

```bash
bun run src/index.ts withdraw -a main
bun run src/index.ts withdraw -a main --master-password 'your-cli-master-password'
```

如果需要提现，会先打印 `Withdraw plan`，包括：

- 当前余额
- 数量阈值
- `USDT` 估值阈值
- 计划提现数量
- 计划提现对应的 `USDT` 估值
- 网络和目标地址

### 6. 启动持续监控

只监控余额：

```bash
bun run src/index.ts watch -a main
bun run src/index.ts watch -a main --master-password 'your-cli-master-password'
```

监控并自动提现：

```bash
bun run src/index.ts watch-withdraw -a main
bun run src/index.ts watch-withdraw -a main --master-password 'your-cli-master-password'
```

如果账户是 `live`，需要显式确认：

```bash
bun run src/index.ts watch-withdraw \
  -a main \
  --confirm-live
```

## 规则说明

每条规则绑定一个账户和一个资产。

支持两种触发方式：

1. 按数量阈值

- `maxBalance`: 超过这个数量时触发
- `targetBalance`: 提现后希望剩余的数量

2. 按 `USDT` 估值阈值

- `maxBalanceUsdt`: 超过这个估值时触发
- `targetBalanceUsdt`: 提现后希望剩余的估值

触发后，系统会计算应提现多少资产，并继续通过这些约束做风控：

- `minWithdrawAmount`
- `maxWithdrawAmount`
- cooldown
- paused
- withdraw in progress
- `dry_run` / `live`

## 常用命令

### 诊断和引导

查看当前准备状态：

```bash
bun run src/index.ts setup
```

查看更详细的诊断：

```bash
bun run src/index.ts doctor
bun run src/index.ts doctor -a main
```

### 账户管理

```bash
bun run src/index.ts account list
bun run src/index.ts account show -a main
bun run src/index.ts account rename -a main --to prod
bun run src/index.ts account remove -a main
```

### 规则管理

```bash
bun run src/index.ts asset-rule list -a main
bun run src/index.ts asset-rule show -a main --asset BTC
bun run src/index.ts asset-rule update -a main --asset BTC --max-balance-usdt 1500
bun run src/index.ts asset-rule enable -a main --asset BTC
bun run src/index.ts asset-rule disable -a main --asset BTC
bun run src/index.ts asset-rule remove -a main --asset BTC
```

### 运行状态和审计

查看 runtime：

```bash
bun run src/index.ts status
bun run src/index.ts status -a main
bun run src/index.ts status -a main --asset BTC
```

查看日志：

```bash
bun run src/index.ts logs
bun run src/index.ts logs -a main --asset BTC
bun run src/index.ts logs --level error
```

查看提现历史：

```bash
bun run src/index.ts history
bun run src/index.ts history -a main
bun run src/index.ts history --status failed
```

## 多账户模式

可以配置多个账户，然后使用批量命令：

```bash
bun run src/index.ts watch-all --master-password 'your-cli-master-password'
bun run src/index.ts withdraw-all --master-password 'your-cli-master-password'
bun run src/index.ts watch-withdraw-all --master-password 'your-cli-master-password'
```

如果不传 `--master-password`，CLI 会用安全交互方式提示输入统一的全局主密码。

## 输出里会看到什么

### `balance`

- 资产余额
- 单资产估值 `(~123.45 USDT)`
- `Total estimated value`

### `withdraw`

- 是否需要提现
- 如果需要，显示 `Withdraw plan`
- 如果不需要，显示当前余额和阈值

### `watch` / `watch-all`

- 每轮 cycle 编号
- 当前账户数 / 资产数
- 自动提现是否开启
- 每个资产余额和估值
- 下一轮休眠时间

### `doctor`

- 账户数量
- 规则数量
- runtime 状态数量
- 风险提醒
- 推荐下一步命令

## 安全建议

- 永远先用 `dry_run`
- 先跑 `withdraw`，再跑 `watch-withdraw`
- 开 `live` 前先确认地址、网络、最小/最大提现量
- `live` 模式下必须显式加 `--confirm-live`
- 定期看 `status`、`logs`、`history`

## 当前限制

- 首版只正式支持 `MEXC`
- 价格估值统一按 `USDT` 计算
- `USDT` 估值依赖交易所行情接口，拿不到价格时只会跳过估值展示，不会影响基础余额查询
