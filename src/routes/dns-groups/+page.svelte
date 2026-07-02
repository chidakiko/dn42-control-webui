<script lang="ts">
	import { untrack } from 'svelte';
	import { api, errorMessage } from '$lib/api';
	import { toast } from '$lib/toast.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n.svelte';
	import type { DnsGroupOut, DnsGroupZoneOut, DnsZoneWriteOut } from '$lib/types';
	import Modal from '$lib/components/Modal.svelte';
	import JsonEditor from '$lib/components/JsonEditor.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import InlineBanner from '$lib/components/InlineBanner.svelte';
	import RowMenu from '$lib/components/RowMenu.svelte';
	// (lives beside the other shared components — it's the dns-groups page's
	// records editor, not a node-detail tab)
	import DnsRecordsPanel from '$lib/components/DnsRecordsPanel.svelte';
	import SkeletonTable from '$lib/components/SkeletonTable.svelte';
	import { pollEffect } from '$lib/refresh.svelte';
	import { urlParam, setParams } from '$lib/urlstate.svelte';
	import { dirtyGuard } from '$lib/dirty.svelte';

	let groups = $state<DnsGroupOut[]>([]);
	let loading = $state(true);
	let error = $state('');

	// The groups → zones → records drill-down lives in ?group= / ?zone=, so the
	// selection is deep-linkable and survives refresh/back. The selected objects
	// are derived from the loaded lists, so in-place updates (applyZoneWrite)
	// propagate without manual reassignment.
	const groupParam = urlParam('group', '', { push: true });
	const zoneParam = urlParam('zone', '', { push: true });
	let zones = $state<DnsGroupZoneOut[]>([]);
	let selectedGroup = $derived(groups.find((g) => String(g.id) === groupParam.value) ?? null);
	let selectedZone = $derived(zones.find((z) => String(z.id) === zoneParam.value) ?? null);

	// ---- group form ----
	let showGroupForm = $state(false);
	let editingGroup = $state<DnsGroupOut | null>(null);
	let savingGroup = $state(false);
	let gName = $state('');
	let gBind = $state('');
	let gCacheTtl = $state(300);
	let gEnabled = $state(true);
	let gForwards = $state('[]');
	let gForwardsEditor: { valid: () => boolean } | undefined = $state();

	// ---- zone form ----
	let showZoneForm = $state(false);
	let editingZone = $state<DnsGroupZoneOut | null>(null);
	let savingZone = $state(false);
	let zName = $state('');
	let zPrimaryNs = $state('');
	let zAdminEmail = $state('');
	let zDefaultTtl = $state('');
	let zEnabled = $state(true);

	const groupFormGuard = dirtyGuard(
		() => showGroupForm,
		() => [gName, gBind, gCacheTtl, gEnabled, gForwards]
	);
	const zoneFormGuard = dirtyGuard(
		() => showZoneForm,
		() => [zName, zPrimaryNs, zAdminEmail, zDefaultTtl, zEnabled]
	);

	async function loadGroups() {
		if (groups.length === 0) loading = true;
		error = '';
		try {
			groups = await api.listDnsGroups();
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}
	async function loadZones() {
		if (!selectedGroup) {
			zones = [];
			return;
		}
		try {
			zones = await api.listGroupZones(selectedGroup.id);
		} catch (e) {
			toast.error(errorMessage(e));
		}
	}
	pollEffect(() => loadGroups());
	$effect(() => {
		selectedGroup?.id;
		untrack(() => loadZones());
	});

	function selectGroup(g: DnsGroupOut) {
		// one navigation: set the group, clear any zone from the previous group
		setParams({ group: String(g.id), zone: null }, { push: true });
	}

	// ---- group CRUD ----
	function openGroupCreate() {
		editingGroup = null;
		gName = '';
		gBind = '';
		gCacheTtl = 300;
		gEnabled = true;
		gForwards = '[]';
		showGroupForm = true;
	}
	function openGroupEdit(g: DnsGroupOut) {
		editingGroup = g;
		gName = g.name;
		gBind = (g.bind_addresses ?? []).join('\n');
		gCacheTtl = g.cache_ttl_seconds;
		gEnabled = g.enabled;
		gForwards = JSON.stringify(g.forwards ?? [], null, 2);
		showGroupForm = true;
	}
	function groupBody(): Record<string, unknown> {
		return {
			name: gName.trim(),
			bind_addresses: gBind
				.split('\n')
				.map((s) => s.trim())
				.filter(Boolean),
			cache_ttl_seconds: Number(gCacheTtl),
			forwards: JSON.parse(gForwards),
			enabled: gEnabled
		};
	}
	async function saveGroup() {
		if (gForwardsEditor && !gForwardsEditor.valid()) {
			toast.error(t('dns.badForwards'));
			return;
		}
		savingGroup = true;
		try {
			if (editingGroup) {
				await api.updateDnsGroup(editingGroup.id, groupBody());
				toast.success(t('dns.updated'));
			} else {
				await api.createDnsGroup(groupBody());
				toast.success(t('dns.created'));
			}
			showGroupForm = false;
			await loadGroups();
		} catch (e) {
			toast.error(errorMessage(e));
		} finally {
			savingGroup = false;
		}
	}
	async function removeGroup(g: DnsGroupOut) {
		if (
			!(await confirmDialog({
				message: t('dns.confirmDelete', g.name),
				confirmLabel: t('common.delete'),
				danger: true
			}))
		)
			return;
		try {
			await api.deleteDnsGroup(g.id);
			toast.success(t('dns.deleted'));
			if (selectedGroup?.id === g.id) setParams({ group: null, zone: null });
			await loadGroups();
		} catch (e) {
			toast.error(errorMessage(e));
		}
	}

	// ---- zone CRUD ----
	function openZoneCreate() {
		editingZone = null;
		zName = '';
		zPrimaryNs = '';
		zAdminEmail = '';
		zDefaultTtl = '';
		zEnabled = true;
		showZoneForm = true;
	}
	function openZoneEdit(z: DnsGroupZoneOut) {
		editingZone = z;
		zName = z.zone;
		zPrimaryNs = z.primary_ns ?? '';
		zAdminEmail = z.admin_email ?? '';
		zDefaultTtl = z.default_ttl == null ? '' : String(z.default_ttl);
		zEnabled = z.enabled;
		showZoneForm = true;
	}
	function zoneBody(): Record<string, unknown> {
		return {
			zone: zName.trim(),
			primary_ns: zPrimaryNs.trim() || null,
			admin_email: zAdminEmail.trim() || null,
			default_ttl: zDefaultTtl.trim() === '' ? null : Number(zDefaultTtl),
			enabled: zEnabled
		};
	}
	// Zone writes return the fresh zone + its recounted parent group — apply both
	// in place instead of the old zones+groups double refresh.
	function applyZoneWrite(r: DnsZoneWriteOut, deletedId?: number) {
		if (deletedId !== undefined) {
			zones = zones.filter((z) => z.id !== deletedId);
		} else if (r.zone) {
			const z = r.zone;
			zones = zones.some((x) => x.id === z.id)
				? zones.map((x) => (x.id === z.id ? z : x))
				: [...zones, z];
		}
		// selectedGroup/selectedZone are derived from these arrays, so the
		// in-place updates propagate without manual reassignment.
		groups = groups.map((g) => (g.id === r.group.id ? r.group : g));
	}
	// Record writes bubble the recounted zone up from DnsRecordsPanel.
	function applyZoneCounts(z: DnsGroupZoneOut) {
		zones = zones.map((x) => (x.id === z.id ? z : x));
	}
	async function saveZone() {
		if (!selectedGroup) return;
		savingZone = true;
		try {
			let r: DnsZoneWriteOut;
			if (editingZone) {
				r = await api.updateGroupZone(selectedGroup.id, editingZone.id, zoneBody());
				toast.success(t('dns.zone.updated'));
			} else {
				r = await api.createGroupZone(selectedGroup.id, zoneBody());
				toast.success(t('dns.zone.created'));
			}
			showZoneForm = false;
			applyZoneWrite(r);
		} catch (e) {
			toast.error(errorMessage(e));
		} finally {
			savingZone = false;
		}
	}
	async function removeZone(z: DnsGroupZoneOut) {
		if (!selectedGroup) return;
		if (
			!(await confirmDialog({
				message: t('dns.zone.confirmDelete', z.zone),
				confirmLabel: t('common.delete'),
				danger: true
			}))
		)
			return;
		try {
			// DELETE is 200 with the write body now (not 204)
			const r = await api.deleteGroupZone(selectedGroup.id, z.id);
			toast.success(t('dns.zone.deleted'));
			if (selectedZone?.id === z.id) zoneParam.value = '';
			applyZoneWrite(r, z.id);
		} catch (e) {
			toast.error(errorMessage(e));
		}
	}
</script>

<div class="page-head" style="justify-content:flex-end">
	<div class="ph-actions">
		<button class="btn sm primary" onclick={openGroupCreate}>+ {t('dns.new')}</button>
	</div>
</div>

{#if loading && groups.length === 0}
	<div class="card" style="padding:0">
		<SkeletonTable
			headers={[
				t('dns.col.name'),
				t('dns.col.bind'),
				t('dns.col.zones'),
				t('dns.col.members'),
				t('dns.col.enabled'),
				''
			]}
			cols={['7rem', '8rem', '3rem', '4rem', '3rem', '3rem']}
		/>
	</div>
{:else if error && groups.length === 0}
	<div class="card"><p class="error-text">{error}</p></div>
{:else}
	{#if error}<InlineBanner detail={error} />{/if}
	<div class="card" style="padding:0">
		{#if groups.length === 0}
			<EmptyState
			icon="dns"
			title={t('dns.empty')}
			hint={t('dns.subtitle')}
			actionLabel={'+ ' + t('dns.new')}
			onaction={openGroupCreate}
		/>
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
						<tr class:row-selected={selectedGroup?.id === g.id}>
							<td class="mono">{g.name}</td>
							<td class="faint mono" style="font-size:0.8rem">{(g.bind_addresses ?? []).join(', ') || '—'}</td>
							<td>{g.zone_count}</td>
							<td>{t('dns.members', g.member_count)}</td>
							<td><span class="badge {g.enabled ? 'ok' : 'bad'}"><span class="dot"></span>{g.enabled ? t('common.yes') : t('common.no')}</span></td>
							<td class="actions">
								<button class="btn ghost sm" onclick={() => selectGroup(g)}>{t('dns.zones')}</button>
								<RowMenu
									actions={[
										{ label: t('common.edit'), icon: 'edit', onselect: () => openGroupEdit(g) },
										{ label: t('common.delete'), icon: 'trash', danger: true, onselect: () => removeGroup(g) }
									]}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	{#if selectedGroup}
		<div class="card" style="margin-top:1.25rem">
			<div class="spread" style="margin-bottom:0.75rem">
				<h2 style="margin:0">{t('dns.zones')} · <span class="mono">{selectedGroup.name}</span></h2>
				<div class="inline">
					<button class="btn sm primary" onclick={openZoneCreate}>+ {t('dns.zone.new')}</button>
					<button class="btn ghost sm" onclick={() => setParams({ group: null, zone: null })}>✕</button>
				</div>
			</div>
			{#if zones.length === 0}
				<div class="empty">{t('dns.zone.empty')}</div>
			{:else}
				<table>
					<thead>
						<tr><th>{t('dns.zone.col.zone')}</th><th>{t('dns.zone.col.soa')}</th><th>{t('dns.zone.col.records')}</th><th>{t('dns.col.enabled')}</th><th></th></tr>
					</thead>
					<tbody>
						{#each zones as z (z.id)}
							<tr class:row-selected={selectedZone?.id === z.id}>
								<td class="mono">{z.zone}</td>
								<td class="faint" style="font-size:0.8rem">{z.primary_ns ?? t('dns.zone.soaAuto')}</td>
								<td>{z.record_count}</td>
								<td><span class="badge {z.enabled ? 'ok' : 'bad'}"><span class="dot"></span>{z.enabled ? t('common.yes') : t('common.no')}</span></td>
								<td class="actions">
									<button class="btn ghost sm" onclick={() => (zoneParam.value = String(z.id))}>{t('dns.rec.title')}</button>
									<RowMenu
										actions={[
											{ label: t('common.edit'), icon: 'edit', onselect: () => openZoneEdit(z) },
											{ label: t('common.delete'), icon: 'trash', danger: true, onselect: () => removeZone(z) }
										]}
									/>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			{#if selectedZone}
				<div style="margin-top:1.1rem; border-top:1px solid var(--border, rgba(127,127,127,0.2)); padding-top:1rem">
					{#key selectedZone.id}
						<DnsRecordsPanel
							gid={selectedGroup.id}
							zid={selectedZone.id}
							zone={selectedZone.zone}
							onzone={applyZoneCounts}
						/>
					{/key}
				</div>
			{/if}
		</div>
	{/if}
{/if}

<!-- group modal -->
<Modal
	title={editingGroup ? t('spec.editOf', t('dns.singular')) : t('dns.new')}
	bind:open={showGroupForm}
	dirty={groupFormGuard.dirty && !savingGroup}
>
	<div class="form">
		<label><span>{t('dns.field.name')}</span><input bind:value={gName} placeholder="lab-dns" /></label>
		<label>
			<span>{t('dns.field.bind')}</span>
			<textarea bind:value={gBind} rows="3" placeholder={"172.20.0.20\nfdce:1111:2222::20"}></textarea>
			<small class="faint">{t('dns.field.bindHint')}</small>
		</label>
		<label><span>{t('dns.field.cacheTtl')}</span><input type="number" bind:value={gCacheTtl} min="0" /></label>
		<JsonEditor bind:this={gForwardsEditor} bind:text={gForwards} label={t('dns.field.forwards')} rows={3} />
		<label class="inline"><input type="checkbox" bind:checked={gEnabled} /><span>{t('dns.field.enabled')}</span></label>
	</div>
	{#snippet footer()}
		<button class="btn ghost" onclick={() => (showGroupForm = false)}>{t('common.cancel')}</button>
		<button class="btn primary" onclick={saveGroup} disabled={savingGroup}>{t('common.save')}</button>
	{/snippet}
</Modal>

<!-- zone modal -->
<Modal
	title={editingZone ? t('dns.zone.edit') : t('dns.zone.new')}
	bind:open={showZoneForm}
	dirty={zoneFormGuard.dirty && !savingZone}
>
	<div class="form">
		<label><span>{t('dns.zone.field.zone')}</span><input bind:value={zName} placeholder="example.dn42 / 20.172.in-addr.arpa" /></label>
		<p class="faint" style="font-size:0.8rem; margin:0">{t('dns.zone.soaHint')}</p>
		<label><span>{t('dns.zone.field.primaryNs')}</span><input bind:value={zPrimaryNs} placeholder="ns.example.dn42." /></label>
		<label><span>{t('dns.zone.field.adminEmail')}</span><input bind:value={zAdminEmail} placeholder="hostmaster.example.dn42." /></label>
		<label><span>{t('dns.zone.field.defaultTtl')}</span><input type="number" bind:value={zDefaultTtl} min="0" placeholder="3600" /></label>
		<label class="inline"><input type="checkbox" bind:checked={zEnabled} /><span>{t('dns.field.enabled')}</span></label>
	</div>
	{#snippet footer()}
		<button class="btn ghost" onclick={() => (showZoneForm = false)}>{t('common.cancel')}</button>
		<button class="btn primary" onclick={saveZone} disabled={savingZone}>{t('common.save')}</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
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
