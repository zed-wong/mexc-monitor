# PRD：基于 TUI 的交易所余额监控与自动提款工具（首版支持 MEXC）

## 1. 文档信息

- 产品名称：Exchange Balance Monitor
- 形态：本地运行的终端 TUI 应用
- 首版目标交易所：MEXC
- 接入方式：基于 `ccxt`
- 实现语言：TypeScript
- 配置存储：SQLite
- 凭证存储：加密后存 SQLite
- 启动方式：进入应用时输入主密码解锁
- 当前结论：架构支持扩展到任意 `ccxt` 交易所，但首版只正式实现 `MEXC`

## 2. 产品背景

用户需要一个本地运行的监控工具，用于持续监控交易所账户中的某个资产余额。当余额超过预设范围时，系统自动执行提款，将超额资产提到指定链上地址。

用户不希望使用 `.env` 管理配置，而希望：
- 使用 `SQLite` 保存配置与运行信息
- 通过 `TUI` 界面完成配置、查看状态和操作
- 使用主密码在启动时解锁敏感凭证

## 3. 产品目标

本产品首版目标：

1. 持续监控指定交易所资产余额
2. 当余额高于上限时自动提款
3. 通过 TUI 提供完整可视化操作界面
4. 不使用 `.env`
5. 用 SQLite 持久化配置、状态、日志和历史
6. 对 API 凭证进行加密存储
7. 启动时要求输入主密码解锁
8. 默认以 `DRY_RUN` 运行
9. 业务架构支持未来扩展到更多 `ccxt` 交易所

## 4. 非目标

首版不包含：

- 多交易所同时监控
- 多币种同时监控
- 多地址路由策略
- Web UI
- 云端同步
- 多用户权限系统
- Webhook/Telegram/Slack 通知
- 自动部署或系统服务管理
- 文档外的高级提现策略
- 生产级 HSM/KMS 集成

## 5. 已知事实

以下是当前已经明确的事实，必须作为首版设计约束：

1. 必须使用 TypeScript。
2. 必须使用 `ccxt`。
3. 首版目标交易所是 `MEXC`。
4. 架构应支持未来扩展到任意 `ccxt` 交易所。
5. 当前只正式实现 `MexcAdapter`。
6. 不使用 `.env`。
7. 使用 `SQLite` 存储配置。
8. 使用 `TUI` 完成配置与状态展示。
9. 用户偏好使用 TUI，而不是纯命令行配置。
10. 主密码方案选择为方案 B。
11. 进入程序时必须输入主密码。
12. API Key / Secret 不得明文存储。
13. 凭证应加密后存入 SQLite。
14. 未解锁前不能启动监控线程。
15. 系统默认模式为 `DRY_RUN`。
16. 自动提款属于高风险能力，必须内建风控。
17. TUI 应作为主要交互界面。
18. 核心业务逻辑不应耦合某一个交易所实现。
19. 余额监控与提款逻辑必须与 UI 解耦。
20. SQLite 同时承担配置库、运行状态库、日志库、审计库角色。
21. 资金相关行为必须保留审计记录。
22. 金额运算不能依赖普通 JS 浮点数。
23. 交易所差异应通过 adapter 层封装。
24. 未来交易所选择能力应保留架构空间，但首版 UI 可固定为 `mexc`。
25. 用户明确要求“把所有已知事实写到 PRD 里”。

## 6. 目标用户

主要用户为：
- 个人开发者
- 本地自托管脚本使用者
- 需要持续监控交易所余额并自动执行资金归集的人

使用场景：
- 某币种余额持续增加，需要超过阈值后自动提到外部地址
- 本地值守或半自动运行
- 希望通过 TUI 管理而非环境变量或手改配置文件

## 7. 产品形态

产品是一个本地终端应用，运行于 CLI/TUI 环境，具备如下页面：

- Unlock Screen
- Setup Wizard
- Dashboard
- Settings
- History
- Logs
- Confirm Modal

## 8. 核心用户流程

### 8.1 首次启动流程
1. 应用启动
2. 初始化 SQLite schema
3. 检查是否已有配置
4. 若无配置，进入 Setup Wizard
5. 用户设置主密码
6. 用户输入 MEXC API Key / Secret
7. 用户配置资产、网络、地址、阈值等
8. 系统校验配置
9. 系统加密凭证并保存到 SQLite
10. 默认保存为 `DRY_RUN`
11. 进入 Dashboard
12. 启动监控循环

### 8.2 正常启动流程
1. 应用启动
2. 打开 SQLite
3. 检查已存在配置
4. 进入 Unlock Screen
5. 用户输入主密码
6. 系统解密凭证
7. 解锁成功后初始化交易所 adapter
8. 启动监控循环
9. 进入 Dashboard

