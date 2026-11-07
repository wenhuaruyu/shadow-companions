# 后端接口契约 v2（第一阶段评审稿）

本文是待实现的目标契约，不代表当前服务已经支持。当前代码仍使用旧契约：无请求去重、无预期版本检查、准备取反、统一返回 400。v2 必须前后端配套发布；不允许旧客户端无意调用新写接口。

## 约定与权限

- 基路径 `/api`，JSON，时间为 UTC ISO 8601；时长毫秒；chapter 为 0 或 1，座位为 0 或 1。int/str 分别为智力/武力，均为非负整数。
- `Authorization: Bearer <token>` 解析本人及房间权限；客户端不能指定操作者座位。token 不出现在 URL、邀请链接、公共响应或日志中。
- 请求头 `X-Contract-Version: 2`，不匹配返回 CONTRACT_VERSION_MISMATCH。内容和规则版本创建时固定；服务不支持该内容版本时明确报错，不切换旧局题库。
- 成功携带 contractVersion、requestId（写请求）、serverTime。状态响应采用 `snapshot`：公共字段明确列出，本人字段独立白名单序列化，禁止直接展开数据库对象。
- 所有响应禁止缓存。创建及加入返回本人凭证；此后不再返回原始凭证。

## 接口

| 方法与路径 | 输入 | 成功返回 |
| --- | --- | --- |
| POST /create | requestId、recoverySecret、contentVersion | 201；id、seat、token、inviteUrl、snapshot；重试返回原结果 |
| POST /join | room、requestId、recoverySecret | 201；id、seat、token、snapshot；重试返回原座位 |
| GET /state?room=…&knownVersion=… | 本人鉴权；knownVersion 可省略 | 200；changed、version、serverTime；变化或首次请求附 snapshot |
| GET /instruction?room=… | 本人鉴权，仅身份分配后 | 200；仅本人 title/text，不含对方身份 |
| POST /action | 统一动作信封，见下 | 200；requestId、replayed、appliedVersion、当前 snapshot |
| GET /health | 无 | 存活检查；不暴露配置、凭证或数据库地址 |

邀请链接只含 room，不含恢复秘密。创建和加入的 recoverySecret 是浏览器生成并先持久保存的至少 32 字节密码学随机秘密；服务端存摘要，用作本人 token 验证。响应丢失时以同一秘密和编号重试。不同浏览器无原秘密不能接管座位。准备前15分钟未满员的邀请到期。创建 requestId 以 recoverySecret 摘要为作用域，加入以 room 和该摘要为作用域。重放须重新验证秘密。

GET state 的 version 是同步版本，覆盖加入、公开确认、本人草稿、计时结算、暂停/恢复等可见变更。普通心跳刷新 lastSeen 不递增；在线状态实际变化递增。有效时间连续流逝不逐毫秒递增：快照提供计时锚点，客户端结合 serverTime 插值，服务端始终裁决。changed=false 仍返回 serverTime。私密指令不混入公共 snapshot。

## 写动作信封

```json
{
  "room": "room-id",
  "requestId": "uuid",
  "kind": "invest",
  "expectedVersion": 12,
  "expectedPhase": "invest",
  "chapter": 0,
  "data": { "int": 2, "str": 2 }
}
```

| kind | data 与额外字段 | 前置条件及效果 |
| --- | --- | --- |
| ready | ready:boolean | lobby；明确设置，不取反；两人准备则只分配一次身份并进入 brief |
| instruction | 空 | brief；本人确认个人指令 |
| tutorial | 空 | brief 且本人已确认指令；双方教学完成则 map |
| enter | 空；chapter | map；两人确认当前地点则 story |
| read | 空；chapter | story；两人已读则 event |
| start | type:int或str；chapter | event；原子建立唯一尝试并消耗一次行动机会 |
| answers | answers:三个0/1/2/null；attemptId、inputSeq | 本人进行中智力尝试；整份草稿替换，较旧序号拒绝 |
| hit | opportunity:0至9、zone:0至2；attemptId、inputSeq | 本人进行中武力尝试；服务端核对机会、有效窗口及首次有效触控 |
| finish | 空；chapter、attemptId | 提交智力或已到期武力尝试；计分和奖励一次完成 |
| abandon | 空；chapter、attemptId | 放弃本人进行中尝试，按截至放弃时已确认的有效输入计分，不退行动机会 |
| draft | int/str；chapter、inputSeq | invest；保存本人合法投入草稿，不公开、不扣除；不能超过余额 |
| invest | int/str；chapter | invest；扣除和确认一次；两人确认后共同结算 |
| continue | 空；chapter | result；双方确认后下一地点或终点，失败结果不可修改 |
| presence | visible:boolean、presenceSeq、sessionId | 报告页面可见性及心跳，不自动恢复；独立单调序号拒绝乱序 |
| resume | 空；pauseId | paused；双方在线可见并确认当前暂停批次后恢复 |
| exit | confirmed:true | 非终态；结束双方对局，不是剧情失败 |

