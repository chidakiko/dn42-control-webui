<script lang="ts">
	// Radar-style compact HTML legend for charts: dot swatch for solid series,
	// a short dashed-line swatch for comparison series, optional bold value per
	// item. Rendered in HTML (not by Chart.js) so typography/spacing match the
	// design system. `column` stacks items vertically (donut side-legends).
	interface LegendItem {
		label: string;
		color: string;
		/** comparison series — dashed-line swatch instead of a dot */
		dash?: boolean;
		/** line series — solid line swatch (Radar's 22×6 marker) instead of a dot */
		line?: boolean;
		/** optional bold value rendered after the label */
		value?: string | number;
	}
	let { items, column = false }: { items: LegendItem[]; column?: boolean } = $props();
</script>

<div class="chart-legend" class:column>
	{#each items as it (it.label)}
		<span class="li">
			{#if it.dash}
				<span class="sw dash" style="border-color:{it.color}"></span>
			{:else if it.line}
				<span class="sw line" style="background:{it.color}"></span>
			{:else}
				<span class="sw dot" style="background:{it.color}"></span>
			{/if}
			{it.label}
			{#if it.value !== undefined}<b>{it.value}</b>{/if}
		</span>
	{/each}
</div>

<style>
	.chart-legend {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.85rem;
		font-size: 0.78rem;
		color: var(--text-dim);
	}
	.chart-legend.column {
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
		font-size: 0.74rem;
	}
	.li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
	}
	.li b {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.sw {
		flex: 0 0 auto;
	}
	.sw.dot {
		width: 9px;
		height: 9px;
		border-radius: 2px;
	}
	.sw.dash {
		width: 14px;
		height: 0;
		border-top: 2px dashed currentColor;
	}
	.sw.line {
		width: 20px;
		height: 5px;
		border-radius: 999px;
	}
</style>
