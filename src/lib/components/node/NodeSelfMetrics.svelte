<script lang="ts">
	// Mini stat cards for an agent's *self*-observation: process CPU%, RSS, and the
	// duration of its background loops (routing collection / WG reresolve), plus
	// reconcile failure counts. Series come pre-distilled from /ui/nodes/{id}/trends
	// (one fetch in the parent page, shared with NodeTrends), already chronological.
	// Renders nothing when the agent doesn't report self-metrics (old agent).
	import { t } from '$lib/i18n.svelte';
	import Sparkline from '../charts/Sparkline.svelte';
	import Skeleton from '../Skeleton.svelte';
	import { fade } from 'svelte/transition';
	import type { AgentSelfMetrics, NodeTrendsOut } from '$lib/types';

	// `current` may be piped from the parent's /overview fetch (freshest value);
	// otherwise the trends payload's own current is used.
	let {
		trends,
		current: pipedCurrent
	}: { trends: NodeTrendsOut | null; current?: AgentSelfMetrics | null } = $props();

	let loaded = $derived(trends !== null);
	let current = $derived(
		pipedCurrent !== undefined ? pipedCurrent : (trends?.self_metrics.current ?? null)
	);

	let series = $derived(trends?.self_metrics.series ?? []);
	let cpuSeries = $derived(series.map((m) => m.cpu_percent ?? 0));
	let rssSeries = $derived(series.map((m) => m.rss_mb ?? 0));
	let routingSeries = $derived(series.map((m) => m.last_routing_collect_seconds ?? 0));

	const fmt = (v: number | null | undefined, digits = 0): string =>
		v === null || v === undefined ? '—' : v.toFixed(digits);

	let hasData = $derived(current !== null);
	let cpuHigh = $derived((current?.cpu_percent ?? 0) >= 80);
</script>

{#if !loaded}
	<div class="self">
		<span class="title">{t('selfmetrics.title')}</span>
		<div class="cards">
			{#each Array(5) as _, i (i)}
				<div class="mini">
					<Skeleton w="3rem" h="0.66rem" />
					<Skeleton w="4.5rem" h="1.5rem" />
					<Skeleton h="30px" />
				</div>
			{/each}
		</div>
	</div>
{:else if hasData && current}
	<div class="self" in:fade={{ duration: 150 }}>
		<span class="title">{t('selfmetrics.title')}</span>
		<div class="cards">
			<div class="mini">
				<span class="lbl">{t('selfmetrics.cpu')}</span>
				<div class="row1">
					<span class="val" class:bad={cpuHigh}>{fmt(current.cpu_percent)}<span class="pct">%</span></span>
				</div>
				{#if cpuSeries.length > 1}
					<Sparkline values={cpuSeries} width={150} height={30} color={cpuHigh ? 'var(--c-bad)' : 'var(--c-ok)'} interactive format={(v) => v + '%'} />
				{/if}
			</div>

			{#if current.rss_mb !== null}
				<div class="mini">
					<span class="lbl">{t('selfmetrics.rss')}</span>
					<div class="row1">
						<span class="val">{fmt(current.rss_mb)}<span class="pct">MB</span></span>
					</div>
					{#if rssSeries.length > 1}
						<Sparkline values={rssSeries} width={150} height={30} color="var(--c-data-1)" interactive format={(v) => v + ' MB'} />
					{/if}
				</div>
			{/if}

			{#if current.last_routing_collect_seconds !== null}
				<div class="mini">
					<span class="lbl">{t('selfmetrics.routing')}</span>
					<div class="row1">
						<span class="val">{fmt(current.last_routing_collect_seconds, 2)}<span class="pct">s</span></span>
					</div>
					{#if routingSeries.length > 1}
						<Sparkline values={routingSeries} width={150} height={30} color="var(--c-data-1)" interactive format={(v) => v + ' s'} />
					{/if}
				</div>
			{/if}

			{#if current.last_reresolve_seconds !== null}
				<div class="mini">
					<span class="lbl">{t('selfmetrics.reresolve')}</span>
					<div class="row1">
						<span class="val">{fmt(current.last_reresolve_seconds, 2)}<span class="pct">s</span></span>
					</div>
				</div>
			{/if}

			{#if current.consecutive_failures !== null}
				<div class="mini">
					<span class="lbl">{t('selfmetrics.failures')}</span>
					<div class="row1">
						<span class="val" class:bad={(current.consecutive_failures ?? 0) > 0}>
							{fmt(current.consecutive_failures)}
						</span>
						{#if current.total_failures !== null}
							<span class="sub faint">/ {fmt(current.total_failures)} total</span>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.self {
		margin-bottom: 1.25rem;
	}
	.title {
		display: block;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
		margin-bottom: 0.6rem;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 1rem;
	}
	.mini {
		background: var(--bg-elev-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.7rem 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.lbl {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
	}
	.row1 {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.val {
		font-size: 1.7rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.val.bad {
		color: var(--bad);
	}
	.pct {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-dim);
		margin-left: 0.15rem;
	}
	.sub {
		font-size: 0.85rem;
	}
</style>
