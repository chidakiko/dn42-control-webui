<script lang="ts">
	import { untrack } from 'svelte';
	import { api, errorMessage } from '$lib/api';
	import { fmtTime } from '$lib/format';
	import { t } from '$lib/i18n.svelte';
	import { autoRefresh } from '$lib/refresh.svelte';
	import type {
		RouteEntry,
		RoutingOrigins,
		RoutingPrefixes,
		RoutingSummary,
		RoutingTimeline
	} from '$lib/types';
	import Donut from './../charts/Donut.svelte';
	import BarChart from './../charts/BarChart.svelte';
	import Sparkline from './../charts/Sparkline.svelte';
	import Modal from './../Modal.svelte';

	let { nodeId }: { nodeId: string } = $props();

	let summary = $state<RoutingSummary | null>(null);
	let origins = $state<RoutingOrigins | null>(null);
	let timeline = $state<RoutingTimeline | null>(null);
	let prefixes = $state<RoutingPrefixes | null>(null);
	let loading = $state(true);
	let err = $state('');

	// prefixes table controls
	let family = $state<'' | '4' | '6'>('');
	let scope = $state<'all' | 'local' | 'external'>('all');
	let q = $state('');
	let offset = $state(0);
	const LIMIT = 100;

	const RPKI_COLORS: Record<string, string> = {
		valid: 'var(--c-ok)',
		invalid: 'var(--c-bad)',
		not_found: 'var(--c-warn)',
		unknown: 'var(--c-unknown)'
	};
	const V4_COLOR = 'var(--c-accent)';
	const V6_COLOR = 'var(--c-ok)';

	async function loadHead() {
		if (!summary) loading = true;
		err = '';
		try {
			const [s, o, tl] = await Promise.all([
				api.routingSummary(nodeId),
				api.routingOrigins(nodeId, 15),
				api.routingTimeline(nodeId, 200)
			]);
			summary = s;
			origins = o;
			timeline = tl;
		} catch (e) {
			// 404 = never reported → show empty state, not an error banner.
			summary = null;
			origins = null;
			timeline = null;
			err = '';
		} finally {
			loading = false;
		}
	}

	async function loadPrefixes() {
		try {
			prefixes = await api.routingPrefixes(nodeId, {
				family: family || undefined,
				scope,
				q: q.trim() || undefined,
				limit: LIMIT,
				offset
			});
		} catch (e) {
			err = errorMessage(e);
		}
	}

	// Depend only on the refresh tick + node id; untrack the loader so its
	// internal reads (e.g. `summary`, which it also writes) don't make this
	// effect self-trigger into a request storm.
	$effect(() => {
		autoRefresh.tick;
		nodeId;
		untrack(() => loadHead());
	});

	// Reload the prefixes page whenever a filter/search/page changes (or once
	// summary first arrives). untrack the loader for the same reason.
	$effect(() => {
		family;
		scope;
		q;
		offset;
		const ready = summary !== null;
		if (ready) untrack(() => loadPrefixes());
	});

	function resetAndSearch() {
		offset = 0;
	}

	// --- chart data ---
	let familySegments = $derived(
		summary
			? [
					{ label: t('routing.v4'), value: summary.route_count_v4, color: V4_COLOR },
					{ label: t('routing.v6'), value: summary.route_count_v6, color: V6_COLOR }
				]
			: []
	);

	let rpkiSegments = $derived(
		summary
			? (['valid', 'invalid', 'not_found', 'unknown'] as const).map((k) => ({
					label: t(`routing.rpki.${k}`),
					value: summary!.rpki[k],
					color: RPKI_COLORS[k]
				}))
			: []
	);

	// prefix-length distribution: one bar per length, stacked v4 + v6.
	let prefixLenGroups = $derived.by(() => {
		if (!summary) return [];
		const v4 = summary.prefix_lengths['4'] ?? {};
		const v6 = summary.prefix_lengths['6'] ?? {};
		const lengths = [...new Set([...Object.keys(v4), ...Object.keys(v6)])]
			.map(Number)
			.sort((a, b) => a - b);
		return lengths.map((len) => ({
			label: `/${len}`,
			parts: [
				{ key: 'v4', value: v4[len] ?? 0, color: V4_COLOR },
				{ key: 'v6', value: v6[len] ?? 0, color: V6_COLOR }
			]
		}));
	});

	let asPathGroups = $derived.by(() => {
		if (!summary) return [];
		return Object.keys(summary.as_path_lengths)
			.map(Number)
			.sort((a, b) => a - b)
			.map((len) => ({
				label: String(len),
				parts: [
					{ key: 'n', value: summary!.as_path_lengths[len], color: V4_COLOR }
				]
			}));
	});

	let routeCountSeries = $derived(timeline ? timeline.events.map((e) => e.route_count) : []);

	let churnGroups = $derived(
		timeline
			? timeline.events.map((e) => ({
					label: '',
					parts: [
						{ key: 'announced', value: e.announced, color: V6_COLOR },
						{ key: 'withdrawn', value: e.withdrawn, color: 'var(--c-bad)' }
					]
				}))
			: []
	);

	let hasChurn = $derived(churnGroups.some((g) => g.parts.some((p) => p.value > 0)));

	function rpkiClass(v: string | null): string {
		if (v === 'valid') return 'ok';
		if (v === 'invalid') return 'bad';
		if (v === 'not-found') return 'warn';
		return 'muted';
	}

	// How many routes share each prefix on the current page (multipath grouping).
	let prefixCounts = $derived.by(() => {
		const m = new Map<string, number>();
		for (const r of prefixes?.routes ?? []) m.set(r.prefix, (m.get(r.prefix) ?? 0) + 1);
		return m;
	});
	function groupSize(prefix: string): number {
		return prefixCounts.get(prefix) ?? 1;
	}

	// Route detail modal: shows every path for the clicked prefix (full AS path +
	// communities), best highlighted.
	let showDetail = $state(false);
	let detailPrefix = $state('');
	let detailRoutes = $derived<RouteEntry[]>(
		prefixes ? prefixes.routes.filter((r) => r.prefix === detailPrefix) : []
	);
	function openDetail(prefix: string) {
		detailPrefix = prefix;
		showDetail = true;
	}
