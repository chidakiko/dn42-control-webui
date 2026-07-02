<script lang="ts">
	// Radar-style proportion bar: a header row of legend-dot + label columns with
	// big bold percentages, over a single segmented bar (2px gaps, 2px radius —
	// parameters lifted from Radar's StackedBar source). Pure CSS, no Chart.js.
	// Shares < 0.1% render as "< 0.1%" and keep a sliver-width segment.
	interface Segment {
		label: string;
		value: number;
		color: string;
	}
	let {
		segments,
		height = 14,
		showHeader = true,
		format = (v: number) => v.toLocaleString()
	}: {
		segments: Segment[];
		height?: number;
		/** legend + percentage row above the bar */
		showHeader?: boolean;
		/** absolute-value formatter for tooltips */
		format?: (v: number) => string;
	} = $props();

	let total = $derived(segments.reduce((s, x) => s + Math.max(0, x.value), 0));
	let shown = $derived(segments.filter((s) => s.value > 0));

	function pctOf(v: number): number {
		return total > 0 ? (v / total) * 100 : 0;
	}
	function pctLabel(v: number): string {
		const p = pctOf(v);
		if (p > 0 && p < 0.1) return '< 0.1%';
		return `${parseFloat(p.toFixed(1))}%`;
	}
</script>

{#if total > 0}
	<div class="sharebar">
		{#if showHeader}
			<div class="head">
				{#each segments as s (s.label)}
					<span class="col">
						<span class="lbl"><i style="background:{s.color}"></i>{s.label}</span>
						<span class="pct">{pctLabel(s.value)}</span>
					</span>
				{/each}
			</div>
		{/if}
		<div class="bar" style="height:{height}px" role="img" aria-label={segments.map((s) => `${s.label} ${pctLabel(s.value)}`).join(', ')}>
			{#each shown as s (s.label)}
				<span
					class="seg"
					style="flex-basis:{pctOf(s.value)}%; background:{s.color}"
					title="{s.label}: {format(s.value)} ({pctLabel(s.value)})"
				></span>
			{/each}
		</div>
	</div>
{/if}

<style>
	.sharebar {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.head {
		display: flex;
		gap: 1.4rem;
		flex-wrap: wrap;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.lbl {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.76rem;
		color: var(--text-dim);
		white-space: nowrap;
	}
	.lbl i {
		width: 9px;
		height: 9px;
		border-radius: 2px;
		flex: 0 0 auto;
	}
	.pct {
		font-size: 1.15rem;
		font-weight: 700;
		line-height: 1.15;
		font-variant-numeric: tabular-nums;
	}
	.bar {
		display: flex;
		gap: 2px;
		width: 100%;
	}
	.seg {
		border-radius: 2px;
		min-width: 2px;
		flex-grow: 0;
		flex-shrink: 1;
		transition: opacity 0.15s;
	}
	/* Radar hover interplay: dim the segments you're NOT pointing at */
	.bar:hover .seg:not(:hover) {
		opacity: 0.7;
	}
</style>
