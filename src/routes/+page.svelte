<script lang="ts">
	import { untrack } from 'svelte';
	import { api, errorMessage } from '$lib/api';
	import type {
		FleetOverview,
		TrafficPoint,
		FleetTrafficBreakdown,
		PeeringIssue
	} from '$lib/types';
	import FleetRouting from '$lib/components/FleetRouting.svelte';
	import { fmtBytes, agentLiveness } from '$lib/format';
	import { autoRefresh } from '$lib/refresh.svelte';
	import { t } from '$lib/i18n.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import FleetMap from '$lib/components/FleetMap.svelte';
	import TrendChart from '$lib/components/charts/TrendChart.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';

	// --- real fleet WG throughput (rx/tx bytes/s) from /fleet/traffic ---
	// themed palette (consistent with the routing board above): rx = accent, tx = ok-green
	const RX_COLOR = 'var(--c-accent)';
	const TX_COLOR = 'var(--c-ok)';
	const fmtRate = (v: number) => fmtBytes(v) + '/s';

	let fleetTrafficPts = $state<TrafficPoint[]>([]);
	let hasTraffic = $derived(fleetTrafficPts.length > 1);
	let trafficSeries = $derived([
		{ label: t('traffic.rx'), color: RX_COLOR, values: fleetTrafficPts.map((p) => p.rx_bytes_per_sec), fill: true },
		{ label: t('traffic.tx'), color: TX_COLOR, values: fleetTrafficPts.map((p) => p.tx_bytes_per_sec) }
	]);
	let trafficStamps = $derived(fleetTrafficPts.map((p) => p.captured_at));
	let lastPt = $derived(fleetTrafficPts.at(-1));
	let peakRx = $derived(fleetTrafficPts.reduce((m, p) => Math.max(m, p.rx_bytes_per_sec), 0));
	let peakTx = $derived(fleetTrafficPts.reduce((m, p) => Math.max(m, p.tx_bytes_per_sec), 0));

	// "loaded once" flags for the traffic widgets. They load AFTER `data` (a separate,
	// later fetch), so skeletons must key off these — not `data` — or the EmptyState
	// flashes in the window where data has arrived but traffic hasn't.
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
	let loading = $state(true);
	let error = $state('');

	async function load() {
		if (!data) loading = true; // spinner only on first load; polls update silently
		error = '';
		try {
			data = await api.fleetOverview();
		} catch (err) {
			error = errorMessage(err);
		} finally {
			loading = false;
		}
		try {
			fleetTrafficPts = (await api.fleetTraffic()).points;
		} catch {
			fleetTrafficPts = [];
		} finally {
			trafficLoaded = true;
		}
		try {
			breakdown = await api.fleetTrafficBreakdown();
		} catch {
			breakdown = null;
		} finally {
			breakdownLoaded = true;
		}
		try {
			peeringIssues = (await api.fleetPeeringIssues()).issues;
		} catch {
			peeringIssues = [];
		} finally {
			peeringLoaded = true;
		}
	}

	$effect(() => {
		autoRefresh.tick;
		untrack(() => load());
	});

	let total = $derived(data ? data.nodes.length : 0);
	let okCount = $derived(data ? (data.summary.ok ?? 0) : 0);
	// Heartbeat presence (primary liveness) + version compliance, both aggregated
	// client-side from the fleet overview rows.
	let onlineCount = $derived(
		data ? data.nodes.filter((n) => agentLiveness(n.last_heartbeat_at) === 'online').length : 0
	);
	let behindCount = $derived(
		data ? data.nodes.filter((n) => n.agent_up_to_date === false).length : 0
	);
	let targetVer = $derived(data?.agent_target_version ?? null);
</script>

