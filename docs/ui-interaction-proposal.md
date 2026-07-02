# WebUI 交互与页面设计方案(参照 GitHub / Cloudflare)

> 由三轮全量代码审计(列表页 / 节点详情页 / 共享原语)+ 对 GitHub Primer、Cloudflare Dashboard
> 交互范式的对照研究综合而成。姊妹篇:`ui-api-proposal.md`(后端接口);本文只谈前端交互。
>
> 定位判断:这是一个**单管理员、机器数据密集、长驻轮询**的运维控制台。
> 适合它的不是"更多动效、更多组件",而是一套稳定的交互契约:
> **GitHub 的状态模型(URL 即状态、就地报错、危险区确认)+ Cloudflare 的页面骨架
> (列表→详情 tab、表格工具栏、行级操作菜单、向导带 review 步)**。

---

## 1. 现状诊断

### 1.1 真实缺陷(不是风格问题,是错的)

| # | 缺陷 | 位置 | 说明 |
|---|---|---|---|
| D1 | **取消 prompt 仍执行 approve/reject** | `registrations/+page.svelte:43` | `prompt() ?? undefined` 把"取消"当成"无备注继续"。拒绝一个注册**无法中止、从未被真正确认** |
| D2 | **轮询失败清空已加载数据** | 所有列表页,如 `nodes/+page.svelte:138` | `{#if error}` 卡片整体替换表格。后台 tick 一次瞬时失败,整页数据消失,恢复前只剩错误卡 |
| D3 | **RPKI `not-found` / `not_found` 不一致** | `RoutingTab.svelte:264` vs `:41,116,140` | 判断用连字符、数据用下划线,`not_found` 路由类别永远落到 muted 而非 warn |
| D4 | **route-tuning 保存用陈旧快照整体回写** | `RouteTuningTab.svelte:82-102` | 以加载时的 `base_template` 为基座 merge 后 PUT,覆盖他处并发修改;同文件 `saveSession` 却先重取再合并——同页两套并发策略 |
| D5 | **SpecResource 的 `required` 是装饰** | `SpecResourceTab.svelte:439,152-153` | 只渲染 `*`,空值被 `formToSpec` 静默丢弃,交给后端 4xx |
| D6 | **PeerWizard 部分成功** | `PeerWizard.svelte:296-329` | 主 session 成功、额外 session 失败时向导照常关闭,失败项无法就地重试(根治靠后端提案 P0-3 事务化) |
| D7 | **probe 流静默结束** | `ProbeTab.svelte` / `api.ts:427` | 服务端无 `done` 帧关流时,终端无退出行无报错,像"自己停了" |
| D8 | `JsonEditor` 文档声称的 `parse()` 不存在 | `JsonEditor.svelte:1-3,23` | 头注释与导出 API 不符 |
| D9 | `HealthBadge` 的 `bad` 值无 i18n key | `HealthBadge.svelte:23` vs `i18n.svelte.ts:121-125` | 落到渲染原始字符串 "bad" |

### 1.2 系统性缺失(半成品感的真正来源)

半成品感不来自单个页面,而是**五个维度上都没有约定,每页各自即兴**:

**① 状态模型 —— URL 不承载任何状态**
- 全站没有任何页面读写 querystring(唯一例外:详情页 `?tab=` 只读一次,`nodes/[id]/+page.svelte:138`,之后切 tab 是裸赋值 `:483,494`,不回写 URL)。
- 后果:registrations 的 filter、audit 的 limit、dns-groups 的三级下钻、详情页当前 tab——刷新/后退/分享链接全部丢失。仪表盘往详情页发 `?tab=traffic` 深链(`+page.svelte`),详情页却不维护它,形成"能进不能出"的单向门。

**② 数据生命周期 —— 轮询裸奔**
- `fetch` 无超时、无重试、无 AbortController(`api.ts:99-103`);慢请求与下一个 tick 并发,后写覆盖先写。
- 各 tab 是否订阅 auto-refresh 完全随机:Overview/Status/Routing 头 tick,Peerings/Generations/Tokens/SpecResource 不 tick;最混乱的是 SpecResource **行不刷新但状态列刷新**(状态来自会 tick 的 `overview`,`nodes/[id]/+page.svelte:203-225`)——服务端已删的 session 会一直挂在表里,状态灯却在实时跳。
- 表单不被 tick 破坏靠的是"表单快照与展示数据分离"这个手工约定,无任何机制保证。

