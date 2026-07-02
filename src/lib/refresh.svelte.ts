// Global auto-refresh ticker. A single interval bumps `tick`; live pages
// subscribe via pollEffect() below, so one timer drives every page. Interval is
// user-selectable and persisted. Polling pauses while the tab is hidden to
// avoid pointless background fetches.

import { untrack } from 'svelte';
import { browser } from '$app/environment';

const KEY = 'dn42.refreshMs';
const DEFAULT_MS = 10000;

function initialMs(): number {
	if (!browser) return DEFAULT_MS;
	const raw = localStorage.getItem(KEY);
	if (raw === null) return DEFAULT_MS;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MS;
}

class RefreshState {
	/** Polling interval in ms; 0 means auto-refresh is off. */
	intervalMs = $state(initialMs());
	/** Monotonic counter bumped on every tick. Pages depend on this. */
	tick = $state(0);

	#timer: ReturnType<typeof setInterval> | null = null;

	start() {
		if (!browser) return;
		this.stop();
		if (this.intervalMs > 0) {
			this.#timer = setInterval(() => {
				// Don't poll a hidden tab. Background polls update data in place
				// (silently) without remounting the DOM, so editing isn't disrupted.
				if (document.visibilityState === 'visible') this.tick++;
			}, this.intervalMs);
		}
	}

	stop() {
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}

	set(ms: number) {
		this.intervalMs = ms;
		if (browser) localStorage.setItem(KEY, String(ms));
		this.start();
	}

	/** Manual refresh: bump the tick so every subscribed page re-fetches now. */
	refreshNow() {
		this.tick++;
	}
}

export const autoRefresh = new RefreshState();

if (browser) autoRefresh.start();

/**
 * Subscribe a loader to the auto-refresh tick. Call during component init
 * (wraps an $effect). Runs immediately, then on every tick and whenever
 * `keys()` changes value.
 *
 * A tick that fires while the previous run is still in flight is SKIPPED — no
 * overlapping GETs racing last-writer-wins on a slow server. A key change
 * (e.g. navigating to another node) always runs, even mid-flight. Direct
 * `load()` calls after mutations bypass this wrapper and stay awaitable.
 */
export function pollEffect(load: () => Promise<unknown> | void, keys?: () => unknown) {
	let busy = false;
	let lastKey: unknown = Symbol('initial');
	$effect(() => {
		autoRefresh.tick;
		const k = keys?.();
		untrack(() => {
			const keyChanged = k !== lastKey;
			lastKey = k;
			if (busy && !keyChanged) return;
			busy = true;
			void Promise.resolve(load()).finally(() => (busy = false));
		});
	});
}
