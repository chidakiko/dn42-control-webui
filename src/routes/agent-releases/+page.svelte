<script lang="ts">
	import { api, errorMessage } from '$lib/api';
	import { pollEffect } from '$lib/refresh.svelte';
	import { dirtyGuard } from '$lib/dirty.svelte';
	import { toast } from '$lib/toast.svelte';
	import { fmtTime, relTime, LIVE_CLS } from '$lib/format';
	import { t } from '$lib/i18n.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import InlineBanner from '$lib/components/InlineBanner.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Select from '$lib/components/Select.svelte';
	import SkeletonTable from '$lib/components/SkeletonTable.svelte';
	import type { ReleasesStatus } from '$lib/types';

	let data = $state<ReleasesStatus | null>(null);
	let loading = $state(true);
	let error = $state('');

	// target-version control
	let pickTarget = $state('');
	let settingTarget = $state(false);

	// upload modal
	let showUpload = $state(false);
	let uploading = $state(false);
	let upVersion = $state('');
	let upFiles = $state<FileList | null>(null);
	const uploadGuard = dirtyGuard(
		() => showUpload,
		() => [upVersion, upFiles?.length ?? 0]
	);

	async function load() {
		if (!data) loading = true;
		error = '';
		try {
			data = await api.agentReleases();
			// default the picker to the current target (or the newest uploaded version)
			if (!pickTarget) pickTarget = data.target ?? data.versions.at(-1) ?? '';
		} catch (err) {
			error = errorMessage(err);
		} finally {
			loading = false;
		}
	}
	pollEffect(() => load());

	async function setTarget() {
		if (!pickTarget) return;
		settingTarget = true;
		try {
			data = await api.setAgentTarget(pickTarget);
			toast.success(t('arel.targetSet', pickTarget));
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			settingTarget = false;
		}
	}

	async function upload() {
		const files = upFiles ? Array.from(upFiles) : [];
		if (!upVersion.trim() || files.length === 0) {
			toast.error(t('arel.needFiles'));
			return;
		}
		uploading = true;
		try {
			const m = await api.uploadAgentRelease(upVersion.trim(), files);
			toast.success(t('arel.uploaded', m.version));
			showUpload = false;
			upVersion = '';
			upFiles = null;
			await load();
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			uploading = false;
		}
	}

	let versionOpts = $derived((data?.versions ?? []).map((v) => ({ value: v, label: v })));
</script>

<div class="page-head" style="justify-content:flex-end">
	<div class="ph-actions">
		<button class="btn primary sm" onclick={() => (showUpload = true)}>+ {t('arel.upload')}</button>
	</div>
</div>

{#if loading && !data}
	<div class="card" style="padding:0">
		<SkeletonTable
			headers={[t('arel.col.node'), t('arel.col.version'), t('arel.col.status'), t('arel.col.gen'), t('arel.col.apply'), t('arel.col.seen')]}
			cols={['7rem', '6rem', '5rem', '5rem', '5rem', '7rem']}
		/>
	</div>
{:else if error && !data}
	<div class="card"><p class="error-text">{error}</p></div>
{:else if data}
	{#if error}<InlineBanner detail={error} />{/if}
	<!-- Global target version control -->
	<div class="card target">
		<div class="t-main">
			<span class="t-lbl">{t('arel.target')}</span>
			<span class="t-val mono" class:none={!data.target}>{data.target ?? t('arel.targetNone')}</span>
		</div>
		<div class="t-set">
			<Select
				size="sm"
				width="9rem"
				value={pickTarget}
				options={versionOpts}
				placeholder={t('arel.versions')}
				ariaLabel={t('arel.target')}
				onChange={(v) => (pickTarget = v)}
			/>
			<button
				class="btn primary sm"
				onclick={setTarget}
				disabled={settingTarget || !pickTarget || pickTarget === data.target}
			>
				{t('arel.setTarget')}
			</button>
		</div>
		<p class="t-hint">{t('arel.targetHint')}</p>
	</div>

	<!-- Per-node version / liveness table -->
	<div class="card" style="padding:0">
		{#if data.nodes.length === 0}
			<EmptyState icon="monitor" title={t('arel.empty')} hint={t('arel.note')} />
		{:else}
			<table>
				<thead>
					<tr>
						<th>{t('arel.col.node')}</th>
						<th>{t('arel.col.version')}</th>
						<th>{t('arel.col.status')}</th>
						<th>{t('arel.col.gen')}</th>
						<th>{t('arel.col.apply')}</th>
						<th>{t('arel.col.seen')}</th>
					</tr>
				</thead>
				<tbody>
					{#each data.nodes as n (n.node_id)}
						{@const live = n.liveness}
						<tr>
							<td><a class="mono" href="/nodes/{encodeURIComponent(n.node_id)}">{n.node_id}</a></td>
							<td class="mono">{n.agent_version}</td>
							<td>
								<span class="badge {n.up_to_date ? 'ok' : 'stale'}">
									<span class="dot"></span>{n.up_to_date ? t('arel.uptodate') : t('arel.behind')}
								</span>
							</td>
							<td class="faint mono">{n.applied_generation ?? '—'}</td>
							<td class="faint">{n.apply_status ?? '—'}</td>
							<td>
								<span class="seen" title={fmtTime(n.last_seen)}>
									<span class="badge {LIVE_CLS[live]}"><span class="dot"></span>{t('live.' + live)}</span>
									<span class="faint">{relTime(n.last_seen)}</span>
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
{/if}

<Modal title={t('arel.uploadTitle')} bind:open={showUpload} dirty={uploadGuard.dirty && !uploading}>
	<label class="field"><span>{t('arel.f.version')}</span><input class="mono" bind:value={upVersion} placeholder="1.0.42" /></label>
	<label class="field">
		<span>{t('arel.f.files')}</span>
		<input type="file" multiple accept=".whl" onchange={(e) => (upFiles = e.currentTarget.files)} />
	</label>
	<p class="up-hint">{t('arel.uploadHint')}</p>
	{#snippet footer()}
		<button class="btn" onclick={() => (showUpload = false)}>{t('common.cancel')}</button>
		<button class="btn primary" onclick={upload} disabled={uploading}>
			{uploading ? t('common.creating') : t('arel.upload')}
		</button>
	{/snippet}
</Modal>

<style>
	.target {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 0.75rem 1.5rem;
		margin-bottom: 1.25rem;
	}
	.t-main {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.t-lbl {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-faint);
	}
	.t-val {
		font-size: 1.4rem;
		font-weight: 700;
		line-height: 1;
	}
	.t-val.none {
		color: var(--text-faint);
		font-weight: 500;
	}
	.t-set {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.t-hint {
		grid-column: 1 / -1;
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-dim);
	}
	.seen {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.up-hint {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: var(--text-dim);
	}
</style>