**③ 表格能力 —— 全站零个真正的数据表**
- 没有任何一张表有排序、搜索、真分页。仅有的两个"筛选"是 registrations 的状态 Select 和 audit 的"最近 N 条" Select。nodes / enrollment-tokens / dns-groups 都是无条件全量拉取。
- RoutingTab 的搜索框每敲一键就发请求(无防抖,`RoutingTab.svelte:91-98`),却又保留 Enter 和刷新按钮,交互心智混乱(看着手动,实际实时)。

**④ 写操作流 —— 三种确认方式并存,零脏数据保护**
- 11 处破坏性操作全部 `window.confirm`(原生、不可样式化、不可测试),registrations 用原生 `prompt`,而项目明明有 bits-ui 的 `Modal`。
- 删除按钮的形态:enrollment-tokens 是文字 "Delete",dns-groups 是 "✕" 字形——同一语义两种呈现。
- 全代码库零 `beforeNavigate` / `beforeunload` / dirty 检查:半填的 peering 表单、进行到第 3 步的向导,ESC/误点遮罩即静默丢弃。
- 所有保存都是 last-write-wins 整对象 PUT,无版本检查。

**⑤ 反馈与错误 —— 管道存在但末端漏水**
- 好的部分:401 全局兜底(`api.ts:112-117`)、动作 toast / 加载就地的分工、skeleton 尊重 `prefers-reduced-motion`。
- 漏的部分:**API 错误永不翻译**——i18n 有 4 语言约 700 个 key,但 `errorMessage()` 直接透传 FastAPI 原文;错误 toast 6 秒自动消失、无 sticky 选项、无去重上限;错误用 `role="status"` 而非 `role="alert"`;skeleton 有三套用法(SkeletonTable / 手写 Skeleton 行 / 纯文字),空状态有两套(EmptyState / 裸 `.empty` div,如 `dns-groups:281`、仪表盘 `:293`)。

---

## 2. 参照系:GitHub / Cloudflare 各取什么

### 2.1 GitHub(Primer)—— 取"状态与安全"

| 范式 | GitHub 做法 | 对本项目的意义 |
|---|---|---|
| **URL 即状态** | Issues 列表的每个筛选、排序、页码都在 querystring;链接可分享、后退可用 | 直接治愈 ①;运维场景"把这个筛选结果发给自己另一台机器/贴进工单"是刚需 |
| **就地 banner,不靠 toast** | 持久性问题(冲突、权限)用页面内 flash banner,直到被解决 | 治愈 D2:轮询失败 = 数据上方一条"数据已过期,重试中"细条,**旧数据保留** |
| **危险区 + 输入名称确认** | 删 repo 要进 Danger Zone、手动输入 repo 名 | 删节点/回滚 generation 属于这一级;删 token/记录用普通样式化确认即可 |
| **表单错误落在字段旁** | 校验错误显示在输入框下方,不是全局弹条 | 治愈 D5:required 校验前端做,错误贴字段 |
| 不取 | PR/review 协作流、reactions 等社交面 | 单管理员用不上 |

### 2.2 Cloudflare Dashboard —— 取"骨架与密度"

| 范式 | Cloudflare 做法 | 对本项目的意义 |
|---|---|---|
| **列表 → 详情 tab 的资源骨架** | Zone 列表 → Zone 详情左侧/顶部 tab,面包屑回退 | 已有雏形(nodes → node detail),补上 tab↔URL 双向同步即达标 |
| **表格工具栏** | 表上方一行:搜索框 + 筛选下拉 + 结果计数;列头可排序;行尾 "⋯" 菜单收纳操作 | 治愈 ③④:删除/编辑收进行级菜单,消灭 "Delete 文字 vs ✕" 的分裂 |
| **向导带 review 步 + 原子提交** | 添加站点/规则的分步向导,最后一步全量预览 | PeerWizard 已有 review 步(做对了),缺的是原子性(D6,靠后端) |
| **轮询静默 + 数据永不闪没** | Analytics 自动刷新时旧图保留,角落转小圈 | 治愈 ②:stale-while-revalidate 语义 |
| **secret 只显示一次** | API token 创建后一次性展示 | 已有 `SecretReveal`,保留 |
| 不取 | 多账户/多产品导航、营销位 | 不适用 |

