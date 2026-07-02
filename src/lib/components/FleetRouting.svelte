<script lang="ts">
	// Fleet-wide routing overview. Because iBGP converges every node onto ~the same
	// RIB, plotting per-node route counts is redundant (overlapping lines). Instead:
	//   left  — the fleet route-table SIZE trend (one line; nodes are converged so the
	//           median represents the fleet) + route CHANGE (churn: announced/withdrawn).
	//   right — a node list surfacing what actually differs per node: convergence status
	//           (does its count match the fleet? a lagging node = iBGP/convergence issue)
	//           and RPKI-invalid counts (differ by each node's external peers).
	// Purely presentational: the routing block rides in the parent's /ui/dashboard
	// fetch and is piped in via the `data` prop (null until the first load).
	import type { FleetRoutingOverview } from '$lib/types';
	import { fmtTime, fmtNum as fmt, fmtCompact as compact } from '$lib/format';
	import TrendChart from '$lib/components/charts/TrendChart.svelte';
	import Donut from '$lib/components/charts/Donut.svelte';
	import ChartLegend from '$lib/components/charts/ChartLegend.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Widget from '$lib/components/Widget.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { t } from '$lib/i18n.svelte';

	let { data = null, asof = '' }: { data?: FleetRoutingOverview | null; asof?: string } = $props();
	let loading = $derived(data === null);

	// Routing cards stamp the newest ROUTING SNAPSHOT time (collection lags by
	// minutes), not the dashboard aggregation time — fall back to the parent's
	// generated_at label when no node has reported yet.
	let routingAsof = $derived(
		data?.captured_at ? `${t('common.updatedAt')} ${fmtTime(data.captured_at)}` : asof
	);

	// address-family split is quantity data, not status → data palette
	const V4_COLOR = 'var(--c-data-1)';
	const V6_COLOR = 'var(--c-data-2)';

	// dp: decimal places — invalid share is tiny, so it gets 2 decimals below.
	const pct = (v: number, tot: number, dp = 0) => (tot > 0 ? +((v / tot) * 100).toFixed(dp) : 0);
	function median(a: number[]): number {
		if (!a.length) return 0;
		const s = [...a].sort((x, y) => x - y);
		const m = Math.floor(s.length / 2);
		return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
	}

	let rpkiTotal = $derived(
		data ? data.summary.rpki.valid + data.summary.rpki.invalid + data.summary.rpki.not_found : 0
	);
	let invalidTotal = $derived(data ? data.summary.rpki.invalid : 0);
	// fleet RPKI-invalid routes that leaked into the accepted RIB (expandable detail)
	let invalidRoutes = $derived(data?.invalid_routes ?? []);
	let showInvalid = $state(false);

	// fleet address-family split (IPv4 / IPv6 share bar)
	let famTotal = $derived(data ? data.summary.route_count_v4 + data.summary.route_count_v6 : 0);
	let familySegments = $derived(
		data
			? [
					{ label: t('routing.v4'), value: data.summary.route_count_v4, color: V4_COLOR },
					{ label: t('routing.v6'), value: data.summary.route_count_v6, color: V6_COLOR }
				]
			: []
	);

	// fleet RPKI distribution gauge — Radar colours this with the categorical
	// palette (blue/cyan/orange), treating it as data; alert semantics (red)
	// stay on the invalid-routes banner below.
	let rpkiSegments = $derived(
		data
			? [
					{ label: t('routing.rpki.valid'), value: data.summary.rpki.valid, color: 'var(--c-data-1)' },
					{ label: t('routing.rpki.not_found'), value: data.summary.rpki.not_found, color: 'var(--c-data-2)' },
					{ label: t('routing.rpki.invalid'), value: data.summary.rpki.invalid, color: 'var(--c-data-3)' }
				]
			: []
	);

	// per-node RPKI composition (this is what genuinely differs node-to-node — each
	// node's external peers send different valid/not-found/invalid mixes).
	function rpki(n: { rpki: { valid: number; invalid: number; not_found: number } }) {
		const tot = n.rpki.valid + n.rpki.not_found + n.rpki.invalid;
		return {
			tot,
			validPct: pct(n.rpki.valid, tot),
			vw: tot ? (n.rpki.valid / tot) * 100 : 0,
			nw: tot ? (n.rpki.not_found / tot) * 100 : 0,
			iw: tot ? (n.rpki.invalid / tot) * 100 : 0
		};
	}

	// --- fleet trend (size + churn): server-aggregated 5-min buckets from the BFF ---
	let fleetTrend = $derived.by(() => {
		const tr = data?.trend ?? [];
		return {
			stamps: tr.map((p) => p.captured_at ?? ''),
			size: tr.map((p) => p.size)
		};
	});
	let hasTrend = $derived(fleetTrend.size.length > 1);

	// Radar "announced IP address space" composition: per-family step charts with
	// a 两者/IPv4/IPv6 segmented switch and a min-max y-scale toggle. The trend
	// carries real per-family sizes (size_v4/size_v6; `size` stays = total).
	let sizeV4 = $derived((data?.trend ?? []).map((p) => p.size_v4));
	let sizeV6 = $derived((data?.trend ?? []).map((p) => p.size_v6));
	let famView = $state<'both' | '4' | '6'>('both');
	// Radar defaults the min/max toggle ON: y-axis hugs the data range so small
	// route-count movements stay visible; off = zero-based.
	let minMax = $state(true);

	// --- per-node convergence: a node whose count lags the fleet median = problem ---
	let fleetMedian = $derived(data ? median(data.nodes.map((n) => n.route_count)) : 0);
	function behind(n: { route_count: number }): number {
		return fleetMedian - n.route_count;
	}
	function diverged(n: { route_count: number }): boolean {
		return fleetMedian > 0 && Math.abs(behind(n)) > Math.max(20, fleetMedian * 0.02);
	}
	let divergedNodes = $derived(data ? data.nodes.filter(diverged) : []);

	// --- fleet RIB top origin-AS table (the dimension that actually varies row-to-row;
	// per-node route counts are identical once iBGP converges) ---
	let origins = $derived(data?.origins ?? []);

	// Radar Top-N table: client-side ASN search + sort-metric seg + pagination.
	// The sort reorders the fetched top-100 window (server-sorted by total count)
	// — exact enough at DN42 scale without refetching the whole dashboard.
	const ORIGINS_PAGE = 20;
	let orgQuery = $state('');
	let orgPage = $state(0);
	let orgSort = $state<'count' | 'v4' | 'v6'>('count');
	const orgMetric = (o: { count: number; count_v4: number; count_v6: number }) =>
		orgSort === 'v4' ? o.count_v4 : orgSort === 'v6' ? o.count_v6 : o.count;
	let orgQ = $derived(orgQuery.trim().toLowerCase().replace(/^as/, ''));
	let orgFiltered = $derived.by(() => {
		const rows = orgQ ? origins.filter((o) => String(o.asn).includes(orgQ)) : origins;
		return orgSort === 'count' ? rows : [...rows].sort((a, b) => orgMetric(b) - orgMetric(a));
	});
	let maxOrigin = $derived(orgFiltered.length ? orgMetric(orgFiltered[0]) : 0);
	let orgPages = $derived(Math.max(1, Math.ceil(orgFiltered.length / ORIGINS_PAGE)));
	let orgSafePage = $derived(Math.min(orgPage, orgPages - 1));
	let orgRows = $derived(
		orgFiltered.slice(orgSafePage * ORIGINS_PAGE, orgSafePage * ORIGINS_PAGE + ORIGINS_PAGE)
	);
	$effect(() => {
		orgQuery; // typing a new search / changing the metric resets to page 1
		orgSort;
		orgPage = 0;
	});
