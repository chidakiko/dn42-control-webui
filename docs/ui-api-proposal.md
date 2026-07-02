# WebUI 专用接口迁移提案(/api/v1/ui)

> 由 webui 前端整理,供 control-server 后端实施参考。
> 背景:webui 已拆分为独立项目,后端计划为其提供专用接口(BFF),不再依赖通用 admin 接口。
> 本文列出前端当前"多接口拼数据 / 客户端做服务端活"的全部痛点及对应的接口设计。

> **状态:P0~P2 全部 12 项后端已实现,前端已完成对接。** 实施相对本提案的偏差
>(前端已按此对接):
> - `agent_summary` 是 FleetOverview 的**顶层字段**,未并入 `summary`(health 的
>   stale 与 liveness 的 stale 会撞键);形状仍为 `{online, stale, offline, agents_behind}`。
> - `/ui/nodes/{id}/overview` 仅节点不存在才 404;存在但从未上报返回
>   `health:"unknown"` 骨架 + 完整 `node`。
> - dashboard 的 `peering_issues` 是裸数组,其余四块与细粒度端点逐字段一致。
> - status-events 瘦列表保持**新→旧**(配合 `before_id` 游标);trends 三组 series 升序。
> - provision 响应保留旧 `bgp_session`(首条)兼容,新增 `sessions[]`;
>   `bgp_spec` 与 `bgp_specs` 二选一,同给 422。
> - DNS zone/record 的 DELETE 从 204 改 **200 带 body**(对旧前端 breaking,
>   前端与控制面需同步部署)。
> - route-tuning PUT 响应带 `updated_at`,未做 If-Unmodified-Since(可选项)。
> - `/ui/session` 的 `heartbeat_interval_seconds` 为 fleet 统一默认值(30s 常量)。

---

## 0. 通用约定

沿用现有 `/api/v1/ui/*` 的约定,新接口保持一致:

- 鉴权:`Authorization: Bearer <admin token>`,401 语义不变。
- 错误:FastAPI 风格 `{"detail": ...}`。
- 时间戳:ISO 8601(UTC)。
- **所有时序 series 一律按时间升序返回**(旧→新)。目前 status-events 按新→旧返回,前端每处都要 `reverse()`,新接口统一掉这个坑。
- 字段命名 snake_case,尽量复用现有 DTO(文中引用的类型名对应 webui `src/lib/types.ts`,即后端现有 schema 的镜像)。

优先级说明:**P0** = 消除明显的过度取数或数据一致性风险;**P1** = 请求数合并、策略归位;**P2** = 顺手改进。

---

## P0-1. `GET /ui/nodes/{id}/trends` — 节点趋势(取代 status-events 当时序库用)

### 现状(最严重的过度取数)

节点详情页 overview 为了画几条 sparkline,要发 4 个请求、下载 ~150 份完整事件 payload:

| 组件 | 现有调用 | 实际只用到 |
|---|---|---|
| NodeSelfMetrics | `GET /admin/nodes/{id}/status-events?kind=snapshot&limit=50` | 每条 payload 里的 `self_metrics`(几个数字) |
| NodeSelfMetrics(standalone) | `GET /admin/nodes/{id}/health` | `last_snapshot.self_metrics` |
| NodeTrends | `GET .../status-events?kind=report&limit=50` | 每条 `payload.drift` 的 **length** |
| NodeTrends | `GET .../status-events?kind=apply&limit=50` | 每条的 `status` 字段 |

snapshot payload 含全量链路/BGP 状态,单条可能几十 KB,而且该页面挂在自动刷新 tick 上反复拉。

### 设计

```
GET /api/v1/ui/nodes/{id}/trends?limit=50
```

