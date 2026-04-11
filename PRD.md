# PRD：CLI 版交易所余额监控与自动提款工具（首版支持 MEXC）

## 1. 文档信息

- 产品名称：`mexc-monitor`
- 形态：本地运行的命令行工具（CLI）
- 首版目标交易所：MEXC
- 接入方式：基于 `ccxt`
- 实现语言：TypeScript
- 配置与审计存储：SQLite
- 凭证存储：加密后存 SQLite
- 解锁方式：执行需要访问交易所的命令时显式传入 `--password`
- 当前结论：架构保留扩展到更多 `ccxt` 交易所的空间，但首版只正式实现 `MEXC`
- 当前阶段：CLI 核心能力已完成，剩余主要工作为真实 MEXC 凭证联调与小额 live 验证

## 2. 产品背景

用户需要一个本地运行的监控工具，用于持续监控交易所账户中的资产余额。当余额超过预设阈值时，系统自动执行提款，将超额资产提到指定链上地址。

当前产品已经不是 TUI，而是面向运维和自托管场景的 CLI。用户通过命令完成配置、查询状态、执行单次检查，以及启动持续监控。

## 3. 产品目标

首版目标：

1. 通过 CLI 管理 MEXC 账户配置与资产提款规则
2. 持续监控指定账户下的资产余额
3. 当余额高于上限时执行或模拟自动提款
4. 不依赖 `.env`
5. 用 SQLite 持久化配置、运行状态、日志和提款历史
6. 对 API 凭证进行加密存储
7. 默认以 `dry_run` 运行
8. 业务架构支持未来扩展到更多 `ccxt` 交易所

## 4. 非目标

首版不包含：

- TUI 界面
- Web UI
- 云端同步
- 多用户权限系统
- 通知集成（Webhook、Telegram、Slack）
- 系统服务托管与守护进程管理
- 多地址路由与高级资金调度策略
- HSM / KMS 集成

## 5. 已知事实

以下事实来自当前实现，必须作为 PRD 约束：

1. 必须使用 TypeScript。
2. 必须使用 `ccxt`。
3. 首版目标交易所是 `MEXC`。
4. 架构应支持未来扩展到任意 `ccxt` 交易所。
5. 当前只正式实现 `MexcAdapter`。
6. 当前产品是 CLI，不是 TUI。
7. 不使用 `.env`。
8. 数据库路径固定为工作目录下的 `data/app.db`。
9. 使用 SQLite 存储账户配置、资产规则、运行状态、事件日志和提款历史。
10. API Key / Secret 不得明文存储。
11. 凭证使用用户提供的密码经 `scrypt + AES-256-GCM` 加密后写入 SQLite。
12. 需要访问交易所的命令必须显式传入 `--password` 以解密凭证。
13. 系统默认账户配置为 `dry_run`、`checkIntervalMs=30000`、`withdrawCooldownMs=600000`。
14. 自动提款属于高风险能力，必须内建风控。
15. 核心业务逻辑不应耦合某一个交易所实现。
16. 余额监控、提款逻辑、风控、审计必须与 CLI 展示层解耦。
17. 资金相关行为必须保留审计记录。
18. 金额运算不能依赖普通 JS 浮点数。
19. 交易所差异应通过 adapter 层封装。
20. 当前 CLI 已支持多账户配置与全账户批量命令。

## 6. 目标用户

主要用户为：

- 个人开发者
- 本地自托管脚本使用者
- 需要持续监控交易所余额并自动执行资金归集的人

典型场景：

- 某资产余额持续增加，需要超过阈值后自动提到外部地址
- 在服务器或终端会话中长期运行监控
- 希望通过明确的 CLI 命令管理配置，而不是环境变量或手改数据库

## 7. 产品形态

产品是一个本地命令行工具，核心交互由子命令组成。

当前命令面覆盖：

- `setup`
- `status`
- `logs`
- `history`
- `balance`
- `watch`
- `withdraw`
- `watch-withdraw`
- `watch-all`
- `withdraw-all`
- `watch-withdraw-all`
- `account set|list|show|remove|rename|test`
- `asset-rule add|list|show|update|remove|enable|disable`

## 8. 核心用户流程

### 8.1 首次配置流程

1. 用户执行 `account set`
2. 通过参数传入账户名、密码、API Key、API Secret、检查间隔、cooldown、模式
3. 系统初始化 SQLite schema
4. 系统用密码加密凭证并保存账户配置
5. 用户执行 `account test`
6. 系统使用解密后的凭证完成交易所 API 健康检查
7. 用户执行 `asset-rule add`
8. 配置资产、网络、提币地址、阈值与限额
9. 系统校验规则并写入 SQLite

### 8.2 单次查询流程

1. 用户执行 `balance --account ... --password ...`
2. 系统解密凭证并初始化交易所 adapter
3. 拉取账户全部 free balance
4. 以命令行文本形式输出当前余额

### 8.3 单次提款检查流程

1. 用户执行 `withdraw --account ... --password ...`
2. 系统加载该账户下所有启用的资产规则
3. 逐条拉取余额并计算是否需要提款
4. 执行风控判断
5. 若账户模式为 `dry_run`，记录模拟提款
6. 若账户模式为 `live`，命令必须显式传入 `--confirm-live`
7. 通过确认后才调用交易所提现接口
8. 写入按 `account + asset` 隔离的运行状态、日志和提款历史

