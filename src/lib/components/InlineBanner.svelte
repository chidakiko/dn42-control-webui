<script lang="ts">
	// "Refresh failed — showing last known data" strip. Rendered above content
	// that keep-last-good deliberately leaves on screen when a background poll
	// fails, instead of replacing the whole table/dashboard with an error card.
	import Icon from './Icon.svelte';
	import { t } from '$lib/i18n.svelte';

	let { detail = '' }: { detail?: string } = $props();
</script>

<div class="banner" role="alert">
	<Icon name="alert-triangle" size={14} />
	<span class="msg">{t('common.staleData')}</span>
	{#if detail}<span class="detail" title={detail}>{detail}</span>{/if}
</div>

<style>
	.banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		margin-bottom: 0.75rem;
		border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--border));
		background: var(--warn-bg);
		border-radius: var(--radius-sm);
		color: var(--warn);
		font-size: 0.8rem;
	}
	.msg {
		flex: none;
		font-weight: 550;
	}
	.detail {
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
</style>