{#if error}
	<div class="card"><p class="error-text">{error}</p></div>
{:else if data && data.nodes.length === 0}
	<div class="card" style="padding:0">
		<EmptyState icon="nodes" title={t('dash.empty')} hint={t('dash.subtitle')} />
	</div>
{:else}
	<!-- topology — header is static and always rendered; only the map area is a
	     skeleton until data, so the page frame never shifts on load. -->
	<div class="page-head topo-head">
		<div>
			<div class="ph-title">
				<Icon name="nodes" size={20} />
				<h2 style="margin:0; font-size:1.15rem">{t('dash.topology')}</h2>
			</div>
			<p class="ph-sub">{t('dash.topologySub')}</p>
		</div>
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
	</div>
	<div class="card">
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
	</div>

	<!-- peering issues — fleet BGP/peering sessions not established -->
	<div class="doc-peering" style="margin-top:1.75rem">
		<div class="page-head" style="margin-bottom:1rem">
			<div>
				<div class="ph-title">
					<Icon name="bird" size={20} />
					<h2 style="margin:0; font-size:1.15rem">{t('dash.peering.title')}</h2>
				</div>
				<p class="ph-sub">{t('dash.peering.subtitle')}</p>
			</div>
			{#if peeringLoaded && peeringIssues.length > 0}
				<span class="kpi"><strong class="bad-num">{peeringIssues.length}</strong> {t('dash.peering.count', peeringIssues.length)}</span>
			{/if}
		</div>
		<div class="card">
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
		</div>
	</div>

	<!-- routing — FleetRouting renders its own static header + shape-matched skeleton -->
	<div class="doc-routing" style="margin-top:1.75rem">
		<FleetRouting />
	</div>

	<!-- traffic — section header static; left = fleet rx/tx trend, right = per-node/per-peer ranking -->
	<div class="doc-traffic" style="margin-top:1.75rem">
		<div class="page-head trend-head" style="margin-bottom:1rem">
			<div>
				<div class="ph-title">
					<Icon name="activity" size={20} />
					<h2 style="margin:0; font-size:1.15rem">{t('dash.traffic')}</h2>
				</div>
				<p class="ph-sub">{t('dash.trafficSub')}</p>
			</div>
			{#if hasTraffic}
				<div class="trend-now">
					<span class="tn">
						<span class="ld" style="background:{RX_COLOR}"></span>{t('traffic.rx')}
						<b>{fmtRate(lastPt?.rx_bytes_per_sec ?? 0)}</b>
						<small>{t('traffic.peak')} {fmtRate(peakRx)}</small>
					</span>
					<span class="tn">
						<span class="ld" style="background:{TX_COLOR}"></span>{t('traffic.tx')}
						<b>{fmtRate(lastPt?.tx_bytes_per_sec ?? 0)}</b>
						<small>{t('traffic.peak')} {fmtRate(peakTx)}</small>
					</span>
				</div>
			{/if}
		</div>

		<div class="traf-2col">
			<div class="card traf-chart">
				{#if hasTraffic}
					<TrendChart series={trafficSeries} timestamps={trafficStamps} height={240} zeroBased format={fmtRate} />
				{:else if !trafficLoaded}
					<Skeleton h="240px" />
				{:else}
					<EmptyState icon="activity" title={t('dash.traffic.empty')} hint={t('dash.traffic.emptyHint')} />
				{/if}
			</div>

			<div class="card traf-list">
				<div class="traf-tabs">
					<button class="traf-tab" class:active={trafTab === 'nodes'} onclick={() => (trafTab = 'nodes')}>
						{t('traffic.byNode')}
					</button>
					<button class="traf-tab" class:active={trafTab === 'peers'} onclick={() => (trafTab = 'peers')}>
						{t('traffic.byPeer')}
					</button>
				</div>
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
			</div>
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
		border-radius: 999px;
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
	.topo-head {
		margin-bottom: 1rem;
		align-items: flex-start;
	}
	.trend-head {
		align-items: flex-start;
	}
	.trend-head .ph-sub {
		margin: 0.15rem 0 0;
	}
	/* traffic board: left rx/tx trend (60%) + right tabbed ranking (40%) */
	.traf-2col {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.traf-2col > .card + .card {
		margin-top: 0; /* cancel global .card + .card stacking inside the flex row */
	}
	@media (min-width: 900px) {
		.traf-2col {
			flex-direction: row;
			align-items: stretch;
			/* definite height so the (possibly long) ranking list scrolls internally
			   instead of stretching both cards when switching to the peers tab */
			height: 276px;
		}
		.traf-chart {
			flex: 0 0 60%;
			min-width: 0;
		}
		.traf-list {
			flex: 0 0 calc(40% - 1rem);
			display: flex;
			flex-direction: column;
			min-height: 0;
		}
	}
	.traf-tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0.5rem;
	}
	.traf-tab {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		padding: 0.3rem 0.5rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-faint);
		cursor: pointer;
	}
	.traf-tab:hover {
		color: var(--text-dim);
	}
	.traf-tab.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
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
	.trend-now {
		display: flex;
		flex-wrap: wrap;
		gap: 1.1rem;
		font-size: 0.8rem;
		color: var(--text-dim);
	}
	.tn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.tn .ld {
		width: 16px;
		height: 3px;
		border-radius: 2px;
		display: inline-block;
	}
	.tn b {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.tn small {
		color: var(--text-faint);
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
