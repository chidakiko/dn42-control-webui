<script lang="ts">
	// Donut / half-gauge, backed by Chart.js doughnut. Same API as before; segment
	// hover highlights and shows its value in the centre. Centre text is an HTML
	// overlay (Chart.js has no native centre label).
	import ChartCanvas from './ChartCanvas.svelte';
	import { chartTheme, resolveColor, tooltipStyle } from './chartjs';
	import type { ChartConfiguration } from 'chart.js';

	interface Seg {
		label: string;
		value: number;
		color: string;
	}
	let {
		segments,
		size = 150,
		thickness = 20,
		centerValue = '',
		centerLabel = '',
		half = false
	}: {
		segments: Seg[];
		size?: number;
		thickness?: number;
		centerValue?: string | number;
		centerLabel?: string;
		half?: boolean;
	} = $props();

	let hover = $state<number | null>(null);
	let total = $derived(segments.reduce((s, x) => s + x.value, 0));

	let center = $derived(
		hover != null && segments[hover]
			? { value: segments[hover].value as string | number, label: segments[hover].label }
			: { value: centerValue, label: centerLabel }
	);

	// Gauge cropping: Chart.js CENTERS a 180° arc vertically in the square canvas
	// (getRatioAndOffset) — the semicircle's top edge sits at size/4 and its
	// equator at 3·size/4, NOT at 0…size/2. Lift the canvas by size/4 so the crop
	// window shows exactly the full semicircle (cropping 0…size/2 instead shows
	// only the upper band of the arch — a thin floating arc).
	let boxH = $derived(half ? Math.round(size / 2 + 4) : size);
	let liftY = $derived(half ? Math.round(size / 4) - 2 : 0);
	let cutout = $derived(`${Math.round((1 - thickness / (size / 2)) * 100)}%`);

	let config = $derived.by((): ChartConfiguration<'doughnut'> => {
		const th = chartTheme();
		return {
			type: 'doughnut',
			data: {
				labels: segments.map((s) => s.label),
				datasets: [
					{
						data: segments.map((s) => s.value),
						backgroundColor: segments.map((s) => resolveColor(s.color)),
						borderWidth: 0,
						spacing: total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 2 : 0,
						hoverOffset: 4
					}
				]
			},
			options: {
				responsive: false,
				maintainAspectRatio: false,
				animation: false,
				cutout,
				rotation: half ? -90 : 0,
				circumference: half ? 180 : 360,
				onHover: (_e, els) => {
					hover = els.length ? els[0].index : null;
				},
				plugins: {
					legend: { display: false },
					tooltip: { ...tooltipStyle(th), displayColors: true }
				}
			}
		};
	});
</script>

<div class="donut" style:width="{size}px" style:height="{boxH}px">
	<div class="lift" style:margin-top="-{liftY}px">
		<ChartCanvas {config} width={size} height={size} fixed label="donut chart" />
	</div>
	{#if !half && (center.value !== '' || center.label !== '')}
		<div class="center" style:height="{size}px">
			{#if center.value !== ''}
				<span class="cv">{center.value}</span>
				<span class="cl">{center.label}</span>
			{:else}
				<span class="cl cl-only">{center.label}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.donut {
		position: relative;
		overflow: hidden;
	}
	.center {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1rem;
		pointer-events: none;
	}
	.cv {
		color: var(--text);
		font-size: 1.6rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.cl {
		color: var(--text-faint);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.cl-only {
		color: var(--text-dim);
		font-size: 0.82rem;
		text-transform: none;
		letter-spacing: 0;
	}
</style>
