<script lang="ts">
	// Radar widget card — the ONE anatomy every dashboard block uses:
	//   ┌ title (+ optional ↗ deep link)        [controls] ┐
	//   │ description                                       │
	//   │ …content…                                         │
	//   └ updated-at stamp (optional)                       ┘
	// Title/description/controls/asof placement is fixed here so pages stop
	// hand-rolling their own header rows.
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	let {
		title,
		sub = '',
		icon,
		href = '',
		asof = '',
		cls = '',
		controls,
		children
	}: {
		title: string;
		/** one-line gray description under the title */
		sub?: string;
		icon?: IconName;
		/** deep link — renders Radar's orange ↗ jump arrow after the title */
		href?: string;
		/** "updated …" stamp rendered bottom-left */
		asof?: string;
		/** extra class(es) on the card for page-level sizing */
		cls?: string;
		/** top-right control cluster (seg switches, selects, buttons) */
		controls?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="card widget {cls}">
	<header class="w-head">
		<div class="w-titles">
			<h3 class="w-title">
				{#if icon}<span class="w-ic"><Icon name={icon} size={16} /></span>{/if}
				{title}
				{#if href}
					<a class="w-jump" {href} aria-label={title}><Icon name="arrow-up-right" size={14} /></a>
				{/if}
			</h3>
			{#if sub}<p class="w-sub">{sub}</p>{/if}
		</div>
		{#if controls}
			<div class="w-controls">{@render controls()}</div>
		{/if}
	</header>

	<div class="w-body">
		{@render children()}
	</div>

	{#if asof}
		<div class="card-asof">{asof}</div>
	{/if}
</section>

<style>
	.widget {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/* header row calibrated to Radar's widget-header-group: space-between,
	   wrap, 1rem column gap; title 1.25rem with 0.25rem gap to description */
	.w-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		column-gap: 1rem;
		row-gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.w-titles {
		min-width: 0;
	}
	.w-title {
		margin: 0;
		font-size: 1.25rem;
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.w-ic {
		display: inline-flex;
		color: var(--accent);
	}
	.w-jump {
		display: inline-flex;
		align-items: center;
		color: var(--accent);
		border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
		border-radius: 3px;
		padding: 1px;
	}
	.w-jump:hover {
		background: var(--accent-soft);
	}
	.w-sub {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--text-dim);
	}
	.w-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: none;
	}
	.w-body {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
