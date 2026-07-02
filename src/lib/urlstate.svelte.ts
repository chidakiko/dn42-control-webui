// URL-as-state (contract 1 of docs/ui-interaction-proposal.md): filters, tabs
// and drill-downs live in the querystring, so refresh / back / share all
// reproduce the exact view. Reads are reactive via $app/state's `page`; writes
// go through goto().
//
//   const tab = urlParam('tab', 'overview', { push: true });
//   tab.value            // reactive current value
//   tab.value = 'dns'    // updates the URL (push: history entry, else replace)
//
// Convention: discrete switches (tabs, filters) use push so the back button
// walks them; typed input (search) uses the default replace so every keystroke
// doesn't pollute history.

import { page } from '$app/state';
import { goto } from '$app/navigation';
import { browser } from '$app/environment';

function navigate(url: URL, push: boolean) {
	if (url.search === page.url.search && url.pathname === page.url.pathname) return;
	void goto(url.pathname + url.search + url.hash, {
		replaceState: !push,
		keepFocus: true,
		noScroll: true
	});
}

export function urlParam(key: string, def = '', opts: { push?: boolean } = {}) {
	return {
		get value(): string {
			return page.url.searchParams.get(key) ?? def;
		},
		set value(v: string) {
			if (!browser) return;
			const url = new URL(page.url.href);
			if (!v || v === def) url.searchParams.delete(key);
			else url.searchParams.set(key, v);
			navigate(url, opts.push ?? false);
		}
	};
}

/** Update several params in ONE navigation (e.g. set group + clear zone). */
export function setParams(patch: Record<string, string | null>, opts: { push?: boolean } = {}) {
	if (!browser) return;
	const url = new URL(page.url.href);
	for (const [k, v] of Object.entries(patch)) {
		if (v === null || v === '') url.searchParams.delete(k);
		else url.searchParams.set(k, v);
	}
	navigate(url, opts.push ?? false);
}
