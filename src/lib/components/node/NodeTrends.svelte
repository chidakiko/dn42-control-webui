<script lang="ts">
	// Radar-style mini stat cards for a node's overview: current drift (with
	// trend + delta vs the previous report) and apply success rate, each with a
	// sparkline. Series come pre-distilled from /ui/nodes/{id}/trends (one fetch
	// in the parent page, shared with NodeSelfMetrics), already chronological.
	import { t } from '$lib/i18n.svelte';
	import Sparkline from '../charts/Sparkline.svelte';
	import HealthBadge from '../HealthBadge.svelte';
	import Skeleton from '../Skeleton.svelte';
	import { fade } from 'svelte/transition';
	import type { NodeTrendsOut } from '$lib/types';

	let { trends }: { trends: NodeTrendsOut | null } = $props();

	let loaded = $derived(trends !== null);

	let driftSeries = $derived(trends?.drift.series.map((p) => p.count) ?? []);
	let curDrift = $derived(trends?.drift.current ?? 0);
	let prevDrift = $derived(driftSeries.length > 1 ? driftSeries[driftSeries.length - 2] : curDrift);
	let driftDelta = $derived(curDrift - prevDrift);

	let applySeries = $derived(
		trends?.apply.series.map((p) => (p.status === 'succeeded' ? 1 : 0)) ?? []
	);
	let succ = $derived(trends?.apply.succeeded ?? 0);
	let applyTotal = $derived(trends?.apply.total ?? 0);
	let rate = $derived(applyTotal ? Math.round((succ / applyTotal) * 100) : 0);
	let lastApply = $derived(trends?.apply.last_status ?? null);

	let hasData = $derived(driftSeries.length > 0 || applyTotal > 0);
</script>

{#if !loaded}
	<div class="trends">
		{#each Array(3) as _, i (i)}
			<div class="mini">
				<Skeleton w="3rem" h="0.66rem" />
				<Skeleton w="3.5rem" h="1.5rem" />
				{#if i < 2}<Skeleton h="30px" />{/if}
			</div>
		{/each}
	</div>
{:else if hasData}
	<div class="trends" in:fade={{ duration: 150 }}>
		<div class="mini">
			<span class="lbl">{t('trends.drift')}</span>
			<div class="row1">
				<span class="val">{curDrift}</span>
				{#if driftDelta !== 0}
					<span class="delta {driftDelta > 0 ? 'bad' : 'good'}">
						{driftDelta > 0 ? '▲' : '▼'}{Math.abs(driftDelta)}
					</span>
				{/if}
			</div>
			{#if driftSeries.length > 1}
				<Sparkline
					values={driftSeries}
					width={150}
					height={30}
					color={curDrift > 0 ? 'var(--c-bad)' : 'var(--c-ok)'}
				/>
			{/if}
		</div>

		<div class="mini">
			<span class="lbl">{t('trends.applyRate')}</span>
			<div class="row1">
				<span class="val">{rate}<span class="pct">%</span></span>
				<span class="sub faint">{succ}/{applyTotal}</span>
			</div>
			{#if applySeries.length > 1}
				<Sparkline values={applySeries} width={150} height={30} color="var(--c-ok)" />
			{/if}
		</div>

		<div class="mini">
			<span class="lbl">{t('trends.lastApply')}</span>
			<div class="row1">
				<HealthBadge value={lastApply} />
			</div>
		</div>
	</div>
{/if}

<style>
	.trends {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 1rem;
		margin-bottom: 1.25rem;
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
	.pct {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-dim);
	}
	.delta {
		font-size: 0.8rem;
		font-weight: 600;
	}
	.delta.bad {
		color: var(--bad);
	}
	.delta.good {
		color: var(--ok);
	}
	.sub {
		font-size: 0.85rem;
	}
</style>
