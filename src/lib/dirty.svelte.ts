// Cheap dirty-tracking for modal forms: snapshot the form state (by JSON) at
// the moment the modal opens, compare live. Feed the result into Modal's
// `dirty` prop so ESC / backdrop / × ask before discarding edits.
//
//   const guard = dirtyGuard(
//     () => showForm,
//     () => [f, specText]
//   );
//   <Modal bind:open={showForm} dirty={guard.dirty && !saving}>
//
// Call during component init (uses runes). Forms are small state objects, so
// stringify-per-keystroke is negligible.

import { untrack } from 'svelte';

export function dirtyGuard(open: () => boolean, value: () => unknown) {
	let snap = $state('');
	$effect(() => {
		if (open()) untrack(() => (snap = JSON.stringify(value())));
	});
	const dirty = $derived(open() && JSON.stringify(value()) !== snap);
	return {
		get dirty() {
			return dirty;
		}
	};
}
