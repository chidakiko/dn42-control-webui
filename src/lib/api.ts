// Thin typed fetch wrapper around the control server admin API.
//
// Every call injects the admin Bearer token from `auth`. A 401 means the token
// is gone/invalid, so we drop it and let the route guard bounce to /login.
// Errors are normalised into `ApiError` carrying the parsed FastAPI `detail`.

import { goto } from '$app/navigation';
import { auth } from './auth.svelte';
import { t } from './i18n.svelte';
import type {
	AgentReleaseManifest,
	AgentTokenOut,
	AuditEntry,
	ReleasesStatus,
	DnsGroupOut,
	DnsGroupZoneOut,
	DnsRecordOut,
	DnsRecordWriteOut,
	DnsZoneWriteOut,
	EnrollmentTokenCreated,
	EnrollmentTokenOut,
	NodeTraffic,
	NodeLinks,
	NodeBgpSessions,
	NodeOverview,
	NodeTrendsOut,
	NodeStatusEventsSlim,
	GenerationDetailOut,
	GenerationDiffOut,
	GenerationOut,
	InterfaceOut,
	InternalTopologyView,
	NodeIn,
	NodeOut,
	NodePatch,
	NotifyResponse,
	PeerDefaults,
	PeeringIn,
	PeeringOut,
	ProbeMessage,
	ProbeSpec,
	ProbeStarted,
	ProvisionOut,
	ProvisionPeeringOut,
	Registration,
	RouteTuningRule,
	RouteTuningView,
	RoutingDashboard,
	RoutingPrefixes,
	SessionInfo,
	SessionOut,
	StatusEvent,
	UiDashboard,
	UiNodeRow
} from './types';

export class ApiError extends Error {
	status: number;
	detail: unknown;
	constructor(status: number, message: string, detail: unknown) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.detail = detail;
	}
}

// Known backend detail shapes → localized text (contract 5 of
// docs/ui-interaction-proposal.md). The control server emits stable,
// pattern-shaped detail strings (grep `detail=` in dn42-control-backend);
// unknown shapes pass through raw — better untranslated than wrong.
const DETAIL_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
	[/^unknown node (\S+)$/, (m) => t('err.d.unknownNode', m[1])],
	[/^unknown remote node (\S+)$/, (m) => t('err.d.unknownRemoteNode', m[1])],
	[
		/^unknown (bgp session|peering|interface|dns group|dns zone|dns record|registration|enrollment token)\b(.*)$/,
		(m) => t('err.d.notFound', `${m[1]}${m[2]}`)
	],
	// specific conflicts first, then the generic "… already exists …" family
	[
		/^wireguard listen_port (\d+) is already used by interface '([^']+)'/,
		(m) => t('err.d.portUsed', m[1], m[2])
	],
	[
		/^wireguard listen_port must be inside node runtime\.wireguard_port_range (\d+-\d+)$/,
		(m) => t('err.d.portRange', m[1])
	],
	[/^(.+?) already exists\b.*$/, (m) => t('err.d.conflict', m[1])],
	[/^node (\S+) has no connected agent$/, (m) => t('err.d.noAgent', m[1])],
	[/^node (\S+) agent disconnected before dispatch$/, () => t('err.d.agentGone')],
	[/^no desired state for node (\S+)$/, (m) => t('err.d.noDesired', m[1])],
	[/^node (\S+) has no published desired state$/, (m) => t('err.d.noDesired', m[1])],
	[/^node (\S+) has no generation (\d+)$/, (m) => t('err.d.noGeneration', m[1], m[2])],
	[/^no previous generation to diff against/, () => t('err.d.noDiffBase')],
	[/^peering (\d+) not on node (\S+)$/, (m) => t('err.d.peeringNotOnNode', m[1], m[2])],
	[/^node (\S+) is live; /, (m) => t('err.d.nodeLive', m[1])],
	[/^node (\S+) has no live agent connection/, (m) => t('err.d.noLiveConn', m[1])],
	[/^materialization failed schema validation$/, () => t('err.d.materialize')],
	[/^invalid (.+)$/, (m) => t('err.d.invalid', m[1])]
];

function translateDetail(s: string): string {
	for (const [re, fn] of DETAIL_PATTERNS) {
		const m = s.match(re);
		if (m) return fn(m);
	}
	return s;
}

