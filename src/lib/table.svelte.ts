// Client-side table helpers (contract 3 of docs/ui-interaction-proposal.md):
// column sorting + free-text row matching for lists small enough to sort in
// the browser (<500 rows). Server-side cursors stay in the API layer.

/** Column-sort state. Call during component init (uses runes). */
export function createSort(defaultKey = '', defaultDir: 1 | -1 = 1) {
	let key = $state(defaultKey);
	let dir = $state<1 | -1>(defaultDir);
	return {
		get key() {
			return key;
		},
		get dir() {
			return dir;
		},
		/** Click handler: same column flips direction, new column starts ascending. */
		toggle(k: string) {
			if (key === k) dir = dir === 1 ? -1 : 1;
			else {
				key = k;
				dir = 1;
			}
		},
		aria(k: string): 'ascending' | 'descending' | undefined {
			return key === k ? (dir === 1 ? 'ascending' : 'descending') : undefined;
		}
	};
}

/** Null-safe comparator: numbers numerically, everything else locale-aware. */
export function cmp(a: unknown, b: unknown): number {
	if (a == null && b == null) return 0;
	if (a == null) return -1;
	if (b == null) return 1;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	return String(a).localeCompare(String(b));
}

/** Case-insensitive substring match of `q` against any of the given fields. */
export function matches(q: string, ...fields: (string | number | null | undefined)[]): boolean {
	const needle = q.trim().toLowerCase();
	if (!needle) return true;
	return fields.some((f) => f != null && String(f).toLowerCase().includes(needle));
}