### 8.3 监控流程
1. 周期性拉取余额
2. 判断余额是否超过 `MAX_BALANCE`
3. 若未超过，不执行提款
4. 若超过，计算提款金额
5. 执行风控判断
6. 若为 `DRY_RUN`，记录模拟提款
7. 若为 `LIVE`，调用交易所提现接口
8. 记录运行日志与提款历史

## 9. 功能需求

### 9.1 配置管理
系统必须支持在 TUI 内配置并持久化以下内容：

- `exchangeId`
- `asset`
- `network`
- `withdrawAddress`
- `withdrawTag`
- `minBalance`
- `targetBalance`
- `maxBalance`
- `minWithdrawAmount`
- `maxWithdrawAmount`
- `checkIntervalMs`
- `withdrawCooldownMs`
- `mode`
- `enabled`
- API Key
- API Secret

### 9.2 凭证保护
系统必须：
- 使用主密码解锁敏感配置
- 加密保存 API Key / Secret
- 禁止明文展示 API Secret
- 不在日志中输出明文凭证

### 9.3 余额监控
系统必须：
- 定时拉取指定资产余额
- 获取 free balance
- 将拉取结果显示在 Dashboard
- 在运行状态中更新最近检查时间和最近成功检查时间

### 9.4 自动提款
系统必须支持：
- 当余额高于上限时触发提款逻辑
- 默认采用“提到目标余额”的策略
- 即：`withdrawAmount = currentBalance - targetBalance`

### 9.5 运行模式
系统必须支持：
- `dry_run`
- `live`

首版默认：
- `dry_run`

切换到 `live` 时必须二次确认。

### 9.6 风控
系统必须至少支持：
- paused 检查
- enabled 检查
- cooldown 检查
- 最小提款额检查
- 最大提款额检查
- 并发提款保护
- 配置合法性检查
- 凭证已解锁检查

### 9.7 审计
系统必须记录：
- 运行日志
- 提款历史
- 提款失败原因
- 模拟提款记录
- 成功提款记录
- 被拒绝的提款记录

### 9.8 TUI 页面
系统必须具备以下界面：
- Unlock Screen
- Setup Wizard
- Dashboard
- Settings
- History
- Logs

### 9.9 锁屏
系统应支持在运行中锁屏：
- 锁屏后销毁内存中的解密凭证
- 回到 Unlock Screen
- 未重新解锁前不能继续提款

## 10. 提款策略

### 10.1 默认策略
当：
- `balance > maxBalance`

则：
- `withdrawAmount = balance - targetBalance`

### 10.2 设计原因
该策略能够减少提款次数，相比“只提超出上限的部分”更稳定。

### 10.3 当前结论
首版默认采用：
- `excess-to-target`

## 11. 技术需求

### 11.1 语言与依赖
- TypeScript
- ccxt
- blessed
- better-sqlite3
- decimal.js
- zod

### 11.2 数据库
- 使用 SQLite
- 建议数据库文件：`data/app.db`

### 11.3 加密
推荐：
- `scrypt` 用于密钥派生
- `AES-256-GCM` 用于凭证加密

### 11.4 金额处理
- 所有金额使用字符串持久化
- 业务计算使用 `decimal.js`

## 12. 交易所接入需求

### 12.1 首版支持
- `MEXC`

### 12.2 架构要求
必须通过交易所适配器抽象实现，而不是把 MEXC 写死在业务中。

### 12.3 抽象接口
需要存在统一接口，例如：

- `init(credentials)`
- `fetchFreeBalance(asset)`
- `withdraw(input)`
- `supportsWithdraw(asset, network)`
- `validateConfig(...)`
- `healthCheck()`

### 12.4 工厂模式
需要通过工厂按 `exchangeId` 创建 adapter。

### 12.5 当前 UI 约束
虽然架构可扩展，但首版 TUI 中交易所字段可以固定为：
- `mexc`

## 13. 数据模型需求

### 13.1 settings
应包含：
- exchange_id
- asset
- network
- withdraw_address
- withdraw_tag
- min_balance
- target_balance
- max_balance
- min_withdraw_amount
- max_withdraw_amount
- check_interval_ms
- withdraw_cooldown_ms
- mode
- enabled
- encrypted credentials 相关字段
- created_at
- updated_at

### 13.2 runtime_state
应包含：
- paused
- last_balance
- last_check_at
- last_success_check_at
- cooldown_until
- withdraw_in_progress
- api_status
- last_error
- updated_at

### 13.3 withdraw_history
应包含：
- exchange_id
- operation_id
- mode
- asset
- network
- amount
- address_masked
- status
- txid
- reason
- error_message
- raw_response_json
- created_at

### 13.4 event_logs
应包含：
- created_at
- level
- type
- message
- meta_json

## 14. 安全需求

系统必须满足以下安全要求：