### 8.4 持续监控流程

1. 用户执行 `watch`、`watch-withdraw`、`watch-all` 或 `watch-withdraw-all`
2. 系统按轮询间隔拉取余额
3. 输出当轮余额快照
4. 若命令带提款能力，则对启用规则执行监控与提款判断
5. 循环运行直到进程被外部终止

## 9. 功能需求

### 9.1 账户配置管理

系统必须支持通过 CLI 配置并持久化以下账户级字段：

- `name`
- `exchangeId`
- `checkIntervalMs`
- `withdrawCooldownMs`
- `mode`
- 加密后的 API Key / Secret

### 9.2 资产规则管理

系统必须支持通过 CLI 配置并持久化以下规则字段：

- `accountName`
- `exchangeId`
- `asset`
- `network`
- `withdrawAddress`
- `withdrawTag`
- `targetBalance`
- `maxBalance`
- `minWithdrawAmount`
- `maxWithdrawAmount`
- `enabled`

系统必须校验：

- 必填字段完整
- `targetBalance <= maxBalance`
- `minWithdrawAmount <= maxWithdrawAmount`
- 数值字段必须是合法非负十进制字符串

### 9.3 凭证保护

系统必须：

- 加密保存 API Key / Secret
- 禁止明文落库
- 不在日志中输出明文凭证
- 仅在命令执行期间将解密后的凭证保存在内存中

### 9.4 余额监控

系统必须：

- 定时拉取指定账户资产的 free balance
- 支持单账户与多账户轮询
- 按 `account + asset` 更新 `lastBalance`、`lastCheckAt`、`lastSuccessCheckAt`、`apiStatus` 等运行状态
- 通过标准输出展示当前轮询结果

### 9.5 自动提款

系统必须支持：

- 当余额高于上限时触发提款判断
- 默认采用“提到目标余额”的策略
- 即：`withdrawAmount = currentBalance - targetBalance`
- 单账户执行与全账户批量执行

### 9.6 运行模式

系统必须支持：

- `dry_run`
- `live`

首版默认：

- `dry_run`

说明：

- 当前 CLI 中 `mode` 由账户配置控制。
- 当账户处于 `live` 模式时，提款相关命令必须额外显式传入 `--confirm-live`。

### 9.7 风控

系统必须至少支持：

- `paused` 检查
- `enabled` 检查
- `cooldown` 检查
- 最小提款额检查
- 最大提款额检查
- 并发提款保护
- 配置合法性检查
- 凭证已解锁检查

### 9.8 审计

系统必须记录：

- 事件日志
- 提款历史
- 日志和历史中的 `accountName`
- 日志和历史中的 `asset`
- 提款失败原因
- 模拟提款记录
- 成功提款记录
- 被拒绝的提款记录

### 9.9 可观察性

系统必须提供基础运维查询能力：

- `status` 按账户与资产查看 runtime 状态
- `logs` 按账户、资产、级别查看最近事件日志
- `history` 按账户、资产、状态查看最近提款历史
- 命令执行失败时返回明确错误

## 9.10 测试与验收边界

当前仓库内的本地验收已经覆盖：

- 金额策略测试
- 风控测试
- 配置校验测试
- scoped runtime 持久化测试
- CLI 帮助、过滤输出、live guard 的手动验证

当前仍未在仓库内完成、必须依赖真实交易所环境的验收：

- `account test` 使用真实 MEXC 凭证成功
- `balance` 成功返回真实余额
- `withdraw` 在 `dry_run` 下输出与审计结果符合预期
- 至少一次小额 `live` 提现验证成功

## 10. 提款策略

### 10.1 默认策略

当：

- `balance > maxBalance`

则：

- `withdrawAmount = balance - targetBalance`

### 10.2 策略约束

- 若结果小于最小提款额，则拒绝执行
- 若结果大于最大提款额，则拒绝执行
- 若处于 cooldown 或已有提款进行中，则拒绝执行
- 若模式为 `dry_run`，仅记录模拟结果，不触发真实提现

## 11. 数据持久化

SQLite 需要承担以下角色：

- 账户配置库
- 资产规则库
- 运行状态库
- 事件日志库
- 提款历史库

## 12. 未来演进方向

后续可以扩展但当前未承诺：

- 支持更多 `ccxt` 交易所
- 更细粒度的资产筛选与路由策略
- 更完善的通知与告警
- 更强的进程守护与部署方案
- 在 CLI 之上增加其他交互层，但不能影响核心监控与提款逻辑

## 13. 当前结论

截至当前版本，`mexc-monitor` 已经是一个纯 CLI 的本地工具，具备：

- 多账户配置
- 多资产规则管理
- 加密凭证存储
- 余额查询与轮询
- `dry_run` / `live` 提款判断与执行
- 按账户和资产隔离的 runtime 状态
- 可过滤的日志与提款历史
- 基础自动化测试

当前距离“可由开发者自行实际使用”只剩真实 MEXC 环境联调与一次小额 live 验证。
