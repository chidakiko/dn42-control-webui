<script lang="ts">
	// Active probing from this node's debug-shell: ping / mtr / traceroute with live,
	// line-by-line output streamed over SSE. The node's debug-shell shares the router
	// netns, so results reflect the node's real DN42 routing view. Targets are limited
	// server-side to DN42 / private / link-local space.
	import { api, errorMessage, streamProbe } from '$lib/api';
	import { toast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n.svelte';
	import Select from '$lib/components/Select.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { ProbeTool } from '$lib/types';

	let { nodeId }: { nodeId: string } = $props();

	let tool = $state<ProbeTool>('ping');
	let target = $state('');
	let count = $state(10);
	let running = $state(false);
	let output = $state('');
	let exitInfo = $state<{ code: number | null; error: string | null } | null>(null);
	let ctrl: AbortController | null = null;
	let pre = $state<HTMLPreElement | undefined>(undefined);

	const toolOpts = [
		{ value: 'ping', label: 'ping' },
		{ value: 'mtr', label: 'mtr' },
		{ value: 'traceroute', label: 'traceroute' }
	];

	async function run() {
		const tgt = target.trim();
		if (!tgt) {
			toast.error(t('probe.needTarget'));
			return;
		}
		output = '';
		exitInfo = null;
		running = true;
		const controller = new AbortController();
		ctrl = controller;
		try {
			const { probe_id } = await api.probeStart(nodeId, { tool, target: tgt, count });
			await streamProbe(
				probe_id,
				(msg) => {
					if (msg.type === 'output') {
						output += msg.text;
						// Keep the terminal pinned to the latest line as output streams in.
						queueMicrotask(() => pre?.scrollTo(0, pre.scrollHeight));
					} else {
						exitInfo = { code: msg.exit_code, error: msg.error };
					}
				},
				controller.signal
			);
		} catch (err) {
			// An abort (user pressed Stop / re-ran) is expected — don't surface it.
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				toast.error(errorMessage(err));
			}
		} finally {
			if (ctrl === controller) {
				running = false;
				ctrl = null;
			}
		}
	}

	function stop() {
		ctrl?.abort();
		ctrl = null;
		running = false;
	}
</script>

<div class="card-head">
	<h3><Icon name="activity" size={16} />{t('node.tab.probe')}</h3>
</div>

<form
	class="probe-form"
	onsubmit={(e) => {
		e.preventDefault();
		if (!running) run();
	}}
>
	<label class="field tool">
		<span>{t('probe.tool')}</span>
		<Select
			value={tool}
			options={toolOpts}
			onChange={(v) => (tool = v as ProbeTool)}
			ariaLabel={t('probe.tool')}
			disabled={running}
		/>
	</label>
	<label class="field target">
		<span>{t('probe.target')}</span>
		<input
			bind:value={target}
			placeholder={t('probe.targetPlaceholder')}
			disabled={running}
			spellcheck="false"
			autocapitalize="off"
		/>
	</label>
	<label class="field count">
		<span>{t('probe.count')}</span>
		<input type="number" bind:value={count} min="1" max="30" disabled={running || tool === 'traceroute'} />
	</label>
	{#if running}
		<button type="button" class="btn danger" onclick={stop}>
			<Icon name="refresh" size={14} />{t('probe.stop')}
		</button>
	{:else}
		<button type="submit" class="btn primary"><Icon name="activity" size={14} />{t('probe.run')}</button>
	{/if}
</form>

<div class="term-wrap">
	<pre bind:this={pre} class="term" class:empty={!output}>{output || (running ? t('probe.running') : t('probe.hint'))}</pre>
	{#if exitInfo}
		{#if exitInfo.error}
			<div class="term-foot bad"><Icon name="alert-triangle" size={13} />{exitInfo.error}</div>
		{:else}
			<div class="term-foot" class:bad={exitInfo.code !== 0} class:ok={exitInfo.code === 0}>
				{t('probe.exit')}: {exitInfo.code ?? '—'}
			</div>
		{/if}
	{/if}
</div>

<style>
	.probe-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.field > span {
		color: var(--text-faint);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.field.tool {
		min-width: 9rem;
	}
	.field.target {
		flex: 1;
		min-width: 12rem;
	}
	.field.count {
		width: 5rem;
	}
	.field input {
		background: var(--bg-elev);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		color: var(--text);
		font-size: 0.875rem;
		padding: 0.45rem 0.6rem;
		font-family: var(--font-mono, monospace);
	}
	.field input:disabled {
		opacity: 0.55;
	}
	.term-wrap {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg-elev-2);
	}
	.term {
		margin: 0;
		padding: 0.75rem 0.9rem;
		max-height: 26rem;
		overflow: auto;
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-all;
		color: var(--text);
	}
	.term.empty {
		color: var(--text-faint);
	}
	.term-foot {
		border-top: 1px solid var(--border);
		padding: 0.4rem 0.9rem;
		font-size: 0.78rem;
		font-family: var(--font-mono, monospace);
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--text-dim);
	}
	.term-foot.ok {
		color: var(--ok);
	}
	.term-foot.bad {
		color: var(--bad);
	}
</style>