除 presence、answers、hit、draft 外，业务动作必填 expectedVersion/expectedPhase。尝试输入和草稿使用各自单调 inputSeq，不争用房间版本；但仍校验本人、chapter、阶段、attemptId 和暂停状态。presence 每个浏览器会话有 sessionId，刷新后先读取状态并建立新会话，旧会话输入不得覆盖新会话；一个座位同一时间仅一个有效会话。恢复确认绑定 pauseId，新一次暂停清除旧确认。

所有写请求都有 requestId。相同作用域同编号同参数返回已处理事实，不再次执行；相同编号不同参数返回 REQUEST_ID_CONFLICT。去重记录与业务事务一起提交。响应中的 appliedVersion 为原执行版本，snapshot 为当前状态，客户端不能用旧响应倒退本地版本。

处理顺序：鉴权 → 查询去重结果 → 校验请求参数一致 → 校验版本/阶段/权限 → 事务写入业务与去重结果 → 提交后响应。失败校验不消耗请求编号，客户端也不得修改同编号参数后重试。并发更新通过数据库锁/条件更新串行裁决，不能仅靠进程内 Map。

## 错误与重试

格式：`{ "code":"VERSION_CONFLICT", "message":"状态已变化，请刷新", "error":"状态已变化，请刷新", "requestId":"uuid", "currentVersion":13, "retryable":false }`。error 是兼容显示字段，不意味着兼容旧请求协议。

| HTTP | code |
| --- | --- |
| 400 | INVALID_INPUT、CONTRACT_VERSION_MISMATCH、CONTENT_VERSION_UNSUPPORTED |
| 401 | INVALID_CREDENTIAL |
| 404 | ROOM_NOT_FOUND |
| 409 | ROOM_FULL、PHASE_MISMATCH、VERSION_CONFLICT、REQUEST_ID_CONFLICT、ACTION_ALREADY_DONE、ACTION_POINT_USED、ATTEMPT_ENDED、INSUFFICIENT_BALANCE、ROOM_PAUSED、STALE_INPUT、SESSION_REPLACED |
| 410 | INVITE_EXPIRED、ROOM_ENDED |
| 429 | RATE_LIMITED |
| 503 | TEMPORARILY_UNAVAILABLE |

- 超时或响应丢失：沿用原编号及参数重发；服务端先去重，即使当前阶段已变化也返回原执行事实。必要时先读取最新状态。
- 409 版本冲突：刷新后检查动作是否已完成；未完成且仍适用，基于新状态以新编号提交。投入金额变化必须重新展示确认，不能偷偷替用户改金额。
- 429/503 按 Retry-After 或退避重试，仍沿用原编号。retryable 仅表示原请求适合稍后重试，不表示会自动成功。
- 凭证无效停止自动重试；不披露其他玩家是否拥有某身份。

## 迁移与联调

现有前端需新增契约请求头、请求编号持久队列、明确 ready 值、状态版本处理、resume UI、本人草稿恢复和本地计时插值。现有 `id/phase/chapter/players/me/attempt/questions/records` 在 snapshot 中保留；ready 等公开字段保留。新增 ended、outcome、pause、requirements、contentVersion/rulesVersion、investmentDraft。

旧代码尚不支持上述协议；第一阶段只交付文档及样例。后续前后端同批切换 v2；若独立部署需协调版本窗口，不能依靠返回 error 字段解决协议差异。

开发可以分离，正式入口建议同域 `/` 与 `/api`。若开发服务器跨域，只允许指定开发来源，显式支持 Authorization/X-Contract-Version 预检，不使用任意来源放行私密接口。

详见 [状态规则](./state-machine.md) 与 [响应样例](./examples/snapshots.json)。
