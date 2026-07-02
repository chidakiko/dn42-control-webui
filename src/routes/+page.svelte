<script lang="ts">
	import { api, errorMessage } from '$lib/api';
	import type {
		FleetOverview,
		FleetRoutingOverview,
		TrafficPoint,
		FleetTrafficBreakdown,
		PeeringIssue
	} from '$lib/types';
	import FleetRouting from '$lib/components/FleetRouting.svelte';
	import { fmtBytes, fmtRate } from '$lib/format';
	import { pollEffect } from '$lib/refresh.svelte';
	import { urlParam } from '$lib/urlstate.svelte';
	import { t, locale } from '$lib/i18n.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Widget from '$lib/components/Widget.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import InlineBanner from '$lib/components/InlineBanner.svelte';
	import FleetMap from '$lib/components/FleetMap.svelte';
	import TrendChart from '$lib/components/charts/TrendChart.svelte';
	import ChartLegend from '$lib/components/charts/ChartLegend.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	// --- real fleet WG throughput (rx/tx bytes/s) from /fleet/traffic ---
	// quantity series → data palette (semantic ok/bad stay reserved for status)
	const RX_COLOR = 'var(--c-data-1)';
	const TX_COLOR = 'var(--c-data-2)';

	let fleetTrafficPts = $state<TrafficPoint[]>([]);
	// previous-window overlay (?compare=1), same bucket grid — align by index
	let fleetTrafficPrev = $state<TrafficPoint[]>([]);
	// range-grid buckets with no data are null; "has traffic" = any real sample
	let hasTraffic = $derived(
		fleetTrafficPts.some((p) => p.rx_bytes_per_sec != null || p.tx_bytes_per_sec != null)
	);
	let hasPrev = $derived(fleetTrafficPrev.some((p) => p.rx_bytes_per_sec != null));
	let trafficSeries = $derived([
		{ label: t('traffic.rx'), color: RX_COLOR, values: fleetTrafficPts.map((p) => p.rx_bytes_per_sec), fill: true },
		{ label: t('traffic.tx'), color: TX_COLOR, values: fleetTrafficPts.map((p) => p.tx_bytes_per_sec) },
		...(hasPrev
			? [
					{
						label: t('chart.prevPeriod'),
						color: RX_COLOR,
						dash: true,
						values: fleetTrafficPrev.map((p) => p.rx_bytes_per_sec)
					}
				]
			: [])
	]);
	// card-level range control — drives ?range= on /ui/dashboard (fixed grid,
	// ≤200 buckets, server picks the bucket size). Lives in the querystring
	// (contract 1): refresh/back/share reproduce the same window.
	const TRAF_RANGES = ['24h', '7d', '30d'] as const;
	type TrafRange = (typeof TRAF_RANGES)[number];
	const rangeParam = urlParam('range', '24h', { push: true });
	let trafRange = $derived(
		(TRAF_RANGES as readonly string[]).includes(rangeParam.value)
			? (rangeParam.value as TrafRange)
			: '24h'
	);
	let trafficStamps = $derived(fleetTrafficPts.map((p) => p.captured_at));
	// last bucket with data (the trailing bucket of a live grid is often empty)
	let lastPt = $derived([...fleetTrafficPts].reverse().find((p) => p.rx_bytes_per_sec != null));
	let peakRx = $derived(fleetTrafficPts.reduce((m, p) => Math.max(m, p.rx_bytes_per_sec ?? 0), 0));
	let peakTx = $derived(fleetTrafficPts.reduce((m, p) => Math.max(m, p.tx_bytes_per_sec ?? 0), 0));

	// "loaded once" flags for the traffic widgets: keyed off the first /ui/dashboard
	// arrival (not `data`), so the EmptyState never flashes before the payload lands.
	let trafficLoaded = $state(false);
	let breakdownLoaded = $state(false);

	// right-panel ranking: per-node / per-peer current throughput (tab-switched)
	let breakdown = $state<FleetTrafficBreakdown | null>(null);
	let trafTab = $state<'nodes' | 'peers'>('nodes');
	type TrafRow = { key: string; label: string; sub?: string; href: string; rx: number; tx: number };
	let trafRows = $derived.by((): TrafRow[] => {
		const b = breakdown;
		if (!b) return [];
		if (trafTab === 'nodes')
			return b.nodes.map((n) => ({
				key: n.node_id,
				label: n.node_id,
				href: `/nodes/${n.node_id}?tab=traffic`,
				rx: n.rx_bytes_per_sec,
				tx: n.tx_bytes_per_sec
			}));
		return b.peers.map((p, i) => ({
			key: `${p.node_id}/${p.interface ?? ''}/${i}`,
			label: p.node_id,
			sub: p.interface ?? p.public_key?.slice(0, 10) ?? '—',
			href: `/nodes/${p.node_id}?tab=traffic`,
			rx: p.rx_bytes_per_sec,
			tx: p.tx_bytes_per_sec
		}));
	});
	let maxTrafRate = $derived(trafRows.reduce((m, r) => Math.max(m, r.rx + r.tx), 0) || 1);

	// fleet peering health: BGP/peering sessions that aren't Established
	let peeringIssues = $state<PeeringIssue[]>([]);
	let peeringLoaded = $state(false);

	let data = $state<FleetOverview | null>(null);
	let routing = $state<FleetRoutingOverview | null>(null);
	let loading = $state(true);
	let error = $state('');

	// "Updated HH:MM:SS" stamp for the widget footers — the SERVER's aggregation
	// time (generated_at; cache-generation time on TTL hits), not client fetch time.
	let lastUpdated = $state<Date | null>(null);
	let asofLabel = $derived(
		lastUpdated ? `${t('common.updatedAt')} ${lastUpdated.toLocaleTimeString(locale.tag)}` : ''
	);

	// ONE request per refresh tick: /ui/dashboard bundles overview + traffic +
	// breakdown + peering issues + the routing board (server caches ~3s).
	// range rides the card control; compare=1 brings the previous-window overlay;
	// origins_top=100 fills the Radar top-origins table's 5 pages of 20.
	async function load() {
		if (!data) loading = true; // spinner only on first load; polls update silently
		error = '';
		try {
			const d = await api.dashboard({ range: trafRange, compare: true, originsTop: 100 });
			data = d.overview;
			fleetTrafficPts = d.traffic.points;
			fleetTrafficPrev = d.traffic.points_previous ?? [];
			breakdown = d.traffic_breakdown;
			peeringIssues = d.peering_issues;
			routing = d.routing;
			trafficLoaded = true;
			breakdownLoaded = true;
			peeringLoaded = true;
			lastUpdated = new Date(d.generated_at);
		} catch (err) {
			error = errorMessage(err);
		} finally {
			loading = false;
		}
	}

	// reload on tick + when the range control changes
	pollEffect(
		() => load(),
		() => trafRange
	);

	let total = $derived(data ? data.nodes.length : 0);
	let okCount = $derived(data ? (data.summary.ok ?? 0) : 0);
	// Liveness + version compliance are aggregated server-side now
	// (agent_summary is a top-level field — its "stale" would collide with the
	// health summary's "stale" if merged).
	let onlineCount = $derived(data?.agent_summary.online ?? 0);
	let behindCount = $derived(data?.agent_summary.agents_behind ?? 0);
	let targetVer = $derived(data?.agent_target_version ?? null);
