<script lang="ts">
	// Thin wrapper over Bits UI's headless Dialog: keeps the project's card styling
	// and the original public API ({ title, open (bindable), onclose, children, footer }),
	// but delegates focus-trap / scroll-lock / ESC / aria to the accessible primitive
	// instead of hand-rolling them.
	//
	// `dirty`: when true, dismissal (ESC / backdrop click / ×) asks for
	// confirmation before discarding — half-filled forms can't be lost to a
	// stray keypress. Programmatic closes (open = false after a save) bypass it.
	import type { Snippet } from 'svelte';
	import { Dialog } from 'bits-ui';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n.svelte';

	let {
		title,
		open = $bindable(),
		onclose,
		dirty = false,
		children,
		footer
	}: {
		title: string;
		open: boolean;
		onclose?: () => void;
		dirty?: boolean;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	// Guarded dismissal path (ESC / backdrop / × while dirty). onclose may fire
	// twice (here + onOpenChange) — consumers' handlers are idempotent resets.
	// `confirming` blocks re-entry: clicks INSIDE the nested confirm dialog are
	// "outside" this modal's content, so onInteractOutside fires again while the
	// question is still open.
	let confirming = false;
	async function guardedClose() {
		if (confirming) return;
		if (dirty) {
			confirming = true;
			const ok = await confirmDialog({
				message: t('common.discardEdits'),
				confirmLabel: t('common.discard'),
				danger: true
			});
			confirming = false;
			if (!ok) return;
		}
		open = false;
		onclose?.();
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(v) => {
		if (!v) onclose?.();
	}}
>
	<Dialog.Overlay class="modal-backdrop" />
	<Dialog.Content
		class="modal-dialog card"
		aria-label={title}
		escapeKeydownBehavior={dirty ? 'ignore' : 'close'}
		interactOutsideBehavior={dirty ? 'ignore' : 'close'}
		onEscapeKeydown={() => {
			if (dirty) void guardedClose();
		}}
		onInteractOutside={() => {
			if (dirty) void guardedClose();
		}}
	>
		<div class="card-head">
			<Dialog.Title>
				{#snippet child({ props })}<h2 {...props}>{title}</h2>{/snippet}
			</Dialog.Title>
			<button class="btn ghost sm" aria-label="Close" onclick={guardedClose}>×</button>
		</div>
		<div class="body">
			{@render children()}
		</div>
		{#if footer}
			<div class="foot">
				{@render footer()}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	/* Bits UI keeps Overlay + Content as siblings; :global because the dialog may be
	   portaled out of this component's scope. Styling/look matches the old Modal. */
	:global(.modal-backdrop) {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 500;
	}
	:global(.modal-dialog) {
		position: fixed;
		left: 50%;
		top: 4vh;
		transform: translateX(-50%);
		width: calc(100% - 2rem);
		max-width: 640px;
		max-height: 92vh;
		overflow-y: auto;
		z-index: 501;
		box-shadow: var(--shadow-lg);
	}
	.body {
		max-height: 70vh;
		overflow-y: auto;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
</style>
