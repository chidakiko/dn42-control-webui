<script lang="ts">
	import { api, errorMessage } from '$lib/api';
	import { pollEffect } from '$lib/refresh.svelte';
	import { urlParam } from '$lib/urlstate.svelte';
	import { dirtyGuard } from '$lib/dirty.svelte';
	import { createSort, cmp, matches } from '$lib/table.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import { toast } from '$lib/toast.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { fmtTime } from '$lib/format';
	import { t } from '$lib/i18n.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import InlineBanner from '$lib/components/InlineBanner.svelte';
	import type { EnrollmentTokenOut } from '$lib/types';
	import Modal from '$lib/components/Modal.svelte';
	import SecretReveal from '$lib/components/SecretReveal.svelte';
	import SkeletonTable from '$lib/components/SkeletonTable.svelte';

	let items = $state<EnrollmentTokenOut[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Client-side search (?q=) + column sort; newest first by default.
	const qParam = urlParam('q');
	const sort = createSort('created_at', -1);
	const SORT_FIELDS: Record<string, (x: EnrollmentTokenOut) => string | number | null> = {
		token_id: (x) => x.token_id,
		node_id: (x) => x.node_id,
		expires_at: (x) => x.expires_at,
		created_at: (x) => x.created_at
	};
	let view = $derived.by(() => {
		const rows = items.filter((x) => matches(qParam.value, x.token_id, x.node_id, x.description));
		const get = SORT_FIELDS[sort.key];
		return get ? [...rows].sort((a, b) => sort.dir * cmp(get(a), get(b))) : rows;
	});

	let showCreate = $state(false);
	let saving = $state(false);
	let f = $state({ node_id: '', description: '', expires_at: '', token: '' });
	let secret = $state<string | null>(null);
	const formGuard = dirtyGuard(
		() => showCreate,
		() => f
	);

	async function load() {
		if (items.length === 0) loading = true;
		error = '';
		try {
			items = await api.listEnrollmentTokens();
		} catch (err) {
			error = errorMessage(err);
		} finally {
			loading = false;
		}
	}
	pollEffect(() => load());

	async function create() {
		saving = true;
		try {
			const body: Record<string, unknown> = {};
			if (f.node_id.trim()) body.node_id = f.node_id.trim();
			if (f.description.trim()) body.description = f.description.trim();
			if (f.token.trim()) body.token = f.token.trim();
			if (f.expires_at) body.expires_at = new Date(f.expires_at).toISOString();
			const created = await api.createEnrollmentToken(body);
			secret = created.secret;
			showCreate = false;
			f = { node_id: '', description: '', expires_at: '', token: '' };
			await load();
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			saving = false;
		}
	}

	async function del(tok: EnrollmentTokenOut) {
		if (
			!(await confirmDialog({
				message: t('enr.confirmDelete', tok.token_id),
				confirmLabel: t('common.delete'),
				danger: true
			}))
		)
			return;
		try {
			await api.deleteEnrollmentToken(tok.token_id);
			toast.success(t('enr.deleted'));
			await load();
		} catch (err) {
			toast.error(errorMessage(err));
		}
	}

	function tokenState(tok: EnrollmentTokenOut): { cls: string; label: string } {
		if (tok.used_at) return { cls: 'unknown', label: t('enr.used') };
		if (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now())
			return { cls: 'stale', label: t('enr.expired') };
		return { cls: 'ok', label: t('enr.valid') };
	}
</script>

<div class="page-head" style="justify-content:flex-end">
	<div class="ph-actions">
		<input
			class="search"
			type="search"
			placeholder={t('common.search')}
			value={qParam.value}
			oninput={(e) => (qParam.value = e.currentTarget.value)}
		/>
		<button class="btn primary sm" onclick={() => (showCreate = true)}>+ {t('enr.new')}</button>
	</div>
</div>

{#if loading && items.length === 0}
	<div class="card" style="padding:0">
		<SkeletonTable
			headers={[
				t('enr.col.id'),
				t('enr.col.node'),
				t('enr.col.desc'),
				t('enr.col.state'),
				t('enr.col.expires'),
				t('enr.col.created'),
				''
			]}
			cols={['7rem', '5rem', '8rem', '4rem', '6rem', '6rem', '3rem']}
		/>
	</div>
{:else if error && items.length === 0}
	<div class="card"><p class="error-text">{error}</p></div>
{:else}
	{#if error}<InlineBanner detail={error} />{/if}
	<div class="card" style="padding:0">
		{#if items.length === 0}
			<EmptyState
				icon="tokens"
				title={t('enr.empty')}
				hint={t('enr.note')}
				actionLabel={'+ ' + t('enr.new')}
				onaction={() => (showCreate = true)}
			/>
		{:else}
			<table>
				<thead>
					<tr>
						<SortTh label={t('enr.col.id')} sortKey="token_id" {sort} />
						<SortTh label={t('enr.col.node')} sortKey="node_id" {sort} />
						<th>{t('enr.col.desc')}</th>
						<th>{t('enr.col.state')}</th>
						<SortTh label={t('enr.col.expires')} sortKey="expires_at" {sort} />
						<SortTh label={t('enr.col.created')} sortKey="created_at" {sort} />
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each view as tok (tok.token_id)}
						{@const s = tokenState(tok)}
						<tr>
							<td class="mono">{tok.token_id}</td>
							<td class="mono faint">{tok.node_id ?? t('enr.any')}</td>
							<td>{tok.description ?? '—'}</td>
							<td><span class="badge {s.cls}"><span class="dot"></span>{s.label}</span></td>
							<td class="faint">{tok.expires_at ? fmtTime(tok.expires_at) : t('common.never')}</td>
							<td class="faint">{fmtTime(tok.created_at)}</td>
							<td class="actions">
								<button class="btn ghost sm danger" onclick={() => del(tok)}>{t('common.delete')}</button>
							</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="empty">{t('common.noMatch')}</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
{/if}

<Modal title={t('enr.create')} bind:open={showCreate} dirty={formGuard.dirty && !saving}>
	<label class="field"><span>{t('enr.f.node')}</span><input bind:value={f.node_id} /></label>
	<label class="field"><span>{t('enr.f.desc')}</span><input bind:value={f.description} /></label>
	<label class="field"><span>{t('enr.f.expires')}</span><input type="datetime-local" bind:value={f.expires_at} /></label>
	<label class="field"><span>{t('enr.f.token')}</span><input bind:value={f.token} /></label>
	{#snippet footer()}
		<button class="btn" onclick={() => (showCreate = false)}>{t('common.cancel')}</button>
		<button class="btn primary" onclick={create} disabled={saving}>
			{saving ? t('common.creating') : t('common.create')}
		</button>
	{/snippet}
</Modal>

<SecretReveal bind:secret label={t('secret.enrollment')} />
