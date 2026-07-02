<script lang="ts">
	// Sortable column header: renders a <th> with aria-sort and a direction
	// arrow. Pair with createSort() from $lib/table.svelte.ts:
	//   <SortTh label={...} sortKey="asn" sort={sort} />
	let {
		label,
		sortKey,
		sort
	}: {
		label: string;
		sortKey: string;
		sort: {
			key: string;
			dir: 1 | -1;
			toggle(k: string): void;
			aria(k: string): 'ascending' | 'descending' | undefined;
		};
	} = $props();
</script>

<th aria-sort={sort.aria(sortKey)}>
	<button class="sort-btn" class:active={sort.key === sortKey} onclick={() => sort.toggle(sortKey)}>
		{label}<span class="arrow" aria-hidden="true">{sort.key === sortKey ? (sort.dir === 1 ? '↑' : '↓') : ''}</span>
	</button>
</th>

<style>
	th {
		padding: 0;
	}
	/* inherit the global th look; the whole header cell is the click target */
	.sort-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
		padding: 0.55rem 0.7rem;
		background: none;
		border: none;
		cursor: pointer;
		font: inherit;
		color: var(--text-faint);
		font-weight: 600;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		text-align: left;
		white-space: nowrap;
	}
	.sort-btn:hover,
	.sort-btn.active {
		color: var(--text-dim);
	}
	.arrow {
		display: inline-block;
		min-width: 0.7em;
	}
</style>