1. 不使用 `.env`
2. 不明文存储 API 凭证
3. 启动必须输入主密码
4. 主密码不得记录到日志
5. 解锁失败时不得启动监控
6. API Secret 不可在界面中明文显示
7. 所有敏感信息显示必须脱敏
8. 真实提款模式必须显式确认
9. 日志中不得输出完整地址或密钥
10. 应限制数据库文件访问权限
11. 应在退出或锁屏时清除内存中的解密凭证引用

## 15. UI/UX 需求

### 15.1 Dashboard
应展示：
- 当前交易所
- 当前资产
- 当前余额
- 阈值区间
- 提款地址脱敏值
- 当前模式
- cooldown
- API 状态
- 最近事件
- 最近提款记录

### 15.2 Settings
应支持编辑：
- 非敏感配置
- 敏感配置更新入口
- 模式切换
- 启用/禁用监控

### 15.3 History
应展示提款审计表格。

### 15.4 Logs
应展示运行事件日志。

### 15.5 Unlock
应为应用入口主界面之一。

### 15.6 高风险交互
切换到 LIVE 应要求用户输入：
- `LIVE`

## 16. 运行状态定义

系统至少需要以下状态概念：

- unlocked / locked
- running / paused
- dry_run / live
- healthy / degraded / error
- withdrawing / idle
- cooldown / available

## 17. 关键业务规则

1. 未解锁不得监控。
2. 未解锁不得提款。
3. 配置不合法不得启动。
4. `minBalance <= targetBalance <= maxBalance`
5. `checkIntervalMs` 不能过小
6. 每次只允许一个提款动作进行中
7. cooldown 内不得重复提款
8. 余额未超过上限时不得提款
9. 提款额必须满足最小/最大限制
10. 所有提款尝试都要记录历史或日志
11. DRY_RUN 也必须写入提款历史，状态为 `simulated`

## 18. 架构需求

系统必须分层：

- TUI 层
- Core 业务层
- Exchange Adapter 层
- SQLite Repository 层
- Crypto 层

核心要求：
- UI 不直接调用 SQL
- UI 不直接调用 ccxt
- Core 不依赖具体交易所实现
- Adapter 层屏蔽交易所差异
- Repo 层屏蔽 SQL 细节

## 19. 推荐模块结构

```text
src/
  crypto/
  db/
  exchange/
  core/
  tui/
  services/
  utils/
```

必须存在的关键模块：
- `exchange-factory`
- `mexc-adapter`
- `monitor`
- `withdraw-service`
- `risk-control`
- `state-store`
- `settings-repo`
- `credential-service`

## 20. 成功指标

首版成功定义为：

1. 首次运行可完成初始化配置
2. 后续运行可通过主密码解锁
3. 可在 Dashboard 正常看到余额
4. 超过阈值时可在 `DRY_RUN` 正常生成模拟提款
5. 切换 `LIVE` 后可执行真实提款调用
6. 运行日志与提款历史可持久化
7. 配置修改后可重新加载监控参数
8. 核心架构可扩展到更多 ccxt 交易所

## 21. 风险与约束

### 21.1 交易所差异风险
虽然基于 `ccxt`，但不同交易所的 `withdraw` 参数与能力并不完全统一，因此：
- 不能宣称“天然支持所有交易所”
- 只能宣称“架构支持扩展”
- 每新增一个交易所都要实现 adapter

### 21.2 自动提款风险
自动提款是高风险资金动作，因此：
- 默认必须 `DRY_RUN`
- 必须保留冷却时间
- 必须有操作审计
- 必须有显式 LIVE 确认

### 21.3 本地安全风险
SQLite 文件若泄露，虽然凭证已加密，但仍存在本机安全边界问题，因此：
- 主密码强度应提示用户保证
- 建议限制数据库文件权限
- 不应在系统中明文暴露敏感信息

## 22. 首版范围确认

### 包含
- 单交易所架构
- 首版支持 MEXC
- TUI 配置
- SQLite 存储
- 主密码解锁
- 凭证加密
- 余额监控
- 自动提款
- DRY_RUN / LIVE
- 日志与历史
- 锁屏

### 不包含
- 多交易所 UI 选择器正式开放
- 多币种并行监控
- 云通知
- Web 版控制台

## 23. 后续扩展方向

未来可扩展：
- `binance` adapter
- `okx` adapter
- `bybit` adapter
- 多 profile
- 多币种监控
- webhook 通知
- headless mode
- systemd integration

但这些不属于首版必须交付内容。

## 24. 最终结论

本产品首版是一个基于 TypeScript、ccxt、SQLite 和 TUI 的本地资金监控工具，具备以下确定特性：

- 首版仅支持 MEXC
- 架构支持扩展到任意 ccxt 交易所
- 使用 SQLite 而不是 `.env`
- 使用 TUI 完成配置与监控
- 启动时必须输入主密码
- API 凭证加密后保存在 SQLite 中
- 默认以 `DRY_RUN` 运行
- 超过余额上限时自动提款到目标余额
- 所有资金行为都有日志和审计历史