```jsonc
{
  "node_id": "de-fra1",
  "limit": 50,

  // agent 自观测:当前值 + 历史序列(仅抽取画图所需字段,升序)
  "self_metrics": {
    "current": { /* AgentSelfMetrics,同现有 schema;从未上报为 null */ },
    "series": [
      {
        "at": "2026-07-02T10:00:00Z",
        "cpu_percent": 1.2,
        "rss_mb": 48.5,
        "last_routing_collect_seconds": 0.31,
        "last_reresolve_seconds": 0.02
      }
    ]
  },

  // 每次 report 的 drift 数(前端画趋势 + 算 delta)
  "drift": {
    "current": 0,
    "series": [ { "at": "2026-07-02T10:00:00Z", "count": 0 } ]
  },

  // apply 结果序列 + 服务端算好的成功率
  "apply": {
    "total": 50,
    "succeeded": 48,
    "last_status": "succeeded",
    "last_at": "2026-07-02T09:58:00Z",
    "series": [ { "at": "...", "status": "succeeded" } ]
  }
}
```

- 节点从未上报 → 200,三段均为 `current: null` / 空 series(不要 404,前端用它区分"未上报"和"出错")。
- 取代上表 4 个请求;`/ui/nodes/{id}/overview` 里已有的 `self_metrics`/`drift` 当前值保持不变。

---

## P0-2. 路由调优专用读写 — 消除 base_template 读-改-写竞态

### 现状

RouteTuningTab(调 `cold_potato_med` / `route_local_pref` / 会话 `link_latency` 三个旋钮):

- 读 = `GET /admin/nodes/{id}` + `GET /admin/nodes/{id}/bgp-sessions` 两个请求,前端自己从 `base_template.bird` 里挖字段;
- 写节点级 = 前端把整棵 `base_template` merge 后 `PATCH /admin/nodes/{id}` **整体回写** —— 与他人并发编辑 base_template 的其他部分会互相覆盖;
- 写会话级 = 保存前**重新拉全量 sessions** 找到当前 spec,只改 `link_latency` 一个字段后把整个 spec 回写。

前端被迫理解 base_template / session spec 的内部结构,这本应是后端的私有知识。

### 设计

```
GET /api/v1/ui/nodes/{id}/route-tuning
```

```jsonc
{
  "node_id": "de-fra1",
  "cold_potato_med": 50,              // base_template.bird.cold_potato_med,缺省 50
  "route_local_pref": [
    { "prefix": "172.20.62.160/27", "local_pref": 200 }
  ],
  "sessions": [
    { "id": 12, "name": "peer_mp", "remote_asn": 4242420000, "link_latency": 3 }  // null = 未设
  ]
}
```

```
PUT /api/v1/ui/nodes/{id}/route-tuning
Body: { "cold_potato_med": 50, "route_local_pref": [ ... ] }   // 两字段均可选,缺省不动
→ 200,返回 GET 同款完整视图
```

- 后端做**字段级合并**:只写 `base_template.bird.cold_potato_med` / `.route_local_pref` 两个 key,base_template 其余部分原样保留。
- 可选加固:响应带 `updated_at`,PUT 支持 `If-Unmodified-Since` / body 带版本号,冲突返回 409。非必须,字段级合并已消除主要风险。

```
PUT /api/v1/ui/bgp-sessions/{sid}/link-latency
Body: { "link_latency": 3 }    // null = 清除
→ 200 { "id": 12, "link_latency": 3 }
```

- 后端在 session spec 上做单字段合并,前端不再拉全量 sessions、不再回写整个 spec。

---

## P0-3. Peer 向导:`GET /ui/nodes/{id}/peer-defaults` + provision 原子化

### 现状

1. **默认值推导在前端猜**:向导打开时拉全量 `GET /admin/nodes/{id}/interfaces`,前端用启发式推:
   - 节点 WG 私钥 = 第一个非 `secret://` 前缀的 `spec.private_key_ref`;
   - 本机惯用 link-local = 外部口(名字不匹配 `wg-*`/`dn42-*`)地址里出现次数最多的 `fe80::`。

   这些是后端知识,约定一变前端就猜错。

