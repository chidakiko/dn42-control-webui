<script lang="ts">
	// Link traffic trend for a node. The server pre-computes the throughput series
	// (Δbytes / Δt from successive snapshots, counter resets clamped) and returns a
	// tiny points array — the browser no longer pulls 60 full snapshots and deltas
	// them. Feeds the shared TrendChart (the "traffic" template).
	import { api } from '$lib/api';
	import { pollEffect } from '$lib/refresh.svelte';
	import { t } from '$lib/i18n.svelte';
	import { fmtBytes } from '$lib/format';
	import TrendChart from '../charts/TrendChart.svelte';
	import ChartLegend from '../charts/ChartLegend.svelte';
	import type { TrafficPoint } from '$lib/types';

	let { nodeId }: { nodeId: string } = $props();

	let points = $state<TrafficPoint[]>([]);
	// previous-window overlay (?compare=1) — same bucket grid, align by index
	let prev = $state<TrafficPoint[]>([]);
	let loaded = $state(false);

	async function load() {
		try {
			const r = await api.nodeTraffic(nodeId, { limit: 120, compare: true });
			points = r.points;
			prev = r.points_previous ?? [];
		} catch {
			/* best-effort overview widget */
		} finally {
			loaded = true;
		}
	}
	pollEffect(
		() => load(),
		() => nodeId
	);

	let timestamps = $derived(points.map((p) => p.captured_at));
	let rxRate = $derived(points.map((p) => p.rx_bytes_per_sec));
	let txRate = $derived(points.map((p) => p.tx_bytes_per_sec));
	let hasData = $derived(points.length > 1);
	let hasPrev = $derived(prev.some((p) => p.rx_bytes_per_sec != null));
	const fmtRate = (v: number) => fmtBytes(v) + '/s';
</script>

{#if loaded && hasData}
	<div class="traffic">
		<div class="th">
			<h4>{t('traffic.title')}</h4>
			<ChartLegend
				items={[
					{ label: t('traffic.rx'), color: 'var(--c-data-1)' },
					{ label: t('traffic.tx'), color: 'var(--c-data-2)' },
					...(hasPrev ? [{ label: t('chart.prevPeriod'), color: 'var(--text-faint)', dash: true }] : [])
				]}
			/>
		</div>
		<TrendChart
			{timestamps}
			height={160}
			zeroBased
			format={fmtRate}
			series={[
				{ label: t('traffic.rx'), color: 'var(--c-data-1)', values: rxRate, fill: true },
				{ label: t('traffic.tx'), color: 'var(--c-data-2)', values: txRate },
				...(hasPrev
					? [
							{
								label: t('chart.prevPeriod'),
								color: 'var(--c-data-1)',
								dash: true,
								values: prev.map((p) => p.rx_bytes_per_sec)
							}
						]
					: [])
			]}
		/>
	</div>
{/if}

<style>
	.traffic {
		margin-bottom: 1.25rem;
	}
	.th {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 0.4rem;
	}
	.th h4 {
		margin: 0;
		font-size: 0.95rem;
	}
</style>