</script>

{#if error && !data}
	<div class="card"><p class="error-text">{error}</p></div>
{:else if data && data.nodes.length === 0}
	<div class="card" style="padding:0">
		<EmptyState icon="nodes" title={t('dash.empty')} hint={t('dash.subtitle')} />
	</div>
{:else}
	{#if error}<InlineBanner detail={error} />{/if}
	<!-- topology — Widget header is static and always rendered; only the map area
	     is a skeleton until data, so the page frame never shifts on load. -->
	<Widget title={t('dash.topology')} sub={t('dash.topologySub')} asof={asofLabel}>
		{#snippet controls()}
			{#if data}
				<div class="kpis">
					<span class="kpi"><strong>{okCount}/{total}</strong> {t('health.ok')}</span>
					<span class="kpi"><strong>{onlineCount}/{total}</strong> {t('live.online')}</span>
					{#if targetVer}
						<a class="kpi ver-kpi" href="/agent-releases" class:warn={behindCount > 0}>
							<span class="mono">{targetVer}</span>
							{#if behindCount > 0}
								· <strong class="bad-num">{behindCount}</strong> {t('arel.behind')}
							{:else}
								· {t('arel.uptodate')}
							{/if}
						</a>
					{/if}
				</div>
			{:else}
				<Skeleton w="64px" h="1.05rem" />
			{/if}
		{/snippet}
		{#if data}
			<FleetMap nodes={data.nodes} links={data.links} />
		{:else}
			<div class="sk-fleet" aria-hidden="true">
				<Skeleton w="240px" h="1.5rem" />
				<div class="sk-row">
					<div class="sk-map"><Skeleton h="100%" /></div>
					<div class="sk-list">
						{#each Array(7) as _, i (i)}<Skeleton h="2.4rem" />{/each}
					</div>
				</div>
			</div>
		{/if}
	</Widget>

	<!-- peering issues — fleet BGP/peering sessions not established -->
	<div class="sect">
		<Widget title={t('dash.peering.title')} sub={t('dash.peering.subtitle')}>
			{#snippet controls()}
				{#if peeringLoaded && peeringIssues.length > 0}
					<span class="kpi"><strong class="bad-num">{peeringIssues.length}</strong> {t('dash.peering.count', peeringIssues.length)}</span>
				{/if}
			{/snippet}
			{#if !peeringLoaded}
				<div class="pi-rows">
					{#each Array(3) as _, i (i)}<Skeleton h="1.9rem" />{/each}
				</div>
			{:else if peeringIssues.length === 0}
				<div class="pi-ok"><Icon name="shield-check" size={16} />{t('dash.peering.allUp')}</div>
			{:else}
				<div class="pi-rows">
					{#each peeringIssues as p (p.node_id + '/' + p.name)}
						<a
							class="pi-row"
							href="/nodes/{p.node_id}?tab=bgp-sessions"
							style="--pi:{p.health === 'down' ? 'var(--c-bad)' : 'var(--c-warn)'}"
						>
							<span class="pi-dot"></span>
							<span class="pi-node mono">{p.node_id}</span>
							<span class="pi-name mono">{p.name}</span>
							<span class="pi-scope">{p.scope === 'external' ? 'eBGP' : 'iBGP'}</span>
							<span class="grow"></span>
							<span class="pi-state" style="color:var(--pi)">{p.state ?? p.health}</span>
						</a>
					{/each}
				</div>
			{/if}
		</Widget>
	</div>

	<!-- routing — FleetRouting renders its own Widget cards + shape-matched skeleton -->
	<div class="sect">
		<FleetRouting data={routing} asof={asofLabel} />
	</div>

	<!-- traffic — Radar hero card: title/description live INSIDE the card, chart on
	     the left, a border-divided rail with current rx/tx figures on the right
	     (Radar's "流量趋势 | 协议" composition); ranking card beside. -->
	<div class="sect">
		<div class="traf-2col">
			<Widget
				title={t('dash.traffic')}
				sub={t('dash.trafficSub')}
				asof={asofLabel}
				cls="traf-chart"
			>
				{#snippet controls()}
					<div class="seg">
						{#each TRAF_RANGES as r (r)}
							<button class="segbtn" class:active={trafRange === r} onclick={() => (rangeParam.value = r)}>
								{t(`range.${r}`)}
							</button>
						{/each}
					</div>
				{/snippet}
				<div class="hero">
					<div class="hero-main">
						{#if hasTraffic}
							<ChartLegend
								items={[
									{ label: t('traffic.rx'), color: RX_COLOR },
									{ label: t('traffic.tx'), color: TX_COLOR },
									...(hasPrev
										? [{ label: t('chart.prevPeriod'), color: 'var(--text-faint)', dash: true }]
										: [])
								]}
							/>
							<TrendChart series={trafficSeries} timestamps={trafficStamps} height={220} zeroBased format={fmtRate} />
						{:else if !trafficLoaded}
							<Skeleton h="220px" />
						{:else}
							<EmptyState icon="activity" title={t('dash.traffic.empty')} hint={t('dash.traffic.emptyHint')} />
						{/if}
					</div>
					{#if hasTraffic}
						<div class="hero-rail">
							<div class="rail-item">
								<span class="rail-lbl"><i style="background:{RX_COLOR}"></i>{t('traffic.rx')}</span>
								<span class="rail-val">{fmtRate(lastPt?.rx_bytes_per_sec ?? 0)}</span>
								<span class="rail-sub">{t('traffic.peak')} {fmtRate(peakRx)}</span>
							</div>
							<div class="rail-item">
								<span class="rail-lbl"><i style="background:{TX_COLOR}"></i>{t('traffic.tx')}</span>
								<span class="rail-val">{fmtRate(lastPt?.tx_bytes_per_sec ?? 0)}</span>
								<span class="rail-sub">{t('traffic.peak')} {fmtRate(peakTx)}</span>
							</div>
						</div>
					{/if}
				</div>
			</Widget>

			<Widget title={t('dash.traffic.ranking')} cls="traf-list">
				{#snippet controls()}
					<div class="seg">
						<button class="segbtn" class:active={trafTab === 'nodes'} onclick={() => (trafTab = 'nodes')}>
							{t('traffic.byNode')}
						</button>
						<button class="segbtn" class:active={trafTab === 'peers'} onclick={() => (trafTab = 'peers')}>
							{t('traffic.byPeer')}
						</button>
					</div>
				{/snippet}
				{#if trafRows.length}
					<div class="traf-rows">
						{#each trafRows as r (r.key)}
							<a class="traf-row" href={r.href}>
								<span class="traf-label mono">
									{r.label}{#if r.sub}<span class="traf-sub"> · {r.sub}</span>{/if}
								</span>
								<span class="traf-bar">
									{#if r.rx > 0}<i style="width:{(r.rx / maxTrafRate) * 100}%; background:{RX_COLOR}"></i>{/if}
									{#if r.tx > 0}<i style="width:{(r.tx / maxTrafRate) * 100}%; background:{TX_COLOR}"></i>{/if}
								</span>
								<span class="traf-rate mono">{fmtRate(r.rx + r.tx)}</span>
							</a>
						{/each}
					</div>
				{:else if !breakdownLoaded}
					<div class="traf-rows">
						{#each Array(7) as _, i (i)}<Skeleton h="1.6rem" />{/each}
					</div>
				{:else}
					<div class="empty">{t('dash.traffic.empty')}</div>
				{/if}
			</Widget>
		</div>
	</div>
{/if}

<style>
	.kpis {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 1.1rem;
		justify-content: flex-end;
	}
	.kpi {
		font-size: 0.85rem;
		color: var(--text-dim);
	}
	.kpi .bad-num {
		color: var(--c-bad);
	}
	.ver-kpi {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--text-dim);
		padding: 0.1rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.ver-kpi:hover {
		text-decoration: none;
		border-color: var(--text-faint);
	}
	.ver-kpi.warn {
		color: var(--c-warn);
		border-color: color-mix(in srgb, var(--c-warn) 45%, transparent);
	}
	.ver-kpi .mono {
		color: var(--text);
		font-weight: 600;
	}
	.ver-kpi.warn .mono {
		color: var(--c-warn);
	}
	/* peering issues list */
	.pi-ok {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		color: var(--c-ok);
		font-size: 0.88rem;
	}
	.pi-rows {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.pi-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.5rem;
		border-radius: var(--radius-sm);
		color: inherit;
	}
	.pi-row:hover {
		background: var(--bg-elev-2);
		text-decoration: none;
	}
	.pi-row .grow {
		flex: 1;
	}
	.pi-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--pi);
		flex: none;
	}
	.pi-node {
		font-weight: 600;
		color: var(--text);
		font-size: 0.84rem;
	}
	.pi-name {
		font-size: 0.8rem;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.pi-scope {
		font-size: 0.64rem;
		font-weight: 700;
		color: var(--text-faint);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.02rem 0.3rem;
		flex: none;
	}
	.pi-state {
		font-size: 0.78rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* dashboard sections stack with the Radar grid gap */
	.sect {
		margin-top: 1.5rem;
	}
	/* Radar hero composition inside the traffic widget: chart column + rail */
	.hero {
		display: flex;
		gap: 1.4rem;
		flex: 1;
		min-height: 0;
	}
	.hero-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.hero-rail {
		flex: 0 0 168px;
		border-left: 1px solid var(--border);
		padding-left: 1.4rem;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 1.2rem;
	}
	.rail-item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.rail-lbl {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.76rem;
		color: var(--text-dim);
	}
	.rail-lbl i {
		width: 9px;
		height: 9px;
		border-radius: 2px;
		flex: 0 0 auto;
	}
	.rail-val {
		font-size: 1.3rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.15;
	}
	.rail-sub {
		font-size: 0.72rem;
		color: var(--text-faint);
	}
	@media (max-width: 720px) {
		.hero {
			flex-direction: column;
		}
		.hero-rail {
			border-left: none;
			border-top: 1px solid var(--border);
			padding: 0.85rem 0 0;
			flex-direction: row;
			gap: 2rem;
		}
	}
	/* traffic board: left rx/tx trend (60%) + right tabbed ranking (40%).
	   The columns are Widget components, so their sizing classes need :global. */
	.traf-2col {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.traf-2col > :global(.card + .card) {
		margin-top: 0; /* cancel global .card + .card stacking inside the flex row */
	}
	@media (min-width: 900px) {
		.traf-2col {
			flex-direction: row;
			align-items: stretch;
			/* definite height so the (possibly long) ranking list scrolls internally
			   instead of stretching both cards when switching to the peers tab */
			height: 404px;
		}
		.traf-2col > :global(.traf-chart) {
			flex: 0 0 60%;
			min-width: 0;
		}
		.traf-2col > :global(.traf-list) {
			flex: 0 0 calc(40% - 1.5rem);
			min-height: 0;
		}
	}
	.traf-rows {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.traf-row {
		display: grid;
		grid-template-columns: minmax(70px, 38%) 1fr auto;
		align-items: center;
		column-gap: 0.6rem;
		padding: 0.34rem 0.4rem;
		border-radius: var(--radius-sm);
		color: inherit;
	}
	.traf-row:hover {
		background: var(--bg-elev-2);
		text-decoration: none;
	}
	.traf-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.traf-sub {
		font-weight: 400;
		color: var(--text-faint);
	}
	.traf-bar {
		display: flex;
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
		background: var(--bg-elev-2);
		min-width: 0;
	}
	.traf-bar i {
		height: 100%;
	}
	.traf-rate {
		font-size: 0.76rem;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
		text-align: right;
		white-space: nowrap;
	}
	.kpi strong {
		font-variant-numeric: tabular-nums;
		font-size: 1.05rem;
		color: var(--ok);
		margin-right: 0.15rem;
	}
	/* first-load skeleton mirrors FleetMap: summary bar + map(60%)/list(40%) row at
	   the same height, so swapping skeleton → map causes no layout shift. */
	.sk-fleet {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	.sk-row {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.sk-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	@media (min-width: 900px) {
		.sk-row {
			flex-direction: row;
			height: clamp(300px, 40vh, 440px);
		}
		.sk-map {
			flex: 0 0 60%;
		}
		.sk-list {
			flex: 0 0 calc(40% - 1rem);
		}
	}
</style>
