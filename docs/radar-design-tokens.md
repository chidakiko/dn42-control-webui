# Cloudflare Radar (Kumo) 设计 token 实录

> 2026-07-02 从 radar.cloudflare.com 生产构建（Vite chunk）中直接提取，非截图目测。
> Cloudflare 的设计系统代号 **Kumo**。本文只收对本项目有用的部分，
> 落地映射见文末「对 app.css 的映射」。姊妹篇:`ui-interaction-proposal.md`。

## 1. 字体

`Inter`（正文/图表均是）。本项目已用 Inter Variable,无需改动。

## 2. 图表色阶(10 级,深 → 浅)

```
blue: #001c43 #002b67 #003681 #0045a6 #0051c3 #086fff #4693ff #82b6ff #b9d6ff #ecf4ff
cyan: #061b20 #0b333e #0d3e4b #115061 #156074 #1e89a5 #30b6da #73cee6 #ace2f0 #e9f7fb
gray: #1d1d1d #313131 #3d3d3d #4a4a4a #595959 #797979 #999999 #b6b6b6 #d9d9d9 #f2f2f2
```

（另有 red/orange/gold/green/indigo/violet/pink 同构色阶,需要时再取。）

**分类序列色板**(categorical,按顺序取):

```
#0045a6(深蓝) #73cee6(青) #f6821f(橙) #bcbf02 #22a121 #e574c3 #9564bf #d8241f #8d5649 #ffe43e
```

**流量趋势图的实际用法**:主系列 = `blue[3] #0045a6`、次系列 = `cyan[6] #30b6da`、
第三系列(HTTP 请求)= `cfOrange #f6821f`。语义色(ok/warn/bad)不参与数量图。

## 3. 折线图工艺(TrafficTrendsXY / XY chart 库)

| 项 | 值 |
|---|---|
| 主线宽 | 3px |
| 次线宽 | 2px |
| 上期对比线 | **同色** `strokeDasharray:"4"`、宽 1.8px |
| 图例 | 自定义 HTML;对比线的图例 swatch 是 `dashed-line` 形、灰色 `gray[5]`;**点击图例可开关对比线** |
| y 轴 domain | `[0, 'max']` |
| 轴标签字号 | xxSmall(≈11px) |

**网格透明度体系**(黑/白随主题,只调 alpha——这是"干净感"的秘方):

| token | alpha | 用途 |
|---|---|---|
| chart-label | 0.65 | 轴刻度文字 |
| chart-line | 0.10 | 常规网格线 |
| chart-dashed-line | 0.15 | 虚线网格(日期界) |
| chart-outer-line | 0.20 | 轴线/外框 |
| chart-divider-line | 0.35 | 分隔线 |
| chart-ref-line | 0.65 | 参考线 |

周末的 x 轴刻度文字会特殊处理(工作日/周末视觉区分)。

## 4. 比例条(StackedBar → 我们的 ShareBar)

从源码读出的全部参数:

- 默认高 30px;段间隙 **2px**;圆角 **2px**;
- `minPercentage: 0.1`——小于 0.1% 的段折进「其他」,「其他」用 `blue[2]`;`maxCategories: 20`;
- 悬停:非悬停段 opacity → 0.75,悬停段 `scaleY(1.11)` 弹性放大
  (`cubic-bezier(0.175,0.885,0.32,1.275)`,尊重 `prefers-reduced-motion`);
- 段内文字仅在**实测文字宽度 < 段宽**时渲染(标签 11px 粗体、数值 10px、60% 透明度,
  深浅色自动选黑/白字);
- 条上方图例与条 hover 双向联动;tooltip 带色点 + 标签 + 值 + 百分比。

## 5. 表面/语义色(Kumo,`light-dark()` 双值,oklch)

| token | light | dark | 对应我们的 |
|---|---|---|---|
| canvas(页面底) | 98.75% | **10%** | `--bg` |
| base(卡片) | white | **17%** | `--bg-elev` |
| elevated | 98% | 12% | — |
| recessed(内嵌区) | 96% | 15% | `--bg-elev-2` |
| line(边框) | 黑 @10% | 32% 灰 | `--border` |
| hairline(细分隔) | 93.5% | 26.9% | — |
| fill(控件底) | 92.2% | 26.9% | — |

要点:暗色下卡片(17%)**亮于**页面(10%);全部表面是**零色度中性灰**(无蓝调);
边框在亮色下用黑的 10% alpha 而非实色灰。
→ **已采用**(2026-07-02):`--bg #0a0a0a` / `--bg-elev #121212` / 亮色 `#fafafa`/white,
基础灰全部换成 Kumo gray 阶。

品牌色:图表/强调仍是 `cfOrange #f6821f`(与我们 `--accent` 完全相同);
链接是蓝色(`#0051c3` 亮 / `#82b6ff` 暗,SSR CSS 实测)→ **已采用**为 `--link`,
橙只留给品牌/强调(按钮、开关、激活导航)。Kumo 的蓝色主按钮我们不跟。

## 6. 对 app.css 的映射(建议增量)

```css
/* 数量类图表专用数据色(语义色 ok/warn/bad 只留给状态类图) */
--c-data-1: #0045a6;   /* dark: #4693ff(blue[6],暗底需更亮) */
--c-data-2: #30b6da;   /* dark: #73cee6 */
--c-data-3: var(--accent);
--c-data-other: #003681; /* ShareBar 的「其他」段 */

/* 图表网格:改为文字色的 alpha,替换现在的实色 --c-grid */
--c-grid:        color-mix(in srgb, var(--text) 10%, transparent);
--c-grid-dash:   color-mix(in srgb, var(--text) 15%, transparent);
--c-axis-label:  color-mix(in srgb, var(--text) 65%, transparent);
```

组件侧对应:`TrendChart` 主 2.5~3px / 次 2px / 对比同色虚线 `[4,4]` 1.5px、y 网格淡化或关闭;
新建 `ChartLegend.svelte`(dot / dashed 两种 swatch,可选点击开关系列)与
`ShareBar.svelte`(纯 CSS/SVG,参数照第 4 节)。
