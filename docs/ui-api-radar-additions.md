# Radar 化 UI 的后端增量需求

> 2026-07-02(第 3 版)。**R1–R5 后端已全部交付,前端已全部接线,mock 已清零。**
> 本文档保留作为接口契约记录;新增需求请开新章节。

## 交付与接线状态

| 需求 | 后端 | 前端接线 |
|---|---|---|
| R5 分家族趋势 + AS/RPKI 拆分 | ✅ `size_v4/v6`、`as_count(_v4/_v6)`、`rpki_v4/v6`、`origins[].count_v4/v6` | ✅ 阶梯图真序列;统计格全部真数据 + IPv4/IPv6 拆分行;起源表"排序依据"分段控件 |
| R2 as-of 时间戳 | ✅ `generated_at` | ✅ Widget 底部「更新于」用服务器聚合时间 |
| R1 上期对比 | ✅ `?compare=1` → `points_previous` | ✅ 仪表盘流量 + 节点 LinkTraffic 虚线叠加 |
| R3 时间范围 | ✅ `?range=6h\|24h\|7d\|30d` 固定网格(空桶 null) | ✅ 流量卡分段控件 → 请求参数 + URL querystring(契约 1) |
| R4 榜单深度/排序 | ✅ `origins_top`/`origins_sort`/`breakdown_top` | ✅ `origins_top=100`,表格 20/页 ×5;排序客户端切换 |

## R5 — 路由趋势分家族序列 + AS 总数 ⭐ 当前最高优先

「路由表规模」已完全复刻 Radar「已公布的 IP 地址空间」模块
(IPv4/IPv6 双阶梯图 + 两者/IPv4/IPv6 切换 + 最小/最大比例开关),
「路由统计信息」已复刻五格统计(AS / 总路由 / RPKI 有效 / 无效 / 未覆盖)——
两处的关键数据都是假的,这条落地后仪表盘路由区即全真。

**改动**(均在 `GET /ui/dashboard` 的 `routing` 内):

1. `trend[]` 每点增加 `size_v4`、`size_v6`(旧 `size` 保留 = 两者之和,兼容);
2. `summary` 增加 `as_count` —— RIB 中不同起源 AS 的总数;
3. (可选)`summary.rpki` 按家族拆分 `rpki_v4`/`rpki_v6`
   —— RPKI 三个统计格可补上 Radar 同款的 `IPv4:/IPv6:` 拆分行;
4. (可选)`as_count_v4`/`as_count_v6` —— AS 格的拆分行同理。

**备注**:`trend[]` 里的 `announced`/`withdrawn` 仪表盘已不再展示
(churn 小图按 Radar 版式移除),字段**保留即可**,后续节点页可能复用,不必删。

## R2 — 面板数据时间戳(as-of)

Radar 每张卡标注「数据生成时间 …」;dashboard 服务端有 ~3s 缓存、
routing 采集有分钟级延迟,"这个数字是几点的"直接决定可信度。

| 接口 | 字段 | 含义 |
|---|---|---|
| `GET /ui/dashboard` 顶层 | `generated_at` | 本次聚合的服务器时间(命中缓存则为缓存生成时间) |
| `dashboard.routing` 内 | `captured_at` | 参与聚合的最新路由快照时间 |
| `GET /ui/nodes/{id}/routing/dashboard` 顶层 | 已有 `summary.captured_at`,无需改 | — |
| `GET /ui/nodes/{id}/trends` 顶层 | `generated_at` | 序列蒸馏时间 |

**前端就绪**:各 Widget 底部的「更新于 HH:MM:SS」已在渲染,替换数据源即可。

## R1 — 上期对比序列(compare)

同色虚线"上一周期"对比是"这个值正常吗"的最快答案。
范围收窄说明:路由规模模块按 Radar 原版**不带**对比线,已从需求中移除;
现在只剩流量两处 + 可选的路由时间线。

| 接口 | 现返回 | 增加 |
|---|---|---|
| `GET /ui/dashboard` 的 `traffic` | `points[]` | `points_previous[]` |
| `GET /ui/nodes/{id}/traffic?minutes=N` | `points[]` | `points_previous[]` |
| (可选)`GET /ui/nodes/{id}/routing/dashboard` 的 `timeline` | `events[]` | `events_previous[]` |

**语义**:
- 触发参数 `?compare=1`(默认不带,零成本兼容);
- `*_previous` 为**紧邻的上一个等长窗口**,分桶粒度与主序列一致、桶数相同
  (不足的桶留空/null),前端按索引对齐叠加。

**前端就绪**:虚线 + 图例已渲染(`MOCK_PREVIOUS`),换字段即删 mock。

## R3 — 时间范围参数(range)

流量卡右上角的 24h/7d/30d 分段控件已就位,等接口吃参数。

**改动**:趋势类接口统一接受 `?range=6h|24h|7d|30d`(默认维持现值):

- `GET /ui/dashboard`(traffic + routing.trend)
- `GET /ui/nodes/{id}/traffic`(替代/兼容现有 `minutes`)
- `GET /ui/nodes/{id}/routing/dashboard`(timeline 桶数)

**关键约束**:服务端按 range 选分桶粒度,**返回点数上限 ~200**
(7d → 1h 桶,30d → 4h 桶),不要把原始点全量吐给前端。
与 R1 组合时,`*_previous` 取同粒度的上一窗口。

## R4 — 起源 AS 榜的深度与排序

起源 AS 已是 Radar Top-N 表(表头/斑马纹/搜索/每页 20 行分页),
但分页和搜索都是客户端的,深度受 BFF 返回条数限制。

- `routing.origins` 建议固定返回 **top 100**(表格按 20/页翻 5 页,对齐 Radar);
  或加 `?origins_top=N`(N ≤ 200);
- (可选)`origins[]` 每项加 `count_v4`/`count_v6`,表格可加"排序依据
  路由数/IPv4/IPv6"的分段控件(Radar 同款);
- (可选)`origins[]` 每项加 `name`(registry 里的 as-name),补上 Radar 的"名称"列;
- `traffic_breakdown` 加 `?breakdown_top=N`(现全量,节点多时浪费)。

## 建议排期

**R5(一天)→ R2(半天)→ R1(一天)→ R3(一天)→ R4(半天)**。
R5/R2 都是 dashboard 读路径的纯加字段,可一个 PR;R1/R3 同为趋势窗口逻辑,可一个 PR。
