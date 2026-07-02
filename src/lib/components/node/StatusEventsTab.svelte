<script lang="ts">
	import { api, errorMessage } from '$lib/api';
	import { toast } from '$lib/toast.svelte';
	import { fmtTime } from '$lib/format';
	import { t, locale } from '$lib/i18n.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { StatusEventSummary, DriftItem } from '$lib/types';
	import HealthBadge from './../HealthBadge.svelte';
	import Modal from './../Modal.svelte';
	import JsonView from './../JsonView.svelte';
	import DriftCards from './../DriftCards.svelte';
	import Select from './../Select.svelte';
	import SkeletonTable from './../SkeletonTable.svelte';
	import SkeletonText from './../SkeletonText.svelte';
	import InlineBanner from './../InlineBanner.svelte';
	import BarChart from './../charts/BarChart.svelte';
	import ChartLegend from './../charts/ChartLegend.svelte';
	import { pollEffect } from '$lib/refresh.svelte';

	let { nodeId }: { nodeId: string } = $props();

	// Slim rows (no payloads — report rows carry drift_count instead); the full
	// payload is fetched on demand when a row is expanded. Newest-first, paged
	// backwards via the before_id cursor.
	const PAGE = 100;
	let items = $state<StatusEventSummary[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let hasMore = $state(false);
	let err = $state('');
	let kind = $state('');
	let range = $state<'24h' | '7d' | '30d' | 'all'>('24h');

	let showPayload = $state(false);
	let payload = $state<unknown>(null);
	let payloadLoading = $state(false);

	const RANGES = ['24h', '7d', '30d', 'all'] as const;
	const WINDOW: Record<string, number> = {
		'24h': 24 * 3600e3,
		'7d': 7 * 86400e3,
		'30d': 30 * 86400e3,
		all: Infinity
	};

	async function refresh(reset = false) {
		if (reset) {
			items = [];
			hasMore = false;
		}
		if (items.length === 0) loading = true;
		err = '';
		try {
			const r = await api.uiStatusEvents(nodeId, { kind: kind || undefined, limit: PAGE });
			if (items.length > PAGE) {
				// The operator has paged into history — prepend only what's new so a
				// background tick doesn't yank the older pages out from under them.
				const headId = items[0]?.id ?? -Infinity;
				const fresh = r.events.filter((e) => e.id > headId);
				if (fresh.length) items = [...fresh, ...items];
			} else {
				items = r.events;
				hasMore = r.events.length === PAGE;
			}
		} catch (e) {
			err = errorMessage(e);
		} finally {
			loading = false;
		}
	}
	async function loadMore() {
		const last = items[items.length - 1];
		if (!last || loadingMore) return;
		loadingMore = true;
		try {
			const r = await api.uiStatusEvents(nodeId, {
				kind: kind || undefined,
				limit: PAGE,
				beforeId: last.id
			});
			items = [...items, ...r.events];
			hasMore = r.events.length === PAGE;
		} catch (e) {
			toast.error(errorMessage(e));
		} finally {
			loadingMore = false;
		}
	}
	let lastNode = '';
	pollEffect(
		() => {
			const nodeChanged = lastNode !== nodeId;
			lastNode = nodeId;
			return refresh(nodeChanged);
		},
		() => nodeId
	);

	function toMs(s: string | null): number {
		if (!s) return NaN;
		const hasZone = /[zZ]$/.test(s) || /[+-]\d\d:?\d\d$/.test(s);
		return new Date(hasZone ? s : s + 'Z').getTime();
	}

	function statusKey(status: string | null): 'ok' | 'bad' | 'other' {
		if (!status) return 'other';
		if (['succeeded', 'ok', 'running'].includes(status)) return 'ok';
		if (['failed', 'degraded', 'bad'].includes(status)) return 'bad';
		return 'other';
	}

	// events filtered to the chosen window (table + chart share this)
	let windowed = $derived.by(() => {
		const now = Date.now();
		const w = WINDOW[range];
		if (w === Infinity) return items;
		return items.filter((e) => {
			const ms = toMs(e.created_at);
			return !isNaN(ms) && now - ms <= w;
		});
	});

	const COLORS = { ok: 'var(--c-ok)', bad: 'var(--c-bad)', other: 'var(--c-unknown)' };
	const B = 24; // buckets

	let buckets = $derived.by(() => {
		const ts = windowed.map((e) => toMs(e.created_at)).filter((n) => !isNaN(n));
		if (ts.length === 0) return [];
		const max = Math.max(...ts);
		const min = range === 'all' ? Math.min(...ts) : max - WINDOW[range];
		const span = Math.max(1, max - min);
		const size = span / B;
		const groups = Array.from({ length: B }, (_, i) => ({
			label: '',
			parts: { ok: 0, bad: 0, other: 0 } as Record<string, number>,
			at: min + i * size
		}));
		for (const e of windowed) {
			const ms = toMs(e.created_at);
			if (isNaN(ms)) continue;
			let idx = Math.floor((ms - min) / size);
			if (idx < 0) idx = 0;
			if (idx >= B) idx = B - 1;
			groups[idx].parts[statusKey(e.status)] += 1;
		}
		const dayMode = range === '30d' || range === 'all';
		return groups.map((g) => ({
			label: new Date(g.at).toLocaleString(locale.tag, dayMode
				? { month: 'numeric', day: 'numeric' }
				: { hour: '2-digit', minute: '2-digit' }),
			parts: [
				{ key: 'ok', value: g.parts.ok, color: COLORS.ok },
				{ key: 'bad', value: g.parts.bad, color: COLORS.bad },
				{ key: 'other', value: g.parts.other, color: COLORS.other }
			]
		}));
	});

	let hasChart = $derived(buckets.some((g) => g.parts.some((p) => p.value > 0)));

	// Fetch the full event (payload included) only when the operator expands it.
	async function view(ev: StatusEventSummary) {
		showPayload = true;
		payloadLoading = true;
		payload = null;
		try {
			payload = (await api.statusEventDetail(ev.id)).payload;
		} catch (e) {
			toast.error(errorMessage(e));
			showPayload = false;
		} finally {
			payloadLoading = false;
		}
	}

	// A report payload carries payload.drift[]; surface it as cards, JSON as fallback.
	let driftItems = $derived.by(() => {
		const d = (payload as { drift?: unknown })?.drift;
		return Array.isArray(d) ? (d as DriftItem[]) : [];
	});
</script>

<div class="card-head">
	<h3>{t('status.title')} <span class="faint">({windowed.length})</span></h3>
	<div class="inline">
		<div class="seg">
			{#each RANGES as r (r)}
				<button class="segbtn" class:active={range === r} onclick={() => (range = r)}>
					{t(`range.${r}`)}
				</button>
			{/each}
		</div>
		<Select
			width="auto"
			value={kind}
			options={[
				{ value: '', label: t('status.allKinds') },
				{ value: 'snapshot', label: 'snapshot' },
				{ value: 'report', label: 'report' },
				{ value: 'apply', label: 'apply' }
			]}
			onChange={(v) => {
				kind = v;
				refresh(true);
			}}
		/>
		<button class="btn sm icon" onclick={() => refresh(true)} disabled={loading} aria-label={t('common.refresh')}><Icon name="refresh" size={15} /></button>
	</div>
</div>

{#if loading && items.length === 0}
	<SkeletonTable
		headers={[t('status.col.kind'), t('status.col.gen'), t('status.col.status'), t('status.col.when'), '']}
		cols={['5rem', '3rem', '4rem', '7rem', '2rem']}
	/>
{:else if err && items.length === 0}
	<p class="error-text">{err}</p>
{:else if items.length === 0}
	<div class="empty">{t('status.empty')}</div>
{:else}
	{#if err}<InlineBanner detail={err} />{/if}
	{#if hasChart}
		<div class="timeline">
			<div class="tl-head">
				<span class="faint">{t('status.timeline')}</span>
				<ChartLegend
					items={[
						{ label: t('st.succeeded'), color: 'var(--c-ok)' },
						{ label: t('st.failed'), color: 'var(--c-bad)' }
					]}
				/>
			</div>
			<BarChart groups={buckets} height={110} />
		</div>
	{/if}

	<table>
		<thead>
			<tr><th>{t('status.col.kind')}</th><th>{t('status.col.gen')}</th><th>{t('status.col.status')}</th><th>{t('status.col.when')}</th><th></th></tr>
		</thead>
		<tbody>
			{#each windowed as ev (ev.id)}
				<tr>
					<td><span class="tag">{ev.kind}</span></td>
					<td class="mono">{ev.generation ?? '—'}</td>
					<td>
						<HealthBadge value={ev.status} />
						{#if ev.drift_count}<span class="drift-n">{t('status.driftN', ev.drift_count)}</span>{/if}
					</td>
					<td class="faint">{fmtTime(ev.created_at)}</td>
					<td class="actions">
						<button class="btn ghost sm" onclick={() => view(ev)}>{t('status.payload')}</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if hasMore}
		<div class="more">
			<button class="btn sm" onclick={loadMore} disabled={loadingMore}>
				{loadingMore ? t('common.loading') : t('status.loadMore')}
			</button>
		</div>
	{/if}
{/if}

<Modal title={t('status.payloadTitle')} bind:open={showPayload}>
	{#if payloadLoading}
		<SkeletonText lines={8} />
	{:else if driftItems.length}
		<DriftCards items={driftItems} />
		<details class="rawjson">
			<summary>{t('drift.rawJson')}</summary>
			<JsonView value={payload} max />
		</details>
	{:else}
		<JsonView value={payload} max />
	{/if}
</Modal>

<style>
	.drift-n {
		margin-left: 0.4rem;
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--c-bad);
		background: color-mix(in srgb, var(--c-bad) 14%, transparent);
		border-radius: 4px;
		padding: 0.05rem 0.32rem;
		font-variant-numeric: tabular-nums;
	}
	.more {
		display: flex;
		justify-content: center;
		padding: 0.6rem 0 0.2rem;
	}
	/* .seg / .segbtn segmented control moved to app.css (shared) */
	.timeline {
		padding: 0.5rem 0.25rem 0.75rem;
		margin-bottom: 0.5rem;
	}
	.tl-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		font-size: 0.75rem;
	}
	.rawjson {
		margin-top: 0.75rem;
		border-top: 1px solid var(--border);
		padding-top: 0.6rem;
	}
	.rawjson > summary {
		cursor: pointer;
		font-size: 0.8rem;
		color: var(--text-dim);
		user-select: none;
	}
	.rawjson > summary:hover {
		color: var(--text);
	}
	.rawjson > :global(.json-view),
	.rawjson > :global(pre) {
		margin-top: 0.5rem;
	}
</style>