### 2.3 明确不做的(同样重要)

- **乐观更新**:基础设施操作(删 peering、回滚)宁可悲观等待 + 明确 pending 态,错误的"看起来成功了"比慢半秒昂贵得多。
- **批量选择/批量操作**:单管理员、节点数量级为几十,先不做,表格契约留出左侧 checkbox 列的扩展位即可。
- **命令面板 / 全局快捷键体系**:P2 以后再议,先把鼠标路径做对。

---

## 3. 方案:六条交互契约

以下六条是"方法"本身。新写或重构任何页面时逐条对照,不满足即不算完成——这就是消灭半成品的机制。

### 契约 1:URL 是唯一可分享状态

- 列表页的筛选、搜索词、分页游标、详情页的 tab/子 tab,一律进 querystring。
- 写入规则:输入类(搜索词)用 `replaceState`(不产生历史),离散切换(tab、筛选)用 `pushState`(后退可回)。
- 实现:一个 ~40 行的 `urlState(key, default)` runes helper 封装 `page.url` 读 + `goto(…, { replaceState, keepFocus, noScroll })` 写,全站复用。
- 验收:任何页面 F5 后回到完全相同的视图;浏览器后退按钮在 tab 间移动。

### 契约 2:数据永不因刷新而消失(stale-while-revalidate)

- 一个共享的 `poll(loadFn)` helper 统一管:
  - **keep-last-good**:失败保留旧数据,在内容区顶部渲染细条 banner("数据获取失败,xx 秒后重试 · 重试"),而非替换内容;
  - **in-flight 去重**:上一次未返回则跳过本 tick;
  - **AbortController**:组件卸载 / nodeId 切换时中止;
  - **超时**:默认 15s;
  - 首载 → skeleton;后续 tick → 静默。
- 每个 tab 的刷新策略显式声明(tick / manual / stream),消灭 SpecResource"行冻结、灯乱跳"这类隐式分裂:CRUD 型 tab(Peerings/SpecResource/Generations/Tokens)整体改为 tick 订阅——有了 keep-last-good 和表单快照分离,tick 是安全的。

### 契约 3:表格契约(一个 `DataTable` 的能力基线)

做一个薄封装(不引大依赖,现有 `<table>` 样式已够好),规定每张资源表必须有:

```
┌ toolbar: [搜索框(防抖 300ms)] [筛选 chips/Select] ──── [计数 n items] [刷新] ┐
│ thead: 可排序列头(aria-sort;数字列右对齐 + tabular-nums)                     │
│ tbody: 行主键列 = 链接;行尾 "⋯" DropdownMenu 收纳 编辑/删除/次要操作          │
│ 状态:skeleton(首载) / inline banner(错误,数据保留) / EmptyState(带 CTA)      │
└ footer: 游标分页(上一页/下一页;audit、status-events 走后端游标,其余客户端) ┘
```

- 排序/搜索在行数 < 500 时纯客户端(nodes/tokens/dns 都远小于此),audit 与 status-events 用 `ui-api-proposal.md` P1-5 的 `before_id` 游标。
- 删除/编辑一律进 "⋯" 菜单(bits-ui `DropdownMenu`),行内不再平铺按钮——统一 affordance,顺带解决按钮形态分裂。

### 契约 4:写操作分三档,确认有等级

| 档 | 适用 | 交互 |
|---|---|---|
| **行内** | 单字段开关/下拉(interface enabled、目标版本) | 控件即保存:pending 时控件内转圈,失败回滚 + toast |
| **Modal 表单** | 创建/编辑资源 | 提交前客户端 required/格式校验,错误贴字段下方(红字),不再只靠 toast;**dirty 时关闭需确认**(Modal 加 `dirty` prop,ESC/遮罩点击先问) |
| **向导 / 危险** | PeerWizard;删节点、回滚 generation、revoke token | 统一 `ConfirmModal` 组件替换全部 11 处 `window.confirm`:普通危险 = 样式化确认(红主按钮 + 后果说明);不可逆高危(删节点、回滚)= **输入资源名确认**(GitHub 式) |

- registrations 的 approve/reject 改为 ConfirmModal 变体:备注 textarea + 确认/取消,取消即中止(顺带修 D1)。
- 保存一律悲观:按钮 `saving` 态(已有)→ 成功 toast + 就地更新;不做乐观更新。

