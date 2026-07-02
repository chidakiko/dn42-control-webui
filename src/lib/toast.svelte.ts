// Tiny toast notification store (runes-based). Components call
// `toast.success(...)` / `toast.error(...)`; <Toaster/> renders the queue.

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
}

let counter = 0;

const MAX_VISIBLE = 5;
const DEDUP_MS = 2000;

class ToastStore {
	items = $state<Toast[]>([]);

	#lastMsg = '';
	#lastAt = 0;

	private push(kind: ToastKind, message: string, ttl: number) {
		// A burst of identical failures (e.g. N deletes against a dead server)
		// collapses into one toast instead of a stack of clones.
		const now = Date.now();
		if (message === this.#lastMsg && now - this.#lastAt < DEDUP_MS) return;
		this.#lastMsg = message;
		this.#lastAt = now;

		const id = ++counter;
		this.items.push({ id, kind, message });
		if (this.items.length > MAX_VISIBLE) this.items = this.items.slice(-MAX_VISIBLE);
		setTimeout(() => this.dismiss(id), ttl);
	}

	success(message: string) {
		this.push('success', message, 3500);
	}
	error(message: string) {
		this.push('error', message, 6000);
	}
	info(message: string) {
		this.push('info', message, 3500);
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toast = new ToastStore();
