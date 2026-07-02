<script lang="ts">
	import { api, errorMessage } from '$lib/api';
	import { toast } from '$lib/toast.svelte';
	import { promptDialog } from '$lib/confirm.svelte';
	import { fmtTime } from '$lib/format';
	import { t } from '$lib/i18n.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import InlineBanner from '$lib/components/InlineBanner.svelte';
	import Select from '$lib/components/Select.svelte';
	import SkeletonTable from '$lib/components/SkeletonTable.svelte';
	import type { Registration } from '$lib/types';
	import Modal from '$lib/components/Modal.svelte';
	import JsonView from '$lib/components/JsonView.svelte';
	import { pollEffect } from '$lib/refresh.svelte';
	import { urlParam } from '$lib/urlstate.svelte';

	let items = $state<Registration[]>([]);
	let loading = $state(true);
	let error = $state('');
	// Status filter lives in ?status= — refresh/back/share keep the view.
	const filterParam = urlParam('status', 'pending', { push: true });
	let filter = $derived(filterParam.value);

	let showInv = $state(false);
	let inv = $state<unknown>(null);

	async function load() {
		if (items.length === 0) loading = true;
		error = '';
		try {
			const r = await api.listRegistrations(filter === 'all' ? undefined : filter);
			items = r.registrations;
		} catch (err) {
			error = errorMessage(err);
		} finally {
			loading = false;
		}
	}
	// Reload on tick + when the status filter changes.
	pollEffect(
		() => load(),
		() => filter
	);

	async function decide(r: Registration, action: 'approve' | 'reject') {
		const label = action === 'approve' ? t('reg.approve') : t('reg.reject');
		// Styled dialog with an optional note. null = cancelled → do nothing (the
		// old native prompt() flow proceeded even on cancel).
		const note = await promptDialog({
			title: label,
			message: t('reg.notePrompt', label),
			noteLabel: t('reg.noteLabel'),
			confirmLabel: label,
			danger: action === 'reject'
		});
		if (note === null) return;
		try {
			if (action === 'approve') await api.approveRegistration(r.id, note || undefined);
			else await api.rejectRegistration(r.id, note || undefined);
			toast.success(t('reg.decided', action === 'approve' ? t('reg.approved') : t('reg.rejected')));
			await load();
		} catch (err) {
			toast.error(errorMessage(err));
		}
	}

	function statusCls(s: string): string {
		return s === 'approved' ? 'ok' : s === 'rejected' ? 'bad' : 'stale';
	}
</script>

<div class="page-head" style="justify-content:flex-end">
	<div class="ph-actions">
		<Select
			width="auto"
			value={filter}
			options={[
				{ value: 'all', label: t('reg.all') },
				{ value: 'pending', label: t('reg.pending') },
				{ value: 'approved', label: t('reg.approved') },
				{ value: 'rejected', label: t('reg.rejected') }
			]}
			onChange={(v) => (filterParam.value = v)}
		/>
	</div>
</div>

<p class="faint" style="font-size:0.8rem; margin-top:-0.75rem">{t('reg.note')}</p>

{#if loading && items.length === 0}
	<div class="card" style="padding:0">
		<SkeletonTable
			headers={[t('reg.col.id'), t('reg.col.node'), t('reg.col.status'), t('reg.col.created'), '']}
			cols={['6rem', '6rem', '4rem', '7rem', '3rem']}
		/>
	</div>
{:else if error && items.length === 0}
	<div class="card"><p class="error-text">{error}</p></div>
{:else}
	{#if error}<InlineBanner detail={error} />{/if}
	<div class="card" style="padding:0">
		{#if items.length === 0}
			<EmptyState icon="registrations" title={t('reg.empty')} hint={t('reg.subtitle')} />
		{:else}
			<table>
				<thead>
					<tr><th>{t('reg.col.id')}</th><th>{t('reg.col.node')}</th><th>{t('reg.col.status')}</th><th>{t('reg.col.created')}</th><th></th></tr>
				</thead>
				<tbody>
					{#each items as r (r.id)}
						<tr>
							<td class="mono">{r.id}</td>
							<td class="mono">{r.node_id}</td>
							<td><span class="badge {statusCls(r.status)}"><span class="dot"></span>{t('reg.' + r.status)}</span></td>
							<td class="faint">{fmtTime(r.created_at)}</td>
							<td class="actions">
								{#if r.inventory}
									<button class="btn ghost sm" onclick={() => { inv = r.inventory; showInv = true; }}>
										{t('reg.inventory')}
									</button>
								{/if}
								{#if r.status === 'pending'}
									<button class="btn ghost sm" onclick={() => decide(r, 'approve')}>{t('reg.approve')}</button>
									<button class="btn ghost sm danger" onclick={() => decide(r, 'reject')}>{t('reg.reject')}</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
{/if}

<Modal title={t('reg.invTitle')} bind:open={showInv}>
	<JsonView value={inv} max />
</Modal>