</script>

<div class="card-head">
	<h3>{t('routing.title')}</h3>
	<button class="btn sm" onclick={loadHead} disabled={loading}>↻</button>
</div>

{#if loading && !summary}
	<div class="empty">{t('common.loading')}</div>
{:else if !summary}
	<div class="empty">{t('routing.empty')}</div>
{:else}
	{#if summary.observation === 'unavailable'}
		<div class="note warn">{t('routing.unavailableNote')}</div>
	{/if}

	<!-- headline stats -->
	<div class="stats">
		<div class="stat">
			<span class="num mono">{summary.route_count}</span>
			<span class="lbl">{t('routing.totalRoutes')}</span>
		</div>
		<div class="stat">
			<span class="num mono">{summary.route_count_v4}</span>
			<span class="lbl">{t('routing.v4')}</span>
		</div>
		<div class="stat">
			<span class="num mono">{summary.route_count_v6}</span>
			<span class="lbl">{t('routing.v6')}</span>
		</div>
		<div class="stat">
			<span class="num mono">{summary.local_count}</span>
			<span class="lbl">{t('routing.localOrigin')}</span>
		</div>
		<div class="stat">
			<span class="num mono faint">{fmtTime(summary.captured_at)}</span>
			<span class="lbl">{t('routing.captured')}</span>
		</div>
	</div>

	<!-- donuts: family + rpki -->
	<div class="donuts">
		<div class="donut-card">
			<Donut segments={familySegments} size={140} thickness={20} centerValue={summary.route_count} centerLabel={t('routing.routes')} />
			<div class="legend">
				{#each familySegments as s (s.label)}
					<span><span class="kd" style="background:{s.color}"></span>{s.label} <b>{s.value}</b></span>
				{/each}
			</div>
		</div>
		<div class="donut-card">
			<Donut segments={rpkiSegments} size={140} thickness={20} centerLabel={t('routing.rpki')} />
			<div class="legend">
				{#each rpkiSegments as s (s.label)}
					<span><span class="kd" style="background:{s.color}"></span>{s.label} <b>{s.value}</b></span>
				{/each}
			</div>
		</div>
	</div>

	<!-- distributions -->
	<div class="grid2">
		<div class="chart-block">
			<span class="faint">{t('routing.prefixLen')}</span>
			<BarChart groups={prefixLenGroups} height={120} maxLabels={12} />
		</div>
		<div class="chart-block">
			<span class="faint">{t('routing.asPathLen')}</span>
			<BarChart groups={asPathGroups} height={120} maxLabels={12} />
		</div>
	</div>

	<!-- timeline -->
	{#if routeCountSeries.length > 1}
		<div class="chart-block">
			<span class="faint">{t('routing.timeline')}</span>
			<Sparkline values={routeCountSeries} width={600} height={48} color="var(--c-accent)" />
		</div>
	{/if}
	{#if hasChurn}
		<div class="chart-block">
			<span class="faint">{t('routing.churn')}</span>
			<BarChart groups={churnGroups} height={80} maxLabels={8} />
			<div class="legend">
				<span><span class="kd" style="background:{V6_COLOR}"></span>{t('routing.announced')}</span>
				<span><span class="kd" style="background:var(--c-bad)"></span>{t('routing.withdrawn')}</span>
			</div>
		</div>
	{/if}

	<!-- origins + peers -->
	<div class="grid2">
		<div>
			<h4>{t('routing.origins')}</h4>
			<table>
				<thead><tr><th>{t('routing.col.asn')}</th><th class="r">{t('routing.col.count')}</th></tr></thead>
				<tbody>
					{#each origins?.origins ?? [] as o (o.asn)}
						<tr><td class="mono">AS{o.asn}</td><td class="r mono">{o.count}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div>
			<h4>{t('routing.peers')}</h4>
			<table>
				<thead><tr><th>{t('routing.col.peer')}</th><th class="r">{t('routing.col.count')}</th></tr></thead>
				<tbody>
					{#each (summary.peers ?? []).slice(0, 15) as p (p.protocol)}
						<tr><td class="mono">{p.protocol}</td><td class="r mono">{p.count}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- prefixes table -->
	<div class="card-head" style="margin-top:1rem">
		<h4>{t('routing.prefixes')} {#if prefixes}<span class="faint">({prefixes.total})</span>{/if}</h4>
		<div class="inline">
			<select bind:value={family} onchange={resetAndSearch} style="width:auto">
				<option value="">{t('routing.family')}: {t('common.total')}</option>
				<option value="4">{t('routing.v4')}</option>
				<option value="6">{t('routing.v6')}</option>
			</select>
			<select bind:value={scope} onchange={resetAndSearch} style="width:auto">
				<option value="all">{t('routing.scope')}: {t('routing.scope.all')}</option>
				<option value="local">{t('routing.scope.local')}</option>
				<option value="external">{t('routing.scope.external')}</option>
			</select>
			<input
				placeholder={t('routing.search')}
				bind:value={q}
				onkeydown={(e) => e.key === 'Enter' && resetAndSearch()}
				style="width:auto"
			/>
			<button class="btn sm" onclick={resetAndSearch}>{t('common.refresh')}</button>
		</div>
	</div>

	{#if prefixes}
		<table>
			<thead>
				<tr>
					<th>{t('routing.col.prefix')}</th>
					<th>{t('routing.col.origin')}</th>
					<th>{t('routing.col.path')}</th>
					<th>{t('routing.col.nexthop')}</th>
					<th>{t('routing.col.proto')}</th>
					<th>{t('routing.col.rpki')}</th>
				</tr>
			</thead>
			<tbody>
				{#each prefixes.routes as r (r.prefix + (r.protocol ?? '') + (r.next_hop ?? ''))}
					{@const multi = groupSize(r.prefix) > 1}
					<tr
						class="clickable"
						class:best={multi && r.primary}
						class:backup={multi && !r.primary}
						onclick={() => openDetail(r.prefix)}
					>
						<td class="mono">
							{r.prefix}
							{#if r.local}<span class="local-tag" title={t('routing.localOrigin')}>{t('routing.local')}</span>{/if}
							{#if multi && r.primary}<span class="best-tag">{t('routing.best')}</span>{/if}
							{#if multi && !r.primary}<span class="backup-tag">{t('routing.backup')}</span>{/if}
						</td>
						<td class="mono">{r.origin_asn ? `AS${r.origin_asn}` : '—'}</td>
						<td class="mono faint path">
							{#if r.as_path.length === 0}—{:else}{r.as_path.slice(0, 2).join(' ')}{#if r.as_path.length > 2}<span class="morep">{t('routing.morePath', r.as_path.length - 2)}</span>{/if}{/if}
						</td>
						<td class="mono faint">{r.next_hop ?? '—'}</td>
						<td class="mono faint">{r.protocol ?? '—'}</td>
						<td>{#if r.rpki}<span class="rpki {rpkiClass(r.rpki)}">{r.rpki}</span>{:else}—{/if}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="pager">
			<span class="faint">{t('routing.showing', prefixes.routes.length, prefixes.total)}</span>
			<div class="inline">
				<button class="btn ghost sm" disabled={offset === 0} onclick={() => (offset = Math.max(0, offset - LIMIT))}>{t('routing.prev')}</button>
				<button class="btn ghost sm" disabled={offset + LIMIT >= prefixes.total} onclick={() => (offset += LIMIT)}>{t('routing.next')}</button>
			</div>
		</div>
	{/if}
{/if}

<Modal title="{t('routing.detailTitle')} · {detailPrefix}" bind:open={showDetail}>
	<div class="detail">
		<div class="detail-sub faint">{t('routing.paths', detailRoutes.length)}</div>
		{#each detailRoutes as r, i (i)}
			<div class="path-card" class:best={r.primary}>
				<div class="path-head">
					{#if r.primary}<span class="best-tag">{t('routing.best')}</span>{:else}<span class="backup-tag">{t('routing.backup')}</span>{/if}
					{#if r.local}<span class="local-tag">{t('routing.local')}</span>{/if}
					{#if r.rpki}<span class="rpki {rpkiClass(r.rpki)}">{r.rpki}</span>{/if}
				</div>
				<dl>
					<dt>{t('routing.f.proto')}</dt>
					<dd class="mono">{r.protocol ?? '—'}</dd>
					<dt>{t('routing.f.nexthop')}</dt>
					<dd class="mono">{r.next_hop ?? '—'}</dd>
					<dt>{t('routing.f.aspath')}</dt>
					<dd class="mono wrap">{r.as_path.length ? r.as_path.join(' ') : '—'}</dd>
					<dt>{t('routing.f.communities')}</dt>
					<dd class="mono wrap">
						{#if (r.communities ?? []).length}{#each r.communities as c (c)}<span class="comm">{c}</span>{/each}{:else}—{/if}
					</dd>
					<dt>{t('routing.f.largeCommunities')}</dt>
					<dd class="mono wrap">
						{#if (r.large_communities ?? []).length}{#each r.large_communities as c (c)}<span class="comm lg">{c}</span>{/each}{:else}—{/if}
					</dd>
				</dl>
			</div>
		{/each}
	</div>
</Modal>

<style>
	.note {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius-sm);
		font-size: 0.82rem;
		margin-bottom: 0.75rem;
	}
	.note.warn {
		background: var(--warn-bg);
		color: var(--warn);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.stat .num {
		font-size: 1.5rem;
		font-weight: 700;
	}
	.stat .num.faint {
		font-size: 0.9rem;
		font-weight: 500;
	}
	.stat .lbl {
		color: var(--text-faint);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.donuts {
		display: flex;
		gap: 2rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}
	.donut-card {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.legend {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
		color: var(--text-dim);
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.kd {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		display: inline-block;
	}
	.grid2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1.5rem;
		margin-bottom: 1rem;
	}
	.chart-block {
		margin-bottom: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	h4 {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
	}
	th.r,
	td.r {
		text-align: right;
	}
	.path {
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rpki {
		font-size: 0.72rem;
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
	}
	.rpki.ok {
		background: var(--ok-bg);
		color: var(--ok);
	}
	.rpki.bad {
		background: var(--bad-bg);
		color: var(--bad);
	}
	.rpki.warn {
		background: var(--warn-bg);
		color: var(--warn);
	}
	.rpki.muted {
		color: var(--text-faint);
	}
	.local-tag {
		font-size: 0.66rem;
		padding: 0.05rem 0.35rem;
		margin-left: 0.4rem;
		border-radius: 3px;
		background: var(--accent-soft);
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		vertical-align: middle;
	}
	tr.clickable {
		cursor: pointer;
	}
	tr.clickable:hover {
		background: var(--bg-elev-2);
	}
	/* best path within a multipath group: highlighted; backups dimmed. */
	tr.best {
		background: color-mix(in srgb, var(--c-ok) 9%, transparent);
	}
	tr.backup {
		opacity: 0.55;
	}
	.best-tag,
	.backup-tag {
		font-size: 0.66rem;
		padding: 0.05rem 0.35rem;
		margin-left: 0.4rem;
		border-radius: 3px;
		vertical-align: middle;
	}
	.best-tag {
		background: var(--ok-bg);
		color: var(--ok);
		border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent);
	}
	.backup-tag {
		color: var(--text-faint);
		border: 1px solid var(--border);
	}
	.morep {
		margin-left: 0.35rem;
		font-size: 0.7rem;
		color: var(--text-faint);
	}
	.detail-sub {
		font-size: 0.8rem;
		margin-bottom: 0.6rem;
	}
	.path-card {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.75rem;
		margin-bottom: 0.6rem;
	}
	.path-card.best {
		border-color: color-mix(in srgb, var(--ok) 45%, transparent);
		background: color-mix(in srgb, var(--c-ok) 7%, transparent);
	}
	.path-head {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.path-card dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.3rem 0.9rem;
		margin: 0;
	}
	.path-card dt {
		color: var(--text-faint);
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.path-card dd {
		margin: 0;
		font-size: 0.85rem;
	}
	.wrap {
		word-break: break-word;
	}
	.comm {
		display: inline-block;
		padding: 0.05rem 0.35rem;
		margin: 0 0.3rem 0.3rem 0;
		border-radius: 3px;
		background: var(--bg-elev-2);
		font-size: 0.76rem;
	}
	.comm.lg {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.6rem;
	}
</style>
