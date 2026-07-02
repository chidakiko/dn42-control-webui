// Promise-based, styled replacement for window.confirm() / prompt().
// Call confirmDialog()/promptDialog() from anywhere; ConfirmHost (mounted once
// in the layout, like Toaster) renders the dialog. Dismissal (ESC / backdrop /
// Cancel) resolves false/null, so a destructive action can never proceed
// un-confirmed — unlike the old native prompt() flow.

export interface ConfirmOptions {
	/** Dialog title; defaults to t('confirm.title') in the host. */
	title?: string;
	message: string;
	/** Confirm button label; defaults to t('confirm.ok'). */
	confirmLabel?: string;
	/** Red confirm button for destructive actions. */
	danger?: boolean;
	/** Show an optional note textarea (promptDialog sets this). */
	withNote?: boolean;
	noteLabel?: string;
	/**
	 * GitHub-style guard for irreversible operations: the operator must type
	 * this exact string (e.g. the node id) before the confirm button enables.
	 */
	typeToConfirm?: string;
}

interface Pending {
	opts: ConfirmOptions;
	resolve: (v: { ok: boolean; note: string }) => void;
}

let current = $state<Pending | null>(null);

export const confirmState = {
	get current() {
		return current;
	},
	/** Resolve the open dialog. Safe to call twice (second call is a no-op). */
	settle(ok: boolean, note = '') {
		current?.resolve({ ok, note });
		current = null;
	}
};

function ask(opts: ConfirmOptions): Promise<{ ok: boolean; note: string }> {
	// A second request while one is open cancels the first (shouldn't happen in
	// practice — dialogs are user-initiated and modal).
	current?.resolve({ ok: false, note: '' });
	return new Promise((resolve) => {
		current = { opts, resolve };
	});
}

/** window.confirm replacement: resolves true only on explicit confirm. */
export async function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
	const o = typeof opts === 'string' ? { message: opts } : opts;
	return (await ask(o)).ok;
}

/** Confirm with an optional note. Resolves the note text, or null when cancelled. */
export async function promptDialog(opts: ConfirmOptions): Promise<string | null> {
	const r = await ask({ ...opts, withNote: true });
	return r.ok ? r.note : null;
}
