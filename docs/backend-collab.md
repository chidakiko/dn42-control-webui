# 后端配合清单(交互改造收尾)

> `ui-api-proposal.md` 里的专用接口后端已全部落地,前端已完成适配。
> 本文是交互改造(`ui-interaction-proposal.md`)做完后**剩余**需要后端配合的事项,
> 按优先级排列。除第 1 条是"约定"外,工作量都很小。

---

## 1. 错误 detail 从此是稳定 API(P0,约定而非开发)

前端现在维护一张 **detail 模式翻译表**(`src/lib/api.ts` 的 `DETAIL_PATTERNS`,17 条正则),
把后端的错误串翻译成 4 种语言,例如:

| 后端 detail(原样) | 前端呈现(zh) |
|---|---|
| `unknown node de-fra1` | 节点 de-fra1 不存在 |
| `bgp session 'peer_mp' already exists on node X` | 已存在:bgp session 'peer_mp' |
| `node X is live; POST …/decommission first …` | 节点 X 仍在运行——请先退役(拆除隧道/BGP)再删除 |
| `node X has no live agent connection; …` | 节点 X 没有实时 agent 连接——变更已保存,将在下次对账时生效 |
| `{"message": "invalid BgpSessionSpec", "errors": [...]}` | 校验失败:BgpSessionSpec — spec.neighbor: <首条字段错误> (+N) |

因此需要约定:

- **现有 detail 字符串的措辞视为稳定接口**:改动措辞不会报错,但翻译会静默失效、回退英文原文。改前打个招呼即可。
- **新增错误尽量复用现有句式**(`unknown <kind> <id>` / `<what> already exists …` / `node <id> has no …`),前端零成本自动覆盖。
- `agent_releases.py` 里有两条中文 detail(`非法版本号` / `非法 wheel 文件名`)——与其余英文模式不一致,建议统一成英文模式串,翻译交给前端。

**长期建议(可选)**:detail 里加机器可读 code,如
`{"code": "node_not_found", "params": {"node_id": "de-fra1"}, "message": "unknown node de-fra1"}`。
前端改为按 code 查表,正则表可整张退役,措辞从此随意改。前端已有承接结构,后端加字段即可,不破坏兼容。

## 2. audit log 游标分页 + 服务端搜索(P1)

唯一没做完的交互项。现状:`GET /admin/audit?limit=N`(最近 N 条,上限 1000),
前端在这 N 条里做客户端搜索。审计日志只增不减,规模上去后需要:

```
GET /api/v1/ui/audit?limit=100&before_id=<id>&q=<substr>
→ { "entries": [...], }   // 行结构不变;q 匹配 actor/method/path 即可
```

与 status-events 的 P1-5 同款 `before_id` 游标。接口好了前端半小时接上
(列表已按"加载更早"模式写好,见 StatusEventsTab)。

## 3. probe 流保证结尾帧(P1,小)

前端现在把"流关闭但没收到 `done` 帧"显示为**连接已断开**(红色提示)。
请确认服务端在所有**正常**结束路径(工具退出、agent 正常回报)都发 `done` 帧后再关流,
否则正常结束会被误标为断连。异常路径(agent 掉线、超时)不发 done 是正确的——那正是
这个提示要捕捉的场景。

## 4. 响应时间预算(P1,确认即可)

前端所有请求现在带 **15 秒超时**(上传 120 秒)。需要确认最重的两个端点在冷缓存下
也能稳定 <15s:`GET /ui/dashboard`(已有 ~3s 缓存,应该没问题)和
`GET /ui/nodes/{id}/routing/dashboard`。超了会在前端显示为"请求超时"。

## 5. 写操作乐观并发(P2,可暂缓)

route-tuning / link-latency 改为字段级合并后,主要的丢更新风险已消除。剩余场景是
**节点编辑弹窗整体 PUT base_template**:两个管理端同时编辑同一节点仍是 last-write-wins。
单管理员日常影响很小。如要根治:`NodeOut` 带 `updated_at` 已有,PUT 支持
`If-Unmodified-Since`(或 body 带 `expected_updated_at`),冲突返回 409 即可,
前端会把 409 呈现为"该节点已被其他会话修改,请刷新后重试"。

## 6. `/ui/session.features` 使用约定(P2,备忘)

前端已读取该字段但目前不消费任何 flag。以后后端上新能力想灰度时,往 `features`
数组里放一个字符串(如 `"audit-cursor"`),前端按 flag 显示对应 UI,新旧后端平滑共存。
第 2 条的 audit 新接口就适合作为第一个使用者。

---

## 不需要动的

- `ui-api-proposal.md` 的全部接口(P0-1 ~ P2-1)——已落地、已接入、工作正常。
- 确认框 / 输入名称确认 / 脏数据守卫 / URL 状态 / 表格搜索排序——纯前端,无后端依赖。
