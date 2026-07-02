<script lang="ts">
	// Global host for confirmDialog()/promptDialog() (see $lib/confirm.svelte.ts).
	// Mounted once in the layout, next to Toaster.
	import Modal from './Modal.svelte';
	import { confirmState } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n.svelte';

	let dialogOpen = $state(false);
	let note = $state('');
	let typed = $state('');

	$effect(() => {
		if (confirmState.current) {
			dialogOpen = true;
			note = '';
			typed = '';
		}
	});

	// type-to-confirm gate: the confirm button stays disabled until the operator
	// types the exact resource name (irreversible-operation guard).
	let confirmBlocked = $derived.by(() => {
		const need = confirmState.current?.opts.typeToConfirm;
		return !!need && typed.trim() !== need;
	});

	function cancel() {
		confirmState.settle(false);
		dialogOpen = false;
	}
	function ok() {
		if (confirmBlocked) return;
		confirmState.settle(true, note.trim());
		dialogOpen = false;
	}
</script>

{#if confirmState.current}
	{@const o = confirmState.current.opts}
	<Modal title={o.title ?? t('confirm.title')} bind:open={dialogOpen} onclose={cancel}>
		<p class="msg">{o.message}</p>
		{#if o.withNote}
			<label class="field">
				{#if o.noteLabel}<span>{o.noteLabel}</span>{/if}
				<!-- svelte-ignore a11y_autofocus — the dialog exists to collect this input -->
				<textarea bind:value={note} rows="3" autofocus></textarea>
			</label>
		{/if}
		{#if o.typeToConfirm}
			<label class="field">
				<span>{t('confirm.typeToConfirm', o.typeToConfirm)}</span>
				<!-- svelte-ignore a11y_autofocus — the dialog exists to collect this input -->
				<input
					class="mono"
					bind:value={typed}
					placeholder={o.typeToConfirm}
					autocomplete="off"
					spellcheck="false"
					autofocus
					onkeydown={(e) => {
						if (e.key === 'Enter') ok();
					}}
				/>
			</label>
		{/if}
		{#snippet footer()}
			<button class="btn" onclick={cancel}>{t('common.cancel')}</button>
			<button class="btn {o.danger ? 'danger' : 'primary'}" onclick={ok} disabled={confirmBlocked}>
				{o.confirmLabel ?? t('confirm.ok')}
			</button>
		{/snippet}
	</Modal>
{/if}

<style>
	.msg {
		margin: 0 0 0.25rem;
		line-height: 1.55;
		white-space: pre-line;
	}
	.field {
		margin-top: 0.75rem;
	}
	/* plain-text note, not code — override the global mono textarea style */
	textarea {
		font-family: var(--sans);
		font-size: 0.875rem;
		min-height: 70px;
		background: var(--bg-elev);
	}
</style>