</script>

<!-- Widget header is static and always rendered; only data slots skeletonize so
     the section frame never shifts on load. -->
<Widget title={t('dash.routing.title')} sub={t('dash.routing.subtitle')} asof={routingAsof}>
	{#snippet controls()}
		{#if data}<span class="card-sub">{t('dash.routing.reporting', data.summary.nodes_reporting)}</span>
		{:else if loading}<Skeleton w="84px" h="0.9rem" />{/if}
	{/snippet}
	{#if loading && !data}
		<div class="head-flex">
			<ul class="stat-cells">
				{#each Array(5) as _, i (i)}
					<li>
						<Skeleton w="44px" h="0.7rem" />
						<Skeleton w="58px" h="1.3rem" />
						<Skeleton w="70px" h="0.7rem" />
					</li>
				{/each}
			</ul>
			<div class="gauges">
				{#each Array(2) as _, i (i)}
					<div class="gauge">
						<Skeleton w="72px" h="1.9rem" />
						<Skeleton w="190px" h="98px" />
						<Skeleton w="72px" h="1.9rem" />
					</div>
				{/each}
			</div>
		</div>
	{:else if data && data.summary.nodes_reporting === 0}
		<div class="empty">{t('dash.routing.empty')}</div>
	{:else if data}
		<div class="head-flex">
			<!-- Radar routing-stats cells: bordered grid, centered content — small
			     label / compact primary / (share%) / per-family breakdown rows -->
			<ul class="stat-cells">
				<li>
					<span class="sc-lbl">AS</span>
					<span class="sc-val">{compact(data.summary.as_count)}</span>
					<dl class="sc-other">
						<div class="g"><dt>IPv4:</dt><dd>{fmt(data.summary.as_count_v4)}</dd></div>
						<div class="g"><dt>IPv6:</dt><dd>{fmt(data.summary.as_count_v6)}</dd></div>
					</dl>
				</li>
				<li>
					<span class="sc-lbl">{t('routing.total')}</span>
					<span class="sc-val">{compact(data.summary.route_count)}</span>
					<dl class="sc-other">
						<div class="g"><dt>IPv4:</dt><dd>{fmt(data.summary.route_count_v4)}</dd></div>
						<div class="g"><dt>IPv6:</dt><dd>{fmt(data.summary.route_count_v6)}</dd></div>
					</dl>
				</li>
				<li>
					<span class="sc-lbl">{t('routing.rpki.valid')}</span>
					<span class="sc-val">{compact(data.summary.rpki.valid)}</span>
					<span class="sc-pct">({pct(data.summary.rpki.valid, rpkiTotal)}%)</span>
					<dl class="sc-other">
						<div class="g"><dt>IPv4:</dt><dd>{fmt(data.summary.rpki_v4.valid)}</dd></div>
						<div class="g"><dt>IPv6:</dt><dd>{fmt(data.summary.rpki_v6.valid)}</dd></div>
					</dl>
				</li>
				<li>
					<span class="sc-lbl">{t('routing.rpki.invalid')}</span>
					<span class="sc-val">{compact(data.summary.rpki.invalid)}</span>
					<span class="sc-pct">({pct(data.summary.rpki.invalid, rpkiTotal, 2)}%)</span>
					<dl class="sc-other">
						<div class="g"><dt>IPv4:</dt><dd>{fmt(data.summary.rpki_v4.invalid)}</dd></div>
						<div class="g"><dt>IPv6:</dt><dd>{fmt(data.summary.rpki_v6.invalid)}</dd></div>
					</dl>
				</li>
				<li>
					<span class="sc-lbl">{t('routing.rpki.not_found')}</span>
					<span class="sc-val">{compact(data.summary.rpki.not_found)}</span>
					<span class="sc-pct">({pct(data.summary.rpki.not_found, rpkiTotal)}%)</span>
					<dl class="sc-other">
						<div class="g"><dt>IPv4:</dt><dd>{fmt(data.summary.rpki_v4.not_found)}</dd></div>
						<div class="g"><dt>IPv6:</dt><dd>{fmt(data.summary.rpki_v6.not_found)}</dd></div>
					</dl>
				</li>
			</ul>
		<!-- Radar routing-stats gauges: half-donut with the dominant share labelled
		     above and its counterpart below (RPKI valid/unknown · IPv4/IPv6) -->
		<div class="gauges">
			{#if rpkiTotal > 0}
				<div class="gauge">
					<div class="g-pair">
						<span class="g-lbl"><i style="background:var(--c-data-1)"></i>{t('routing.rpki.valid')}</span>
						<b class="g-val">{pct(data.summary.rpki.valid, rpkiTotal)}%</b>
					</div>
					<Donut half segments={rpkiSegments} size={190} thickness={28} />
					<div class="g-pair">
						<span class="g-lbl"><i style="background:var(--c-data-2)"></i>{t('routing.rpki.not_found')}</span>
						<b class="g-val">{pct(data.summary.rpki.not_found, rpkiTotal)}%</b>
					</div>
				</div>
			{/if}
			{#if famTotal > 0}
				<div class="gauge">
					<div class="g-pair">
						<span class="g-lbl"><i style="background:{V4_COLOR}"></i>{t('routing.v4')}</span>
						<b class="g-val">{pct(data.summary.route_count_v4, famTotal)}%</b>
					</div>
					<Donut half segments={familySegments} size={190} thickness={28} />
					<div class="g-pair">
						<span class="g-lbl"><i style="background:{V6_COLOR}"></i>{t('routing.v6')}</span>
						<b class="g-val">{pct(data.summary.route_count_v6, famTotal)}%</b>
					</div>
				</div>
			{/if}
			</div>
		</div>
	{/if}
</Widget>

{#if !(data && data.summary.nodes_reporting === 0)}
	{#if divergedNodes.length > 0}
		<div class="rt-alert">
			<Icon name="alert-triangle" size={15} />
			{t('dash.routing.divergeAlert', divergedNodes.length)}
		</div>
	{/if}
	{#if invalidTotal > 0}
		<button
			class="rt-alert rt-alert-btn"
			onclick={() => (showInvalid = !showInvalid)}
			aria-expanded={showInvalid}
		>
			<Icon name="alert-triangle" size={15} />
			<span>{t('dash.routing.invalidAlert', invalidTotal)}</span>
			<span class="grow"></span>
			{#if invalidRoutes.length}
				<span class="rt-alert-toggle">
					{t('routing.invalidDetail')}
					<span class="rt-chev" class:open={showInvalid}><Icon name="chevron-down" size={14} /></span>
				</span>
			{/if}
		</button>
		{#if showInvalid && invalidRoutes.length}
			<div class="rt-invalid">
				{#each invalidRoutes as r (r.prefix + '/' + r.origin_asn)}
					<div class="rt-invalid-row">
						<span class="mono rt-inv-prefix">{r.prefix}</span>
						<span class="mono faint">{r.origin_asn ? 'AS' + r.origin_asn : '—'}</span>
						<span class="grow"></span>
						<span class="faint">{t('routing.invalidSeen', r.node_count)}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- fleet route-table size — Radar "announced IP address space" module:
	     stacked per-family step charts, 两者/IPv4/IPv6 seg, min-max scale toggle -->
	<Widget title={t('routing.sizeTrend')}>
			{#snippet controls()}
				<div class="seg">
					<button class="segbtn" class:active={famView === 'both'} onclick={() => (famView = 'both')}>{t('common.both')}</button>
					<button class="segbtn" class:active={famView === '4'} onclick={() => (famView = '4')}>{t('routing.v4')}</button>
					<button class="segbtn" class:active={famView === '6'} onclick={() => (famView = '6')}>{t('routing.v6')}</button>
				</div>
				<Toggle label={t('routing.minMaxScale')} bind:checked={minMax} />
			{/snippet}
			{#if loading && !data}
				<Skeleton h="200px" />
				<div style="margin-top:1.5rem"><Skeleton h="200px" /></div>
			{:else if hasTrend}
				{#if famView !== '6'}
					<div class="fam-chart">
						<ChartLegend items={[{ label: t('routing.v4'), color: V4_COLOR, line: true }]} />
						<TrendChart
							series={[{ label: t('routing.v4'), color: V4_COLOR, values: sizeV4, step: true }]}
							timestamps={fleetTrend.stamps}
							height={famView === 'both' ? 200 : 250}
							zeroBased={!minMax}
							format={fmt}
							tickFormat={compact}
							leftAxisWidth={48}
						/>
					</div>
				{/if}
				{#if famView !== '4'}
					<div class="fam-chart">
						<ChartLegend items={[{ label: t('routing.v6'), color: V6_COLOR, line: true }]} />
						<TrendChart
							series={[{ label: t('routing.v6'), color: V6_COLOR, values: sizeV6, step: true }]}
							timestamps={fleetTrend.stamps}
							height={famView === 'both' ? 200 : 250}
							zeroBased={!minMax}
							format={fmt}
							tickFormat={compact}
							leftAxisWidth={48}
						/>
					</div>
				{/if}
			{:else}
				<div class="empty">{t('common.loading')}</div>
			{/if}
		</Widget>

	<!-- fleet RIB top origin-AS table (per-node counts converge — origins are the
	     dimension that actually varies; counts aggregated fleet-wide, per-ASN max) -->
	<Widget title={t('routing.topOrigins')} sub={t('routing.topOriginsSub')}>
		{#snippet controls()}
			<div class="seg">
				<button class="segbtn" class:active={orgSort === 'count'} onclick={() => (orgSort = 'count')}>{t('routing.routes')}</button>
				<button class="segbtn" class:active={orgSort === 'v4'} onclick={() => (orgSort = 'v4')}>{t('routing.v4')}</button>
				<button class="segbtn" class:active={orgSort === 'v6'} onclick={() => (orgSort = 'v6')}>{t('routing.v6')}</button>
			</div>
			<input class="search org-search" placeholder={t('common.search')} bind:value={orgQuery} />
		{/snippet}
		{#if origins.length}
			<table class="org-table">
				<thead>
					<tr>
						<th class="c-rank">#</th>
						<th>ASN</th>
						<th></th>
						<th class="c-num">{t('routing.routes')}</th>
					</tr>
				</thead>
				<tbody>
					{#each orgRows as o, i (o.asn)}
						<tr>
							<td class="c-rank">{orgSafePage * ORIGINS_PAGE + i + 1}</td>
							<td class="c-asn">
								<a class="mono" href="https://explorer.burble.com/#/AS{o.asn}" target="_blank" rel="noreferrer">AS{o.asn}</a>
							</td>
							<td class="c-bar">
								<span class="org-bar"><i style="width:{maxOrigin ? (orgMetric(o) / maxOrigin) * 100 : 0}%"></i></span>
							</td>
							<td class="c-num mono">{fmt(orgMetric(o))}</td>
						</tr>
					{:else}
						<tr><td colspan="4"><div class="empty">—</div></td></tr>
					{/each}
				</tbody>
			</table>
			{#if orgPages > 1}
				<div class="org-foot">
					<button
						class="btn sm icon pg-prev"
						disabled={orgSafePage === 0}
						onclick={() => (orgPage = orgSafePage - 1)}
						aria-label="previous page"><Icon name="chevron-down" size={14} /></button>
					<span class="pg mono">{orgSafePage + 1} / {orgPages}</span>
					<button
						class="btn sm icon pg-next"
						disabled={orgSafePage >= orgPages - 1}
						onclick={() => (orgPage = orgSafePage + 1)}
						aria-label="next page"><Icon name="chevron-down" size={14} /></button>
				</div>
			{/if}
		{:else if loading && !data}
			<div class="org-sk">
				{#each Array(10) as _, i (i)}<Skeleton h="1.6rem" />{/each}
			</div>
		{:else}
			<div class="empty">{t('common.loading')}</div>
		{/if}
	</Widget>
{/if}

<style>
	.head-flex {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		flex-wrap: wrap;
	}
	/* Radar routing-stats cells: bordered grid with 1px dividers (gap trick),
	   centered content per cell */
	.stat-cells {
		list-style: none;
		margin: 0;
		padding: 0;
		flex: 1;
		min-width: 0;
		/* cap cell width so the cells don't over-stretch, but generously enough
		   that the box reaches toward the gauges on wide screens */
		max-width: 78rem;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1px;
		background: var(--border);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.stat-cells li {
		background: var(--bg-elev);
		padding: 1.15rem 1rem 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.45rem;
		min-width: 0;
	}
	.sc-lbl {
		font-size: 0.8rem;
		color: var(--text-dim);
		white-space: nowrap;
	}
	.sc-val {
		font-size: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.05;
	}
	/* share% hugs the primary number — near-white and semi-bold like Radar's "(70%)" */
	.sc-pct {
		font-size: 0.82rem;
		font-weight: 650;
		color: var(--text);
		font-variant-numeric: tabular-nums;
		margin-top: -0.25rem;
	}
	.sc-other {
		margin: 0.5rem 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.78rem;
		color: var(--text-dim);
	}
	.sc-other .g {
		display: flex;
		justify-content: center;
		gap: 0.35rem;
	}
	.sc-other dt {
		color: var(--text-faint);
	}
	.sc-other dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	.fam-chart {
		margin-bottom: 1.5rem;
	}
	/* legend starts where the plot area starts (indent = leftAxisWidth) */
	.fam-chart > :global(.chart-legend) {
		margin: 0 0 0.5rem 48px;
	}
	/* Radar half-donut blocks: label+value pairs LEFT-aligned above/below the
	   arc, 1.25rem bold values, wide spacing between the two gauges */
	.gauges {
		display: flex;
		align-items: center;
		gap: 3.5rem;
		flex-wrap: wrap;
		padding-right: 0.5rem;
	}
	.gauge {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.55rem;
		width: 190px;
	}
	.g-pair {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
	}
	.g-lbl {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--text);
		white-space: nowrap;
	}
	.g-lbl i {
		width: 9px;
		height: 9px;
		border-radius: 2px;
		flex: 0 0 auto;
	}
	.g-val {
		font-size: 1.25rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}
	/* stat/legend layout comes from the global .stat-strip + shared ChartLegend */

	.rt-alert {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 1rem;
		padding: 0.55rem 0.8rem;
		font-size: 0.82rem;
		font-weight: 500;
		color: var(--c-bad);
		background: color-mix(in srgb, var(--c-bad) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--c-bad) 30%, transparent);
		border-radius: var(--radius);
	}
	.rt-alert-btn {
		width: 100%;
		text-align: left;
		cursor: pointer;
		font: inherit;
	}
	.rt-alert .grow {
		flex: 1;
	}
	.rt-alert-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.rt-chev {
		display: inline-flex;
		transition: transform 0.15s ease;
	}
	.rt-chev.open {
		transform: rotate(180deg);
	}
	/* expandable RPKI-invalid route detail (prefix · origin AS · seen on N nodes) */
	.rt-invalid {
		margin-top: 0.4rem;
		border: 1px solid color-mix(in srgb, var(--c-bad) 22%, transparent);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.rt-invalid-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.8rem;
		font-size: 0.8rem;
		color: var(--text-dim);
		border-top: 1px solid var(--border);
	}
	.rt-invalid-row:first-child {
		border-top: none;
	}
	.rt-invalid-row .grow {
		flex: 1;
	}
	.rt-inv-prefix {
		color: var(--text);
		font-weight: 600;
	}
	/* a widget following an alert row needs the grid gap the global
	   .card + .card rule can't provide (the alert isn't a card) */
	.rt-alert + :global(.card),
	.rt-invalid + :global(.card) {
		margin-top: 1.5rem;
	}

	/* fleet RIB top origin-AS table (Radar Top-N table) */
	.org-search {
		width: 190px;
		font-size: 0.8rem;
		padding: 0.3rem 0.6rem;
	}
	.org-table .c-rank {
		width: 2.2rem;
		text-align: right;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}
	.org-table .c-asn a {
		font-weight: 600;
		font-size: 0.82rem;
	}
	.org-table .c-bar {
		width: 42%;
	}
	.org-table .c-num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	/* Radar zebra rows; hover tint comes from the global table styles */
	.org-table tbody tr:nth-child(even) {
		background: color-mix(in srgb, var(--text) 3%, transparent);
	}
	.org-bar {
		display: block;
		height: 7px;
		border-radius: 4px;
		background: var(--bg-elev-2);
		overflow: hidden;
	}
	.org-bar i {
		display: block;
		height: 100%;
		min-width: 2px;
		border-radius: 4px;
		background: var(--c-data-1);
	}
	/* pager footer: ◀ 1 / 5 ▶ */
	.org-foot {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	.org-foot .pg {
		font-size: 0.78rem;
		color: var(--text-dim);
		min-width: 3.2rem;
		text-align: center;
	}
	.pg-prev :global(svg) {
		transform: rotate(90deg);
	}
	.pg-next :global(svg) {
		transform: rotate(-90deg);
	}
	.org-sk {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
</style>