2. **提交是 N+1 写入、无原子性**:`POST /admin/nodes/{id}/peerings/provision`(peering + interface + 第一条 session)成功后,**逐条循环** `POST /admin/nodes/{id}/bgp-sessions` 建剩余 session;中途失败前端自己拼"部分成功"提示,系统留下半配置状态。

### 设计

```
GET /api/v1/ui/nodes/{id}/peer-defaults
```

```jsonc
{
  "node_id": "de-fra1",
  "wireguard": {
    "private_key_ref": "abc...",     // 复用现有节点级 key 的 ref;推不出为 null
    "link_local": "fe80::ade0",     // 本机外部 peering 惯用 LL;推不出为 null
    "used_listen_ports": [51820, 51821]   // 便于前端提示端口冲突(可选)
  }
}
```

- 推导逻辑(现前端启发式)整体搬到后端,后端可随内部约定演进。
- 备注:`private_key_ref` 目前经 interfaces 接口本就以明文下发,此接口不新增暴露面;长期建议后端引入 secret 引用(如 `secret://node-wg-key`),届时此字段直接返回引用,前端零改动。

**provision 扩展**(在现有 endpoint 上加字段即可):

```
POST /api/v1/admin/nodes/{id}/peerings/provision
Body: {
  "peering": { ... },
  "interface_spec": { ... },
  "interface_enabled": true,
  "bgp_specs": [ { ... }, { ... } ]     // 新:数组,0..N 条;与旧 bgp_spec 二选一,旧字段保留兼容
}
→ 200 {
  "peering": PeeringOut,
  "interface": InterfaceOut,
  "sessions": [ SessionOut, ... ]
}
```

- **全部对象在一个事务里创建**,任一失败整体回滚返回 4xx/5xx,不再有部分成功。

---

## P0-4. 节点列表/详情去 join:`GET /ui/nodes` + `/ui/nodes/{id}/overview` 扩展

### 现状

- 节点列表页:`NodeOut` 上没有心跳/agent 版本,前端额外拉全舰队 `GET /ui/fleet/overview`,按 `node_id` 建 map 客户端 join。
- 节点详情页首屏 3 连:`GET /admin/nodes/{id}`(基本信息)+ `GET /ui/nodes/{id}/overview`(健康/状态)+ `GET /admin/nodes/{id}/peerings`,且前两个挂在自动刷新上每 tick 双发。

### 设计

**列表**:

```
GET /api/v1/ui/nodes
```

```jsonc
{
  "nodes": [
    {
      // NodeOut 的标量字段(node_id/asn/router_id/site/lifecycle/current_generation/
      // dns_group_id/created_at/updated_at 等),但【不含】base_template 和 inventory
      // 这两坨大 JSON —— 列表页用不到,还很重
      "node_id": "de-fra1",
      "asn": 4242420000,
      "...": "...",
      // liveness join(现由前端拿 fleet/overview 拼)
      "health": "ok",                       // NodeHealthValue
      "agent_version": "0.9.3",
      "last_heartbeat_at": "2026-07-02T10:00:12Z",
      "agent_up_to_date": true,
      "liveness": "online"                  // 见 P1-3,服务端算好
    }
  ]
}
```

**详情**:扩展现有 `GET /ui/nodes/{id}/overview`,内嵌节点记录,免掉并行的 `GET /admin/nodes/{id}`:

```jsonc
{
  // ...现有 NodeOverview 全部字段不变...
  "node": { /* 完整 NodeOut,含 base_template(编辑弹窗要用) */ },
  "dns_group": { "id": 3, "name": "anycast-dns" },   // null = 未分配;免掉 NodeDnsTab 拉全量组列表解析名字
  "liveness": "online",                                // 见 P1-3
  "geo": { /* 见 P1-4 */ }
}
```