### 契约 5:错误分层,末端闭环

- **加载错误** → 契约 2 的就地 banner(数据保留);**动作错误** → toast + (表单场景)字段错误;**401** → 现有全局兜底不动;**403** → 给一句翻译过的"无权限/已锁定"。
- 错误文案:建一张 `errorKey(detail)` 映射表把已知后端 detail 翻译成 i18n key,未知的原样透传并加"服务器返回:"前缀——不追求全覆盖,但高频错误(校验失败、名称冲突、节点离线)必须是用户语言。
- Toaster:错误改 `role="alert"`;同文案 2s 内去重;队列上限 5;错误 toast 提供"保持显示"悬停暂停。
- 修 D7:probe 流结束但无 `done` 帧时,终端追加一行"连接已断开"。

### 契约 6:一致性基线(一次性清欠)

- skeleton 只允许 `SkeletonTable`/`SkeletonText`(nodes 列表和仪表盘的手写骨架行换掉);
- 空状态只允许 `EmptyState`(dns-groups 子表、仪表盘流量榜的裸 `.empty` 换掉);
- `loading = true` 一律加 empty 守卫(现在三个页面无守卫);
- 变更后反馈统一 "toast + 就地重载"(agent-releases `setTarget` 的直接替换改齐);
- provision 页补 `page-head`,与其他页面同构;
- 顺手修 D3(RPKI 命名)、D8(JsonEditor 注释)、D9(HealthBadge `bad`);
- 删除 `node/` 目录下已不被节点页使用的 `DnsRecordsPanel` 引用关系错位(移到 `components/dns/` 或在节点 DNS tab 真正接入)。

---

## 4. 落地优先级

**P0 —— 缺陷与信任(1 个 PR 可完成)**
1. D1 prompt 取消 bug(先最小修:`prompt()` 返回 `null` 即 return;ConfirmModal 到 P1 再换)
2. D2 keep-last-good:列表页错误不再替换表格(可先不做完整 poll helper,只改渲染分支)
3. D3 RPKI 命名、D5 required 前端校验、D8、D9
4. `ConfirmModal` 组件 + 替换 11 处 `window.confirm` + registrations 备注弹窗

**P1 —— 契约落地(按页面推进)**
5. `urlState` helper;详情页 tab 回写 URL;registrations filter / audit limit / dns-groups 下钻进 querystring
6. `poll()` helper(去重/abort/超时/keep-last-good),全站接入;统一各 tab 刷新策略;RoutingTab 搜索防抖
7. `DataTable` 工具栏 + 客户端排序/搜索(nodes、enrollment-tokens、dns-groups 先行);行操作收进 "⋯" 菜单
8. Modal dirty 守卫;错误 i18n 映射表;Toaster 加固
9. audit / status-events 游标分页(依赖后端 P1-5)

**P2 —— 打磨**
10. 高危操作"输入名称确认";D6 向导原子化前端侧(依赖后端 P0-3);D7 断流提示
11. 契约 6 剩余清欠;键盘(`/` 聚焦搜索、Esc 关浮层)

**与后端提案(`ui-api-proposal.md`)的耦合**:D4 = 后端 P0-2(route-tuning 字段级接口);D6 = P0-3(provision 事务化);游标分页 = P1-5;liveness/geo 归位(P1-3/P1-4)会显著简化列表页。前端契约 1/2/3/4/5 不依赖后端,可立即开工。

---

## 5. 新增共享原语清单

| 组件/模块 | 职责 | 替换掉 |
|---|---|---|
| `ConfirmModal.svelte` | 样式化确认(普通/高危输名/带备注三变体) | 11 处 `window.confirm` + 1 处 `prompt` |
| `lib/poll.svelte.ts` | SWR 轮询:去重/abort/超时/keep-last-good | 18 处手写 `$effect(tick)` 惯用法 |
| `lib/urlstate.svelte.ts` | querystring ↔ runes 双向同步 | 各页组件内瞬态 state |
| `DataTable.svelte`(或 toolbar+useSort 组合) | 表格工具栏/排序/分页/行菜单基线 | 各页手写 table 外围 |
| `InlineBanner.svelte` | 内容区顶部的 stale/error 细条 | 替换整块 error 卡片 |
| `errorKey()` in `api.ts` | 后端 detail → i18n key 映射 | 裸 `errorMessage()` 透传 |
