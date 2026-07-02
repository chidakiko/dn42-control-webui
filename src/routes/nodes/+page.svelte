<script lang="ts">
	import { api, errorMessage } from '$lib/api';
	import { pollEffect } from '$lib/refresh.svelte';
	import { urlParam } from '$lib/urlstate.svelte';
	import { dirtyGuard } from '$lib/dirty.svelte';
	import { createSort, cmp, matches } from '$lib/table.svelte';
	import SortTh from '$lib/components/SortTh.svelte';
	import type { NodeIn, UiNodeRow } from '$lib/types';
	import { toast } from '$lib/toast.svelte';
	import { fmtTime, LIVE_CLS } from '$lib/format';
	import { t } from '$lib/i18n.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import InlineBanner from '$lib/components/InlineBanner.svelte';
	import JsonEditor from '$lib/components/JsonEditor.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { fade } from 'svelte/transition';

	// GET /ui/nodes: rows arrive with liveness / agent version / health already
	// joined server-side — no more listNodes + fleetOverview client-side merge.
	let nodes = $state<UiNodeRow[]>([]);
	let loading = $state(true);
	let error = $state('');


	// Client-side search (?q=, shareable) + column sort — the fleet is far below
	// the ~500-row threshold where this would need to move server-side.
	const qParam = urlParam('q');
	const sort = createSort('node_id');
	const SORT_FIELDS: Record<string, (n: UiNodeRow) => string | number | null> = {
		node_id: (n) => n.node_id,
		asn: (n) => n.asn,
		site: (n) => n.site,
		lifecycle: (n) => n.lifecycle,
		agent_version: (n) => n.agent_version,
		current_generation: (n) => n.current_generation,
		updated_at: (n) => n.updated_at
	};
	let view = $derived.by(() => {
		const rows = nodes.filter((n) =>
			matches(qParam.value, n.node_id, n.asn, n.router_id, n.site, n.lifecycle, n.agent_version)
		);
		const get = SORT_FIELDS[sort.key];
		return get ? [...rows].sort((a, b) => sort.dir * cmp(get(a), get(b))) : rows;
	});

	let showCreate = $state(false);
	let saving = $state(false);

	// create form
	let f = $state({
		node_id: '',
		asn: '',
		router_id: '',
		site: '',
		loopback_ipv4: '',
		loopback_ipv6: '',
		link_local: '',
		ipv4_prefixes: '',
		ipv6_prefixes: ''
	});
	let baseTemplate = $state('{}');
	let baseEditor: JsonEditor;
	const formGuard = dirtyGuard(
		() => showCreate,
		() => [f, baseTemplate]
	);

	async function load() {
		if (nodes.length === 0) loading = true;
		error = '';
		try {
			nodes = (await api.listUiNodes()).nodes;
		} catch (err) {
			error = errorMessage(err);
		} finally {
			loading = false;
		}
	}
	pollEffect(() => load());

	function resetForm() {
		f = {
			node_id: '',
			asn: '',
			router_id: '',
			site: '',
			loopback_ipv4: '',
			loopback_ipv6: '',
			link_local: '',
			ipv4_prefixes: '',
			ipv6_prefixes: ''
		};
		baseTemplate = '{}';
	}

	function lines(s: string): string[] {
		return s
			.split(/[\n,]/)
			.map((x) => x.trim())
			.filter(Boolean);
	}

	async function create() {
		if (!f.node_id.trim() || !f.asn.trim() || !f.router_id.trim()) {
			toast.error(t('nodes.req'));
			return;
		}
		if (!baseEditor.valid()) {
			toast.error(t('nodes.badBase'));
			return;
		}
		const body: NodeIn = {
			node_id: f.node_id.trim(),
			asn: Number(f.asn),
			router_id: f.router_id.trim(),
			site: f.site.trim() || null,
			loopback_ipv4: f.loopback_ipv4.trim() || null,
			loopback_ipv6: f.loopback_ipv6.trim() || null,
			link_local: f.link_local.trim() || null,
			ipv4_prefixes: lines(f.ipv4_prefixes),
			ipv6_prefixes: lines(f.ipv6_prefixes),
			base_template: JSON.parse(baseTemplate || '{}')
		};
		saving = true;
		try {
			await api.createNode(body);
			toast.success(t('nodes.created', body.node_id));
			showCreate = false;
			resetForm();
			await load();
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			saving = false;
		}
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
		<button class="btn primary sm" onclick={() => (showCreate = true)}>+ {t('nodes.new')}</button>
	</div>
</div>

{#if error && nodes.length === 0}
	<div class="card"><p class="error-text">{error}</p></div>
{:else if !loading && nodes.length === 0}
	<div class="card" style="padding:0" in:fade={{ duration: 150 }}>
		<EmptyState
			icon="nodes"
			title={t('nodes.empty')}
			hint={t('nodes.subtitle')}
			actionLabel={'+ ' + t('nodes.new')}
			onaction={() => (showCreate = true)}
		/>
	</div>
{:else}
	{#if error}<InlineBanner detail={error} />{/if}
	<div class="card" style="padding:0">
		<table>
			<thead>
				<tr>
					<SortTh label={t('nodes.col.id')} sortKey="node_id" {sort} />
					<SortTh label={t('nodes.col.asn')} sortKey="asn" {sort} />
					<th>{t('nodes.col.routerId')}</th>
					<SortTh label={t('nodes.col.site')} sortKey="site" {sort} />
					<SortTh label={t('nodes.col.lifecycle')} sortKey="lifecycle" {sort} />
					<SortTh label={t('arel.col.version')} sortKey="agent_version" {sort} />
					<SortTh label={t('nodes.col.gen')} sortKey="current_generation" {sort} />
					<SortTh label={t('nodes.col.updated')} sortKey="updated_at" {sort} />
				</tr>
			</thead>
			<tbody>
				{#if loading && nodes.length === 0}
					{#each Array(6) as _, i (i)}
						<tr>
							<td><Skeleton w="6rem" h="0.85rem" /></td>
							<td><Skeleton w="5rem" h="0.85rem" /></td>
							<td><Skeleton w="5.5rem" h="0.85rem" /></td>
							<td><Skeleton w="2.5rem" h="0.85rem" /></td>
							<td><Skeleton w="4.5rem" h="1.2rem" radius="999px" /></td>
							<td><Skeleton w="4rem" h="0.85rem" /></td>
							<td><Skeleton w="1.2rem" h="0.85rem" /></td>
							<td><Skeleton w="6rem" h="0.8rem" /></td>
						</tr>
					{/each}
				{:else}
					{#each view as n (n.node_id)}
						{@const ls = n.last_heartbeat_at ? n.liveness : null}
						<tr>
							<td>
								<a href="/nodes/{n.node_id}" class="id-cell mono">
									{#if ls}<span class="live-dot {LIVE_CLS[ls]}" title={t('live.' + ls)}></span>{/if}
									{n.node_id}
								</a>
							</td>
							<td class="mono">{n.asn}</td>
							<td class="mono">{n.router_id}</td>
							<td>{n.site ?? '—'}</td>
							<td>
								<span class="badge {n.lifecycle === 'active' ? 'ok' : 'stale'}">
									<span class="dot"></span>{n.lifecycle}
								</span>
							</td>
							<td class="mono faint" class:behind={n.agent_up_to_date === false}>
								{n.agent_version ?? '—'}
							</td>
							<td class="mono">{n.current_generation}</td>
							<td class="faint">{fmtTime(n.updated_at)}</td>
						</tr>
					{:else}
						<tr><td colspan="8" class="empty">{t('common.noMatch')}</td></tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
{/if}

<Modal title={t('nodes.create')} bind:open={showCreate} dirty={formGuard.dirty && !saving}>
	<div class="row">
		<label class="field"><span>{t('nodes.col.id')} *</span><input bind:value={f.node_id} placeholder="hkg2-edge" /></label>
		<label class="field"><span>{t('nodes.col.asn')} *</span><input bind:value={f.asn} placeholder="4242420000" /></label>
	</div>
	<div class="row">
		<label class="field"><span>{t('nodes.col.routerId')} *</span><input bind:value={f.router_id} placeholder="172.20.0.1" /></label>
		<label class="field"><span>{t('nodes.col.site')}</span><input bind:value={f.site} placeholder="hkg" /></label>
	</div>
	<div class="row">
		<label class="field"><span>{t('node.f.lo4')}</span><input bind:value={f.loopback_ipv4} /></label>
		<label class="field"><span>{t('node.f.lo6')}</span><input bind:value={f.loopback_ipv6} /></label>
		<label class="field"><span>{t('node.f.lla')}</span><input bind:value={f.link_local} placeholder="fe80::28" /></label>
	</div>
	<div class="row">
		<label class="field"
			><span>{t('nodes.f.ipv4')}</span><textarea bind:value={f.ipv4_prefixes} rows="2"
			></textarea></label
		>
		<label class="field"
			><span>{t('nodes.f.ipv6')}</span><textarea bind:value={f.ipv6_prefixes} rows="2"
			></textarea></label
		>
	</div>
	<JsonEditor bind:this={baseEditor} bind:text={baseTemplate} label={t('nodes.f.base')} rows={8} />

	{#snippet footer()}
		<button class="btn" onclick={() => (showCreate = false)}>{t('common.cancel')}</button>
		<button class="btn primary" onclick={create} disabled={saving}>
			{saving ? t('common.creating') : t('nodes.create')}
		</button>
	{/snippet}
</Modal>

<style>
	.id-cell {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}
	.live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex: none;
		background: var(--c-unknown);
	}
	.live-dot.ok {
		background: var(--c-ok);
	}
	.live-dot.stale {
		background: var(--c-warn);
	}
	.live-dot.down {
		background: var(--c-down);
	}
	td.behind {
		color: var(--c-warn);
	}
</style>
