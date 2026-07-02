<script lang="ts">
	import { api, errorMessage } from '$lib/api';
	import { fmtTime } from '$lib/format';
	import { t } from '$lib/i18n.svelte';
	import { toast } from '$lib/toast.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import InlineBanner from '$lib/components/InlineBanner.svelte';
	import Select from '$lib/components/Select.svelte';
	import SkeletonTable from '$lib/components/SkeletonTable.svelte';
	import type { AuditEntry } from '$lib/types';
	import Modal from '$lib/components/Modal.svelte';
	import JsonView from '$lib/components/JsonView.svelte';
	import { pollEffect } from '$lib/refresh.svelte';
	import { urlParam } from '$lib/urlstate.svelte';
	import { debounced } from '$lib/table.svelte';

	// Server-side cursor paging + search (GET /ui/audit): the log is append-only,
	// so the browser never holds more than the pages the operator walked.
	let items = $state<AuditEntry[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let hasMore = $state(false);
	let error = $state('');
	// Page size + search live in the querystring (refresh/back/share keep the view).
	const limitParam = urlParam('limit', '100', { push: true });
	let limit = $derived(Math.min(Number(limitParam.value) || 100, 500));
	const qParam = urlParam('q');
	// debounce typing before it hits the server; q matches actor/method/path
	const qDeb = debounced(() => qParam.value);

	let showDetail = $state(false);
	let detail = $state<unknown>(null);

	async function load(reset = false) {
		if (reset) {
			items = [];
			hasMore = false;
		}
		if (items.length === 0) loading = true;
		error = '';
		try {
			const r = await api.uiAudit({ limit, q: qDeb.value || undefined });
			if (items.length > limit) {
				// The operator has paged into history — prepend only what's new so a
				// background tick doesn't yank the older pages out from under them.
				const headId = items[0]?.id ?? -Infinity;
				const fresh = r.entries.filter((e) => e.id > headId);
				if (fresh.length) items = [...fresh, ...items];
			} else {
				items = r.entries;
				hasMore = r.entries.length === limit;
			}
		} catch (err) {
			error = errorMessage(err);
		} finally {
			loading = false;
		}
	}
	async function loadMore() {
		const last = items[items.length - 1];
		if (!last || loadingMore) return;
		loadingMore = true;
		try {
			const r = await api.uiAudit({ limit, q: qDeb.value || undefined, beforeId: last.id });
			items = [...items, ...r.entries];
			hasMore = r.entries.length === limit;
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			loadingMore = false;
		}
	}
	// reload on tick; a page-size or search change resets to the first page
	let lastKey = '';
	pollEffect(
		() => {
			const key = `${limit}|${qDeb.value}`;
			const changed = key !== lastKey;
			lastKey = key;
			return load(changed);
		},
		() => `${limit}|${qDeb.value}`
	);

	function codeCls(code: number): string {
		if (code >= 500) return 'bad';
		if (code >= 400) return 'stale';
		if (code >= 200 && code < 300) return 'ok';
		return 'neutral';
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
		<Select
			width="auto"
			value={String(limit)}
			options={[50, 100, 250, 500].map((n) => ({ value: String(n), label: t('audit.last', n) }))}
			onChange={(v) => (limitParam.value = v)}
		/>
	</div>
</div>

<p class="faint" style="font-size:0.8rem; margin-top:-0.75rem">{t('audit.note')}</p>

{#if loading && items.length === 0}
	<div class="card" style="padding:0">
		<SkeletonTable
			headers={[
				t('audit.col.when'),
				t('audit.col.actor'),
				t('audit.col.method'),
				t('audit.col.path'),
				t('audit.col.status'),
				''
			]}
			cols={['6rem', '4rem', '3rem', '12rem', '3rem', '2rem']}
		/>
	</div>
{:else if error && items.length === 0}
	<div class="card"><p class="error-text">{error}</p></div>
{:else}
	{#if error}<InlineBanner detail={error} />{/if}
	<div class="card" style="padding:0">
		{#if items.length === 0 && qDeb.value}
			<div class="empty">{t('common.noMatch')}</div>
		{:else if items.length === 0}
			<EmptyState icon="audit" title={t('audit.empty')} hint={t('audit.subtitle')} />
		{:else}
			<table>
				<thead>
					<tr><th>{t('audit.col.when')}</th><th>{t('audit.col.actor')}</th><th>{t('audit.col.method')}</th><th>{t('audit.col.path')}</th><th>{t('audit.col.status')}</th><th></th></tr>
				</thead>
				<tbody>
					{#each items as a (a.id)}
						<tr>
							<td class="faint">{fmtTime(a.created_at)}</td>
							<td class="mono faint">{a.actor ?? '—'}</td>
							<td><span class="tag">{a.method}</span></td>
							<td class="mono" style="word-break:break-all">{a.path}</td>
							<td><span class="badge {codeCls(a.status_code)}"><span class="dot"></span>{a.status_code}</span></td>
							<td class="actions">
								{#if a.detail && Object.keys(a.detail).length}
									<button class="btn ghost sm" onclick={() => { detail = a.detail; showDetail = true; }}>
										{t('audit.detail')}
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if hasMore}
				<div class="more">
					<button class="btn sm" onclick={loadMore} disabled={loadingMore}>
						{loadingMore ? t('common.loading') : t('audit.loadMore')}
					</button>
				</div>
			{/if}
		{/if}
	</div>
{/if}

<Modal title={t('audit.detailTitle')} bind:open={showDetail}>
	<JsonView value={detail} max />
</Modal>

<style>
	.more {
		display: flex;
		justify-content: center;
		padding: 0.6rem 0 0.8rem;
	}
</style>