- `peerings` 不并入(Peerings tab 自取,避免 overview 轮询变重)。

---

## P1-1. `GET /ui/dashboard` — 仪表盘一次取全

### 现状

仪表盘首屏 5 个请求:`/ui/fleet/overview` → `/ui/fleet/traffic` → `/ui/fleet/traffic-breakdown` → `/ui/fleet/peering-issues` → `/ui/routing/fleet-overview`,并且挂自动刷新,每 tick 5 连发。

### 设计

```
GET /api/v1/ui/dashboard?traffic_limit=120
```

```jsonc
{
  "overview": { /* FleetOverview,每行加 liveness + geo(见 P1-3/P1-4),
                   summary 加 { "online": n, "stale": n, "offline": n, "agents_behind": n } */ },
  "traffic": { "points": [ /* TrafficPoint */ ] },
  "traffic_breakdown": { /* FleetTrafficBreakdown */ },
  "peering_issues": [ /* PeeringIssue */ ],
  "routing": { /* FleetRoutingOverview */ }
}
```

- 各分块内部结构与现有 5 个接口的响应**逐字段一致**,前端只改取数处。
- 此接口会被高频轮询,建议服务端做短 TTL 缓存(1~5s)。
- 现有 5 个细粒度接口保留(节点详情页的 traffic 等仍单独用 `/ui/nodes/{id}/traffic`)。

---

## P1-2. `GET /ui/session` — 鉴权探测 / 服务端元信息

### 现状

登录页没有验 token 的正经接口,拿 `GET /admin/health` 当探针,401/403 语义靠前端猜;前端也没有地方获知服务端版本、能力开关。

### 设计

```
GET /api/v1/ui/session
```

```jsonc
// 200(token 有效)
{
  "authenticated": true,
  "scope": "admin",
  "server_version": "1.4.0",
  "agent_target_version": "0.9.3",
  "heartbeat_interval_seconds": 30,
  "liveness_thresholds": { "online_seconds": 75, "stale_seconds": 300 },
  "features": []          // 预留:能力开关,前端按需灰度 UI
}
// 401 = token 无效;403 = 锁定(语义与现有一致)
```

- 极轻量、不查库(或只读内存配置)。
- `liveness_thresholds` 让前端在需要本地补算时(如倒计时 UI)与服务端策略对齐,而非硬编码。

---

## P1-3. liveness 判定归服务端

### 现状

"心跳 ≤75s = online / ≤300s = stale / 否则 offline" 这套阈值硬编码在前端 `format.ts`,与后端 `heartbeat_interval_seconds` 强耦合;仪表盘的 online 数、版本落后数也是前端 filter 出来的。后端一改心跳间隔,前端全部判错。

### 设计

- 所有携带 `AgentLivenessFields` 的响应(fleet overview 行、node overview、`/ui/nodes` 行、releases status 的 nodes)统一加:

  ```jsonc
  "liveness": "online" | "stale" | "offline"
  ```

- 聚合处(dashboard summary)由服务端给计数:`{ "online": n, "stale": n, "offline": n, "agents_behind": n }`。
- 阈值经 `/ui/session` 下发(见 P1-2),前端不再自带策略。

---

## P1-4. 地理解析归服务端

### 现状

site code → 坐标/城市/国家/DN42 region 的注册表(约 300 行)维护在**前端** `geo.ts`,舰队地图和节点详情页头部都靠它。**新增一个机房要发一版前端**。

### 设计

所有带节点行的 UI 接口(dashboard overview 行、`/ui/nodes` 行、node overview)加:

```jsonc
"geo": {
  "lat": 50.11,
  "lon": 8.68,
  "city": "Frankfurt",     // 英文名,前端负责 i18n 显示
  "country": "DE",         // ISO 3166-1 alpha-2
  "region": 41             // DN42 origin-region community;未知为 null
}
// 整体可为 null(site 无法解析且无 region 兜底)
```

