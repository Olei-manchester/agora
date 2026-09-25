# CITY 自动值守说明（人不在时的运行机制）

## 一句话

真正“自动检测、应对突发、做出处理”的是一个**独立常驻的守护进程** `city daemon`，它跑在 Codex 沙箱之外，联网不需要人工逐条批准。Codex 这边只负责定时醒来读它的本地日志做体检。

## 三层机制

1. 守护进程 `city daemon`：常驻长轮询房间，收到新消息就分类、按策略回复、写日志、断线自动重连、重启后从上次序号继续。这是 Arena 无人值守的核心。
2. 本地日志 `city.log`：每件事（收到消息/回复/错误/余额）都落一行 JSON。人回来后可以直接审。
3. Codex 定时体检（可选）：每隔一段时间醒来读 `city.log`、`.citystate.json`、`.city-pause`，只在发现异常时打扰你；读本地文件不需要联网授权。

## 它能自动处理什么

- 新消息进来 → 判断是否点名 `@city` / `@codex`，点名才回，不点名只记录（不刷屏）。
- 点名后按意图回复：`scan` 市场全景、`price` 价目、`help` 用法、`leads`/`rebuttal`/`live` 占位。
- 网络错误 → 5 秒后重试，不退出。
- 致命错误（邀请被撤销/过期、房间关闭、凭证失效）→ 记日志并**停下**，等人来处理，不瞎试。
- 重启恢复 → 从 `.citystate.json` 里记录的最后序号继续，不漏消息。
- 余额快照 → 每 12 轮记一次，供对账。

## 它不会自动做（安全边界）

- 不回应没点名它的消息，避免在几十个 Agent 的房间里刷屏或被诱导。
- 不泄露任何 token、邀请码、`--claim` 认领码。
- 不擅自转账、不“先付款”做高风险承诺（收付款闭环在 leads/rebuttal 上线时再加严格确认）。
- 看到 `.city-pause` 文件就暂停——这是人工紧急停止开关。

## 怎么跑 / 停

```powershell
cd F:\hackerthon\city
$env:SHAREDNET_ROOM='rom_9T8NiTnRK0'   # 或 Arena 房间
$env:SHAREDNET_TOKEN='rit_…'           # 仅首次 join 需要，之后用 .citystate.json
node bin/city.mjs account --name city  # 用账号席位注册+加入（Arena 必用，收款/积分归账号）
node bin/city.mjs daemon --market --launch --engage  # Arena：报价→收款→自动交付→收据
node bin/city.mjs daemon               # 常驻（开发/免费模式）
node bin/city.mjs daemon --launch      # 入场即白送全场扫描，然后进入值守
node bin/city.mjs daemon --launch --engage  # 再加“高意图关键词”主动触发（带冷却与上限）
node bin/city.mjs daemon --once        # 只做一次非阻塞检查，用于自测
```

暂停：在 `F:\hackerthon\city` 下新建 `.city-pause` 文件；删除该文件即恢复。

注意：`city join` 是匿名席位，`city account` 才是账号席位。Arena 一定要用 `account`，否则赚到的积分会落进一个匿名 principal，和提交的收款地址对不上。

## 收款闭环（Arena 2）

1. 有人点名要付费服务（leads/rebuttal/live）→ 守护进程建一张订单（`--market` 模式），回一条报价：服务、价格、收款地址 `p_XK4HrJNXw5`、唯一备注 `city-ord_…`。
2. 对方转积分并带备注 → 守护进程轮询 `ledger`，按备注精确匹配订单、校验金额。
3. 到账 → 用模型生成交付内容，回一条带收据的交付消息，订单置为 `delivered`。
4. 订单状态存在 `.city-orders.json`（已 gitignore），`city orders` 可查；欠付/备注不符不交付。

## 冷启动（没人知道 CITY 时怎么被看见）

- `--launch`：开场一次性把“市场扫描”白送全场，用真实价值证明自己，而不是喊口号。
- `--engage`：除了 `@city`/`@codex` 点名，再响应“谁在卖/有没有人做/求/找/who can/need to/排名/买家”等高意图关键词，但**冷却 10 分钟、全场最多 20 次**，防止刷屏。
- 回复我消息也算点名（用消息 id 判断），别人接着我话说时能正常接住。
- 开发期用多个角色席位先在房间里演一遍“怎么 @city”，给赛场打个可复制的样。

## 人回来之后怎么审

```powershell
Get-Content F:\hackerthon\city\city.log -Tail 50
```
