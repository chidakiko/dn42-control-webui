<script lang="ts">
	// Shared Chart.js host: owns the <canvas> and one chart instance per canvas.
	// Parents pass a $derived config (built via chartTheme(), which tracks the theme),
	// so data/format/theme changes all arrive as a new config — applied in place via
	// chart.update() rather than a destroy+recreate.
	import { untrack } from 'svelte';
	import { ensureChart, Chart } from './chartjs';
	import type { ChartConfiguration, Chart as ChartType, Plugin } from 'chart.js';

	let {
		config,
		height,
		width,
		fixed = false,
		label = 'chart',
		plugins = []
	}: {
		// `any` type param so typed configs (e.g. ChartConfiguration<'doughnut'>)
		// are accepted without casting through unknown.
		config: ChartConfiguration<any>;
		height?: number;
		width?: number;
		/** fixed-size canvas (sparkline/minibar) vs responsive-to-container (line/bar/donut) */
		fixed?: boolean;
		label?: string;
		/** chart-local plugins (must be static for the component's lifetime) */
		plugins?: Plugin[];
	} = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let chart = $state.raw<ChartType | null>(null);

	// Create once per canvas element; destroyed on unmount.
	$effect(() => {
		if (!canvas) return;
		ensureChart();
		chart = new Chart(canvas, { ...untrack(() => config), plugins });
		return () => {
			chart?.destroy();
			chart = null;
		};
	});

	// Data / options / theme changes mutate the live chart in place.
	$effect(() => {
		const c = config;
		if (!chart) return;
		chart.data = c.data;
		chart.options = c.options ?? {};
		chart.update('none');
	});
</script>

{#if fixed}
	<canvas bind:this={canvas} {width} {height} aria-label={label}></canvas>
{:else}
	<div class="cc" style:height={height ? `${height}px` : undefined}>
		<canvas bind:this={canvas} aria-label={label}></canvas>
	</div>
{/if}

<style>
	.cc {
		position: relative;
		width: 100%;
	}
	canvas {
		display: block;
	}
</style>