- 注册表(site → geo 数据文件)移交后端维护;后端可先原样收编前端 `src/lib/geo.ts` 的数据。
- 解析优先级维持现状:节点自带 `region` 字段覆盖注册表推导值。

---

## P1-5. status-events 列表瘦身

### 现状

StatusEventsTab 拉 `GET /admin/nodes/{id}/status-events?limit=300`,**每条都带完整 payload**(snapshot 单条可达几十 KB),而列表只展示 kind/status/时间,payload 仅在用户点开单条时才需要。

### 设计

```
GET /api/v1/ui/nodes/{id}/status-events?kind=&limit=100&before_id=<id>
```

```jsonc
{
  "node_id": "de-fra1",
  "events": [
    {
      "id": 991,
      "kind": "report",
      "generation": 42,
      "status": "ok",
      "created_at": "2026-07-02T10:00:00Z",
      "drift_count": 2          // 仅 report 事件;列表行直接显示,免下载 payload
    }
  ]
}
```

```
GET /api/v1/ui/status-events/{event_id}
→ 200 完整 StatusEvent(含 payload),用户展开详情时按需取
```

- `before_id` 游标分页,取代一次 300 条。
- 现有 admin status-events 接口保留(P0-1 的 trends 上线前,NodeSelfMetrics 等仍在用)。

---

## P2-1. DNS 写操作响应携带父级最新摘要

### 现状

zone 增删改后,前端要 `Promise.all([loadZones(), loadGroups()])` 双重刷新——只为拿到组上的 `zone_count`;record 增删改同理影响 `record_count`。

### 设计

zone 的 POST/PATCH/DELETE 响应(DELETE 从 204 改为 200 带 body):

```jsonc
{ "zone": DnsGroupZoneOut | null,   // DELETE 时为 null
  "group": DnsGroupOut }            // 副作用后的最新组(zone_count 已更新)
```

record 的 POST/PATCH/DELETE 响应:

```jsonc
{ "record": DnsRecordOut | null,
  "zone": DnsGroupZoneOut }         // record_count 已更新
```

---

## 迁移对照表

| 前端现状(请求组合) | 新接口 | 优先级 |
|---|---|---|
| status-events(snapshot×50) + nodeHealth + status-events(report×50) + status-events(apply×50) | `GET /ui/nodes/{id}/trends` | P0 |
| getNode + listSessions + 整体回写 base_template / session spec | `GET/PUT /ui/nodes/{id}/route-tuning` + `PUT /ui/bgp-sessions/{sid}/link-latency` | P0 |
| listInterfaces(前端启发式推默认值) | `GET /ui/nodes/{id}/peer-defaults` | P0 |
| provisionPeering + 循环 createSession(非原子) | provision 收 `bgp_specs[]`,事务化 | P0 |
| listNodes + fleetOverview 客户端 join | `GET /ui/nodes` | P0 |
| getNode + nodeOverview 双发 + NodeDnsTab 拉全量组 | `/ui/nodes/{id}/overview` 内嵌 `node`/`dns_group` | P0 |
| 仪表盘 5 连发 | `GET /ui/dashboard` | P1 |
| 登录页拿 fleetHealth 验 token | `GET /ui/session` | P1 |
| 前端硬编码 liveness 阈值/聚合计数 | 各响应加 `liveness`,summary 加计数 | P1 |
| 前端维护 geo 注册表 | 各节点行加 `geo` | P1 |
| status-events 300 条全 payload | 瘦列表 + 单条详情 | P1 |
| DNS 写后双重刷新 | 写响应带父级摘要 | P2 |

## 不需要动的

- Generations 的 list → detail → diff 三段式:自然的按需 drill-down。
- dns-groups 页三级瀑布(groups → zones → records):交互本身合理,P2-1 解决它唯一的别扭点。
- 探测(probe)、enrollment/registration/audit、agent-releases:现状即可。
