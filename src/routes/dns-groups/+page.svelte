<script lang="ts">
	import { untrack } from 'svelte';
	import { api, errorMessage } from '$lib/api';
	import { toast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n.svelte';
	import type { DnsGroupOut } from '$lib/types';
	import Modal from '$lib/components/Modal.svelte';
	import JsonEditor from '$lib/components/JsonEditor.svelte';
	import SpecResourceTab from '$lib/components/node/SpecResourceTab.svelte';
	import { autoRefresh } from '$lib/refresh.svelte';

	const ZONE_EXAMPLE = `{
  "zone": "example.dn42",
  "records_ref": "zone://example.dn42"
}`;

	let groups = $state<DnsGroupOut[]>([]);
	let loading = $state(true);
	let error = $state('');

	// 选中一个组以管理它的 zone（展开下方面板）。
	let selected = $state<DnsGroupOut | null>(null);

	// 创建 / 编辑组的弹窗。
	let showForm = $state(false);
	let editing = $state<DnsGroupOut | null>(null);
	let saving = $state(false);
	let fName = $state('');
	let fBind = $state('');
	let fCacheTtl = $state(300);
	let fEnabled = $state(true);
	let fForwards = $state('[]');
	let forwardsEditor: { valid: () => boolean } | undefined = $state();

	async function load() {
		if (groups.length === 0) loading = true;
		error = '';
		try {
			groups = await api.listDnsGroups();
			// 保持选中组的引用与最新数据同步。
			if (selected) selected = groups.find((g) => g.id === selected!.id) ?? null;
		} catch (err) {
			error = errorMessage(err);
		} finally {
			loading = false;
		}
	}
	$effect(() => {
		autoRefresh.tick;
		untrack(() => load());
	});

	function openCreate() {
		editing = null;
		fName = '';
		fBind = '';
		fCacheTtl = 300;
		fEnabled = true;
		fForwards = '[]';
		showForm = true;
	}

	function openEdit(g: DnsGroupOut) {
		editing = g;
		fName = g.name;
		fBind = (g.bind_addresses ?? []).join('\n');
		fCacheTtl = g.cache_ttl_seconds;
		fEnabled = g.enabled;
		fForwards = JSON.stringify(g.forwards ?? [], null, 2);
		showForm = true;
	}

	function buildBody(): Record<string, unknown> {
		return {
			name: fName.trim(),
			bind_addresses: fBind
				.split('\n')
				.map((s) => s.trim())
				.filter(Boolean),
			cache_ttl_seconds: Number(fCacheTtl),
			forwards: JSON.parse(fForwards),
			enabled: fEnabled
		};
	}

	async function save() {
		if (forwardsEditor && !forwardsEditor.valid()) {
			toast.error(t('dns.badForwards'));
			return;
		}
		saving = true;
		try {
			if (editing) {
				await api.updateDnsGroup(editing.id, buildBody());
				toast.success(t('dns.updated'));
			} else {
				await api.createDnsGroup(buildBody());
				toast.success(t('dns.created'));
			}
			showForm = false;
			await load();
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			saving = false;
		}
	}

	async function remove(g: DnsGroupOut) {
		if (!confirm(t('dns.confirmDelete', g.name))) return;
		try {
			await api.deleteDnsGroup(g.id);
			toast.success(t('dns.deleted'));
			if (selected?.id === g.id) selected = null;
			await load();
		} catch (err) {
			toast.error(errorMessage(err));
		}
	}
</script>

<div class="spread" style="margin-bottom:1.25rem">
	<h1>{t('dns.title')}</h1>
	<div class="inline">
		<button class="btn sm" onclick={load} disabled={loading}>↻ {t('common.refresh')}</button>
		<button class="btn sm primary" onclick={openCreate}>+ {t('dns.new')}</button>
	</div>
</div>

<p class="faint" style="font-size:0.8rem; margin-top:-0.75rem">{t('dns.subtitle')}</p>

{#if loading && groups.length === 0}
	<div class="empty">{t('common.loading')}</div>
{:else if error}
	<div class="card"><p class="error-text">{error}</p></div>
{:else}
	<div class="card" style="padding:0">
		{#if groups.length === 0}
			<div class="empty">{t('dns.empty')}</div>
		{:else}
			<table>
				<thead>
					<tr>
						<th>{t('dns.col.name')}</th>
						<th>{t('dns.col.bind')}</th>
						<th>{t('dns.col.zones')}</th>
						<th>{t('dns.col.members')}</th>
						<th>{t('dns.col.enabled')}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each groups as g (g.id)}
						<tr class:row-selected={selected?.id === g.id}>
							<td class="mono">{g.name}</td>
							<td class="faint mono" style="font-size:0.8rem">{(g.bind_addresses ?? []).join(', ') || '—'}</td>
							<td>{g.zone_count}</td>
							<td>{t('dns.members', g.member_count)}</td>
							<td>
								<span class="badge {g.enabled ? 'ok' : 'bad'}"><span class="dot"></span>{g.enabled ? t('common.yes') : t('common.no')}</span>
							</td>
							<td class="actions">
								<button class="btn ghost sm" onclick={() => (selected = g)}>{t('dns.zones')}</button>
								<button class="btn ghost sm" onclick={() => openEdit(g)}>{t('spec.editOf', t('dns.singular'))}</button>
								<button class="btn ghost sm danger" onclick={() => remove(g)}>✕</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	{#if selected}
		<div class="card" style="margin-top:1.25rem">
			<div class="spread" style="margin-bottom:0.75rem">
				<h2 style="margin:0">{t('dns.zones')} · <span class="mono">{selected.name}</span></h2>
				<button class="btn ghost sm" onclick={() => (selected = null)}>✕</button>
			</div>
			{#key selected.id}
				<SpecResourceTab
					title={t('dns.zones')}
					singular={t('dns.zone')}
					fields={{ enabled: true }}
					example={ZONE_EXAMPLE}
					load={() => api.listGroupZones(selected!.id)}
					create={(b) => api.createGroupZone(selected!.id, b)}
					update={(id, b) => api.updateGroupZone(selected!.id, id, b)}
					remove={(id) => api.deleteGroupZone(selected!.id, id)}
				/>
			{/key}
		</div>
	{/if}
{/if}

<Modal title={editing ? t('spec.editOf', t('dns.singular')) : t('dns.new')} bind:open={showForm}>
	<div class="form">
		<label>
			<span>{t('dns.field.name')}</span>
			<input bind:value={fName} placeholder="lab-dns" />
		</label>
		<label>
			<span>{t('dns.field.bind')}</span>
			<textarea bind:value={fBind} rows="3" placeholder={"172.20.0.20\nfdce:1111:2222::20"}></textarea>
			<small class="faint">{t('dns.field.bindHint')}</small>
		</label>
		<label>
			<span>{t('dns.field.cacheTtl')}</span>
			<input type="number" bind:value={fCacheTtl} min="0" />
		</label>
		<JsonEditor bind:this={forwardsEditor} bind:text={fForwards} label={t('dns.field.forwards')} rows={4} />
		<label class="inline">
			<input type="checkbox" bind:checked={fEnabled} />
			<span>{t('dns.field.enabled')}</span>
		</label>
	</div>
	{#snippet footer()}
		<button class="btn ghost" onclick={() => (showForm = false)}>{t('common.cancel')}</button>
		<button class="btn primary" onclick={save} disabled={saving}>{t('common.save')}</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.form label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.form label.inline {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}
	.row-selected {
		background: var(--surface-2, rgba(127, 127, 127, 0.08));
	}
</style>