/** Turn a FastAPI error body into a single human-readable, localized line. */
export function errorMessage(err: unknown): string {
	if (err instanceof ApiError) {
		const d = err.detail as
			| { message?: string; errors?: unknown[] }
			| string
			| null
			| undefined;
		if (typeof d === 'string') return translateDetail(d);
		if (d && typeof d === 'object') {
			if (typeof d.message === 'string') {
				const base = translateDetail(d.message);
				// pydantic validation payload: surface the first field error inline
				const first = Array.isArray(d.errors)
					? (d.errors[0] as { loc?: unknown[]; msg?: string } | undefined)
					: undefined;
				if (first?.msg) {
					const loc = Array.isArray(first.loc) ? first.loc.join('.') : '';
					const more = d.errors!.length > 1 ? ` (+${d.errors!.length - 1})` : '';
					return `${base} — ${loc ? loc + ': ' : ''}${first.msg}${more}`;
				}
				return base;
			}
			return JSON.stringify(d);
		}
		return err.message;
	}
	if (err instanceof Error) return err.message;
	return String(err);
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(
	method: Method,
	path: string,
	body?: unknown
): Promise<T> {
	const headers: Record<string, string> = {};
	if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
	// FormData sets its own multipart Content-Type (with boundary); only JSON-encode
	// plain bodies.
	const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
	if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

	let res: Response;
	try {
		res = await fetch(`${auth.apiBase}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
			// A hung control server must not hang the UI forever. File uploads
			// (FormData) get a much longer budget than JSON round-trips.
			signal: AbortSignal.timeout(isForm ? 120_000 : 15_000)
		});
	} catch (e) {
		if (e instanceof DOMException && e.name === 'TimeoutError') {
			throw new ApiError(0, t('err.timeout', auth.apiBase), null);
		}
		throw new ApiError(0, t('err.network', auth.apiBase), null);
	}

	if (res.status === 401) {
		auth.logout();
		// Avoid a redirect loop if we're already heading to login.
		void goto('/login');
		throw new ApiError(401, t('err.unauthorized'), null);
	}

	if (res.status === 204) return undefined as T;

	let payload: unknown = null;
	const text = await res.text();
	if (text) {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = text;
		}
	}

	if (!res.ok) {
		const detail =
			payload && typeof payload === 'object' && 'detail' in payload
				? (payload as { detail: unknown }).detail
				: payload;
		throw new ApiError(res.status, `HTTP ${res.status} ${res.statusText}`, detail);
	}

	return payload as T;
}

export const api = {
	get: <T>(path: string) => request<T>('GET', path),
	post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
	patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
	del: (path: string) => request<void>('DELETE', path),

	// --- WebUI-specific BFF / aggregation endpoints (/api/v1/ui, server pre-computes) ---
	// Token probe + server metadata (login / capability discovery).
	session: () => request<SessionInfo>('GET', '/api/v1/ui/session'),
	// The whole dashboard in one call (overview + traffic + breakdown +
	// peering issues + routing board); server caches ~3s.
	// range: fixed grid distilled from archives (≤200 pts) for traffic AND
	// routing.trend; compare: previous-window overlay for traffic;
	// originsTop/originsSort size the top-origins board; breakdownTop caps the
	// per-node traffic ranking.
	dashboard: (
		opts: {
			trafficLimit?: number;
			range?: '6h' | '24h' | '7d' | '30d';
			compare?: boolean;
			originsSort?: 'count' | 'v4' | 'v6';
			originsTop?: number;
			breakdownTop?: number;
		} = {}
	) => {
		const p = new URLSearchParams();
		p.set('traffic_limit', String(opts.trafficLimit ?? 120));
		if (opts.range) p.set('range', opts.range);
		if (opts.compare) p.set('compare', '1');
		if (opts.originsSort) p.set('origins_sort', opts.originsSort);
		if (opts.originsTop !== undefined) p.set('origins_top', String(opts.originsTop));
		if (opts.breakdownTop !== undefined) p.set('breakdown_top', String(opts.breakdownTop));
		return request<UiDashboard>('GET', `/api/v1/ui/dashboard?${p.toString()}`);
	},
	// Node list with the liveness/health join done server-side.
	listUiNodes: () => request<{ nodes: UiNodeRow[] }>('GET', '/api/v1/ui/nodes'),
	// Sparkline-ready trend series (self-metrics / drift / apply), distilled
	// server-side — replaces pulling raw status-event payloads.
	nodeTrends: (id: string, limit = 50) =>
		request<NodeTrendsOut>('GET', `/api/v1/ui/nodes/${enc(id)}/trends?limit=${limit}`),
	// Slim status-event log (no payloads; newest-first, before_id cursor).
	uiStatusEvents: (
		id: string,
		opts: { kind?: string; limit?: number; beforeId?: number } = {}
	) => {
		const p = new URLSearchParams();
		if (opts.kind) p.set('kind', opts.kind);
		p.set('limit', String(opts.limit ?? 100));
		if (opts.beforeId !== undefined) p.set('before_id', String(opts.beforeId));
		return request<NodeStatusEventsSlim>(
			'GET',
			`/api/v1/ui/nodes/${enc(id)}/status-events?${p.toString()}`
		);
	},
	// Full event (with payload) on demand, when the operator expands a row.
	statusEventDetail: (eventId: number) =>
		request<StatusEvent>('GET', `/api/v1/ui/status-events/${eventId}`),
	nodeTraffic: (
		id: string,
		opts: { limit?: number; range?: '6h' | '24h' | '7d' | '30d'; compare?: boolean } = {}
	) => {
		const p = new URLSearchParams();
		p.set('limit', String(opts.limit ?? 120));
		if (opts.range) p.set('range', opts.range);
		if (opts.compare) p.set('compare', '1');
		return request<NodeTraffic>('GET', `/api/v1/ui/nodes/${enc(id)}/traffic?${p.toString()}`);
	},
	nodeLinks: (id: string) =>
		request<NodeLinks>('GET', `/api/v1/ui/nodes/${enc(id)}/links`),
	nodeBgpSessions: (id: string) =>
		request<NodeBgpSessions>('GET', `/api/v1/ui/nodes/${enc(id)}/bgp-sessions/status`),
	nodeOverview: (id: string) =>
		request<NodeOverview>('GET', `/api/v1/ui/nodes/${enc(id)}/overview`),
	// Route-tuning knobs: server does field-level merges into base_template.bird /
	// session specs, so concurrent editors can't clobber unrelated keys.
	routeTuning: (id: string) =>
		request<RouteTuningView>('GET', `/api/v1/ui/nodes/${enc(id)}/route-tuning`),
	saveRouteTuning: (
		id: string,
		body: { cold_potato_med?: number; route_local_pref?: RouteTuningRule[] }
	) => request<RouteTuningView>('PUT', `/api/v1/ui/nodes/${enc(id)}/route-tuning`, body),
	setLinkLatency: (sid: number, linkLatency: number | null) =>
		request<{ id: number; link_latency: number | null }>(
			'PUT',
			`/api/v1/ui/bgp-sessions/${sid}/link-latency`,
			{ link_latency: linkLatency }
		),
	// Peer-wizard prefill, derived server-side.
	peerDefaults: (id: string) =>
		request<PeerDefaults>('GET', `/api/v1/ui/nodes/${enc(id)}/peer-defaults`),
	// RoutingTab 头部一次取全（summary + origins + timeline），取代 3 次跨网往返。
	routingDashboard: (id: string, originsLimit = 15, timelineLimit = 200) =>
		request<RoutingDashboard>(
			'GET',
			`/api/v1/ui/nodes/${enc(id)}/routing/dashboard` +
				`?origins_limit=${originsLimit}&timeline_limit=${timelineLimit}`
		),

	// --- Routing table (general full-table analysis, admin) ---
	routingPrefixes: (
		id: string,
		opts: {
			family?: '4' | '6';
			scope?: 'all' | 'local' | 'external';
			q?: string;
			limit?: number;
			offset?: number;
		} = {}
	) => {
		const p = new URLSearchParams();
		if (opts.family) p.set('family', opts.family);
		if (opts.scope && opts.scope !== 'all') p.set('scope', opts.scope);
		if (opts.q) p.set('q', opts.q);
		p.set('limit', String(opts.limit ?? 100));
		p.set('offset', String(opts.offset ?? 0));
		return request<RoutingPrefixes>(
			'GET',
			`/api/v1/admin/nodes/${enc(id)}/routing/prefixes?${p.toString()}`
		);
	},

	// iBGP + OSPF internal interconnect (not bgp_sessions records — synthesised
	// from bird.internal_topology; correlated with routing peers for liveness).
	nodeInternalTopology: (id: string) =>
		request<InternalTopologyView>(
			'GET',
			`/api/v1/ui/nodes/${enc(id)}/internal-topology`
		),

	// --- Nodes ---
	listNodes: () => request<NodeOut[]>('GET', '/api/v1/admin/nodes'),
	getNode: (id: string) => request<NodeOut>('GET', `/api/v1/admin/nodes/${enc(id)}`),
	createNode: (body: NodeIn) => request<NodeOut>('POST', '/api/v1/admin/nodes', body),
	updateNode: (id: string, body: NodePatch) =>
		request<NodeOut>('PATCH', `/api/v1/admin/nodes/${enc(id)}`, body),
	deleteNode: (id: string) => request<void>('DELETE', `/api/v1/admin/nodes/${enc(id)}`),
	decommissionNode: (id: string) =>
		request<NodeOut>('POST', `/api/v1/admin/nodes/${enc(id)}/decommission`),
	recommissionNode: (id: string) =>
		request<NodeOut>('POST', `/api/v1/admin/nodes/${enc(id)}/recommission`),
	nodeDesiredState: (id: string) =>
		request<Record<string, unknown>>(
			'GET',
			`/api/v1/admin/nodes/${enc(id)}/desired-state`
		),
	notifyNode: (id: string, event: string, reason?: string) =>
		request<NotifyResponse>('POST', `/api/v1/admin/nodes/${enc(id)}/notify`, {
			event,
			reason
		}),

	// --- Generations ---
	listGenerations: (id: string, limit = 50) =>
		request<GenerationOut[]>(
			'GET',
			`/api/v1/admin/nodes/${enc(id)}/generations?limit=${limit}`
		),
	getGeneration: (id: string, gen: number) =>
		request<GenerationDetailOut>(
			'GET',
			`/api/v1/admin/nodes/${enc(id)}/generations/${gen}`
		),
	diffGeneration: (id: string, gen: number, against?: number) =>
		request<GenerationDiffOut>(
			'GET',
			`/api/v1/admin/nodes/${enc(id)}/generations/${gen}/diff` +
				(against !== undefined ? `?against=${against}` : '')
		),
	rollbackGeneration: (id: string, gen: number, reason?: string) =>
		request<unknown>(
			'POST',
			`/api/v1/admin/nodes/${enc(id)}/generations/${gen}/rollback`,
			{ reason }
		),

	// --- Peerings ---
	listPeerings: (id: string) =>
		request<PeeringOut[]>('GET', `/api/v1/admin/nodes/${enc(id)}/peerings`),
	createPeering: (id: string, body: PeeringIn) =>
		request<PeeringOut>('POST', `/api/v1/admin/nodes/${enc(id)}/peerings`, body),
	updatePeering: (pid: number, body: Partial<PeeringIn>) =>
		request<PeeringOut>('PATCH', `/api/v1/admin/peerings/${pid}`, body),
	deletePeering: (pid: number) =>
		request<void>('DELETE', `/api/v1/admin/peerings/${pid}`),
	// Atomic: peering + interface + all bgp_specs[] sessions in one transaction.
	provisionPeering: (id: string, body: unknown) =>
		request<ProvisionPeeringOut>(
			'POST',
			`/api/v1/admin/nodes/${enc(id)}/peerings/provision`,
			body
		),

	// --- Interfaces ---
	listInterfaces: (id: string) =>
		request<InterfaceOut[]>('GET', `/api/v1/admin/nodes/${enc(id)}/interfaces`),
	createInterface: (id: string, body: unknown) =>
		request<InterfaceOut>('POST', `/api/v1/admin/nodes/${enc(id)}/interfaces`, body),
	updateInterface: (iid: number, body: unknown) =>
		request<InterfaceOut>('PATCH', `/api/v1/admin/interfaces/${iid}`, body),
	deleteInterface: (iid: number) =>
		request<void>('DELETE', `/api/v1/admin/interfaces/${iid}`),

	// --- BGP sessions ---
	listSessions: (id: string) =>
		request<SessionOut[]>('GET', `/api/v1/admin/nodes/${enc(id)}/bgp-sessions`),
	createSession: (id: string, body: unknown) =>
		request<SessionOut>('POST', `/api/v1/admin/nodes/${enc(id)}/bgp-sessions`, body),
	updateSession: (sid: number, body: unknown) =>
		request<SessionOut>('PATCH', `/api/v1/admin/bgp-sessions/${sid}`, body),
	deleteSession: (sid: number) =>
		request<void>('DELETE', `/api/v1/admin/bgp-sessions/${sid}`),

	// --- DNS groups（共享 / anycast）---
	listDnsGroups: () => request<DnsGroupOut[]>('GET', `/api/v1/admin/dns-groups`),
	createDnsGroup: (body: unknown) =>
		request<DnsGroupOut>('POST', `/api/v1/admin/dns-groups`, body),
	updateDnsGroup: (gid: number, body: unknown) =>
		request<DnsGroupOut>('PATCH', `/api/v1/admin/dns-groups/${gid}`, body),
	deleteDnsGroup: (gid: number) => request<void>('DELETE', `/api/v1/admin/dns-groups/${gid}`),
	// 组声明的权威 zone（zone 名 + 可选 SOA 覆盖）。写响应带副作用后的父级摘要
	// （group.zone_count / zone.record_count 已更新）；DELETE 是 200 带 body。
	listGroupZones: (gid: number) =>
		request<DnsGroupZoneOut[]>('GET', `/api/v1/admin/dns-groups/${gid}/zones`),
	createGroupZone: (gid: number, body: unknown) =>
		request<DnsZoneWriteOut>('POST', `/api/v1/admin/dns-groups/${gid}/zones`, body),
	updateGroupZone: (gid: number, zid: number, body: unknown) =>
		request<DnsZoneWriteOut>('PATCH', `/api/v1/admin/dns-groups/${gid}/zones/${zid}`, body),
	deleteGroupZone: (gid: number, zid: number) =>
		request<DnsZoneWriteOut>('DELETE', `/api/v1/admin/dns-groups/${gid}/zones/${zid}`),
	// 扁平记录（name/type/content/ttl/comment），归属某个 zone。
	listZoneRecords: (gid: number, zid: number) =>
		request<DnsRecordOut[]>('GET', `/api/v1/admin/dns-groups/${gid}/zones/${zid}/records`),
	createZoneRecord: (gid: number, zid: number, body: unknown) =>
		request<DnsRecordWriteOut>(
			'POST',
			`/api/v1/admin/dns-groups/${gid}/zones/${zid}/records`,
			body
		),
	updateZoneRecord: (gid: number, zid: number, rid: number, body: unknown) =>
		request<DnsRecordWriteOut>(
			'PATCH',
			`/api/v1/admin/dns-groups/${gid}/zones/${zid}/records/${rid}`,
			body
		),
	deleteZoneRecord: (gid: number, zid: number, rid: number) =>
		request<DnsRecordWriteOut>(
			'DELETE',
			`/api/v1/admin/dns-groups/${gid}/zones/${zid}/records/${rid}`
		),
	// 给节点分配 / 取消（null）DNS 组。
	assignNodeDnsGroup: (id: string, dnsGroupId: number | null) =>
		request<DnsGroupOut | null>('PUT', `/api/v1/admin/nodes/${enc(id)}/dns-group`, {
			dns_group_id: dnsGroupId
		}),

	// --- Agent tokens ---
	listAgentTokens: (id: string) =>
		request<AgentTokenOut[]>('GET', `/api/v1/admin/nodes/${enc(id)}/agent-tokens`),
	issueAgentToken: (id: string, body: unknown) =>
		request<AgentTokenOut>('POST', `/api/v1/admin/nodes/${enc(id)}/agent-tokens`, body),
	rotateAgentToken: (tid: string, body?: unknown) =>
		request<AgentTokenOut>('POST', `/api/v1/admin/agent-tokens/${enc(tid)}/rotate`, body),
	revokeAgentToken: (tid: string) =>
		request<void>('DELETE', `/api/v1/admin/agent-tokens/${enc(tid)}`),

	// --- Enrollment tokens ---
	listEnrollmentTokens: () =>
		request<EnrollmentTokenOut[]>('GET', '/api/v1/admin/enrollment-tokens'),
	createEnrollmentToken: (body: unknown) =>
		request<EnrollmentTokenCreated>('POST', '/api/v1/admin/enrollment-tokens', body),
	deleteEnrollmentToken: (tid: string) =>
		request<void>('DELETE', `/api/v1/admin/enrollment-tokens/${enc(tid)}`),

	// --- Registrations ---
	listRegistrations: (status?: string) =>
		request<{ registrations: Registration[] }>(
			'GET',
			'/api/v1/admin/registrations' + (status ? `?status=${status}` : '')
		),
	approveRegistration: (rid: number, note?: string) =>
		request<Registration>('POST', `/api/v1/admin/registrations/${rid}/approve`, {
			note
		}),
	rejectRegistration: (rid: number, note?: string) =>
		request<Registration>('POST', `/api/v1/admin/registrations/${rid}/reject`, {
			note
		}),

	// --- Agent releases / self-update (global target version) ---
	agentReleases: () => request<ReleasesStatus>('GET', '/api/v1/admin/agent-releases'),
	setAgentTarget: (version: string) =>
		request<ReleasesStatus>('POST', '/api/v1/admin/agent-releases/target', { version }),
	uploadAgentRelease: (version: string, files: File[]) => {
		const fd = new FormData();
		fd.append('version', version);
		for (const f of files) fd.append('files', f, f.name);
		return request<AgentReleaseManifest>('POST', '/api/v1/admin/agent-releases', fd);
	},

	// --- Active probing (ping / mtr / traceroute) ---
	probeStart: (nodeId: string, spec: ProbeSpec) =>
		request<ProbeStarted>('POST', '/api/v1/ui/probes', { node_id: nodeId, spec }),

	// --- Provision + audit ---
	provision: (body: unknown) =>
		request<ProvisionOut>('POST', '/api/v1/admin/provision', body),
	// Cursor-paged audit log with server-side search (q matches actor/method/
	// path, case-insensitive). Newest-first; page backwards via before_id.
	uiAudit: (opts: { limit?: number; beforeId?: number; q?: string } = {}) => {
		const p = new URLSearchParams();
		p.set('limit', String(opts.limit ?? 100));
		if (opts.beforeId !== undefined) p.set('before_id', String(opts.beforeId));
		if (opts.q) p.set('q', opts.q);
		return request<{ entries: AuditEntry[] }>('GET', `/api/v1/ui/audit?${p.toString()}`);
	}
};

/**
 * Subscribe to a probe's live output via SSE.
 *
 * `EventSource` can't send an `Authorization` header, so we read the
 * `text/event-stream` body off `fetch` ourselves (keeps the admin token out of
 * the URL / server logs). Each SSE `data:` line is a JSON `ProbeMessage`;
 * `onMessage` fires per frame until a `done` message arrives or `signal` aborts.
 */
export async function streamProbe(
	probeId: string,
	onMessage: (msg: ProbeMessage) => void,
	signal?: AbortSignal
): Promise<void> {
	const headers: Record<string, string> = { Accept: 'text/event-stream' };
	if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

	let res: Response;
	try {
		res = await fetch(`${auth.apiBase}/api/v1/ui/probes/${enc(probeId)}/stream`, {
			method: 'GET',
			headers,
			signal
		});
	} catch {
		throw new ApiError(0, t('err.network', auth.apiBase), null);
	}

	if (res.status === 401) {
		auth.logout();
		void goto('/login');
		throw new ApiError(401, t('err.unauthorized'), null);
	}
	if (!res.ok || !res.body) {
		throw new ApiError(res.status, `HTTP ${res.status} ${res.statusText}`, null);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			// SSE frames are separated by a blank line ("\n\n").
			let sep: number;
			while ((sep = buf.indexOf('\n\n')) >= 0) {
				const frame = buf.slice(0, sep);
				buf = buf.slice(sep + 2);
				const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
				if (!dataLine) continue;
				try {
					onMessage(JSON.parse(dataLine.slice(5).trim()) as ProbeMessage);
				} catch {
					/* ignore malformed frame */
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function enc(segment: string): string {
	return encodeURIComponent(segment);
}
