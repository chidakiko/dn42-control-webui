<script module lang="ts">
	import type { IconName } from './Icon.svelte';

	export interface RowAction {
		label: string;
		icon?: IconName;
		danger?: boolean;
		disabled?: boolean;
		onselect: () => void;
	}
</script>

<script lang="ts">
	// Row-level "⋯" action menu (contract 3 of docs/ui-interaction-proposal.md):
	// collapses per-row edit/delete/etc. into one consistent affordance instead
	// of a row of ad-hoc buttons. Keyboard-navigable via Bits UI DropdownMenu.
	import { DropdownMenu } from 'bits-ui';
	import Icon from './Icon.svelte';
	import { t } from '$lib/i18n.svelte';

	let { actions, ariaLabel }: { actions: RowAction[]; ariaLabel?: string } = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger class="rowmenu-trigger" aria-label={ariaLabel ?? t('common.actions')}>
		<Icon name="more" size={16} />
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content class="rowmenu-content" sideOffset={4} align="end">
			{#each actions as a (a.label)}
				<DropdownMenu.Item
					class="rowmenu-item {a.danger ? 'danger' : ''}"
					disabled={a.disabled}
					onSelect={() => a.onselect()}
				>
					{#if a.icon}<Icon name={a.icon} size={14} />{/if}<span>{a.label}</span>
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
	:global(.rowmenu-trigger) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		color: var(--text-dim);
		cursor: pointer;
	}
	:global(.rowmenu-trigger:hover),
	:global(.rowmenu-trigger[data-state='open']) {
		background: var(--bg-elev-2);
		border-color: var(--border);
		color: var(--text);
	}
	:global(.rowmenu-content) {
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow);
		padding: 0.25rem;
		z-index: 700;
		min-width: 9rem;
	}
	:global(.rowmenu-item) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.55rem;
		border-radius: var(--radius-sm);
		font-size: 0.85rem;
		color: var(--text-dim);
		cursor: pointer;
		user-select: none;
	}
	:global(.rowmenu-item[data-highlighted]) {
		background: var(--bg-elev-2);
		color: var(--text);
	}
	:global(.rowmenu-item.danger) {
		color: var(--bad);
	}
	:global(.rowmenu-item.danger[data-highlighted]) {
		background: var(--bad-bg);
		color: var(--bad);
	}
	:global(.rowmenu-item[data-disabled]) {
		opacity: 0.45;
		pointer-events: none;
	}
</style>
