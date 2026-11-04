# API 契约 v1

所有 API 返回 JSON，失败为 HTTP 400 `{ "error": "中文原因" }`。私有接口使用 `Authorization: Bearer <token>`，凭证不得写入邀请链接。

| 接口 | 输入 | 返回 |
|---|---|---|
| POST /api/create | 空对象 | id、本人 token |
| POST /api/join | room | id、加入者 token |
| GET /api/state?room=… | 本人鉴权 | 公共双人状态、本人尝试、无答案题面 |
| GET /api/instruction?room=… | 本人鉴权 | 仅本人的个人指令 |
| POST /api/action | room、kind、data | 更新后的本人视图 |

kind：presence（visible）、ready、instruction、tutorial、enter、read、start（type=int/str）、answers（answers 数组）、hit（zone=0/1/2）、finish、invest（int/str 非负整数）、continue、exit。

公共玩家字段：name/int/str/ready/instruction/tutorial/entered/read/continued/online/event/investment。状态：lobby、brief、map、story、event、invest、result、complete、failed、ended。paused 独立于当前阶段，暂停期间除 presence/exit 外拒绝操作。

服务端保存身份、计时、正确答案和账本；不接受客户端奖励或最终属性。事件和投资通过每人每地点唯一记录保证一次结算。凭证仅恢复本人座位，邀请不能接管座位。
