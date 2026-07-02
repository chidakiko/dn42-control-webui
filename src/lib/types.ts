// TypeScript mirrors of the control server's admin DTOs.
// Source of truth: apps/control-server/app/api/v1/admin/*.py and schemas/health.py.

export type NodeHealthValue = 'ok' | 'stale' | 'degraded' | 'down' | 'unknown';

export interface NodeOut {
	node_id: string;
	asn: number;
	router_id: string;
	site: string | null;
	loopback_ipv4: string | null;
	loopback_ipv6: string | null;
	link_local: string | null;
	ipv4_prefixes: string[];
	ipv6_prefixes: string[];
	inventory: Record<string, unknown>;
	labels: Record<string, string>;
	base_template: Record<string, unknown>;
	current_generation: number;
	lifecycle: string;
	dns_group_id: number | null;
	created_at: string;
	updated_at: string;
}

export interface NodeIn {
	node_id: string;
	asn: number;
	router_id: string;
	site?: string | null;
	loopback_ipv4?: string | null;
	loopback_ipv6?: string | null;
	link_local?: string | null;
	ipv4_prefixes?: string[];
	ipv6_prefixes?: string[];
	inventory?: Record<string, unknown>;
	labels?: Record<string, string>;
	base_template?: Record<string, unknown>;
}

export type NodePatch = Partial<Omit<NodeIn, 'node_id'>>;

export interface NodeHealthRow {
	node_id: string;
	health: NodeHealthValue;
	desired_generation: number | null;
	observed_generation: number | null;
	last_report_status: string | null;
	last_apply_status: string | null;
	drift_count: number;
	last_snapshot_at: string | null;
	last_report_at: string | null;
	last_apply_at: string | null;
	updated_at: string | null;
}

// Aggregate dashboard payload: health rows (+ capabilities) + the physical WG mesh
// links, in one call (replaces N per-node internal-topology fetches).
// Agent liveness + version, folded into the /ui overview rows from the
// heartbeat-fed registry. All null for agents never heard from (or after a
// control-server restart, until the next heartbeat ~30s later).
// `liveness` is server-graded (75s/300s thresholds live on the control server);
// never-heard-from agents grade as "offline".
export type AgentLiveness = 'online' | 'stale' | 'offline';
export interface AgentLivenessFields {
	agent_version: string | null;
	last_heartbeat_at: string | null; // ISO 8601
	agent_up_to_date: boolean | null; // null = no global target set, or never seen
	liveness: AgentLiveness;
}

// Server-resolved placement for a node (the site→geo registry lives on the
// control server now). `city` is null when the site code is unknown and the
// lat/lon fall back to the DN42 region centre; the whole object is null when
// nothing is known. `country` is ISO 3166-1 alpha-2.
export interface NodeGeo {
	lat: number;
	lon: number;
	city: string | null;
	country: string | null;
	region: number | null;
}

// Fleet-wide liveness/version aggregation (server-computed). Top-level field on
// FleetOverview — deliberately NOT merged into `summary`, whose keys are health
// values ("stale" would collide across the two meanings).
export interface AgentSummary {
	online: number;
	stale: number;
	offline: number;
	agents_behind: number;
}

export interface FleetOverviewNode extends NodeHealthRow, AgentLivenessFields {
	capabilities: string[];
	// Node identity bits for map placement: `site` is the city/datacenter code
	// (resolved against the geo registry → coords + country), `region` is the
	// DN42 standard origin-region community (41..57). Both null until the node
	// has a DesiredState.
	site: string | null;
	region: number | null;
	geo: NodeGeo | null;
}
export interface FleetLink {
	a: string;
	b: string;
	a_iface: string | null;
	b_iface: string | null;
	cost: number | null;
}
export interface FleetOverview {
	summary: Partial<Record<NodeHealthValue, number>>;
	agent_summary: AgentSummary;
	agent_target_version: string | null;
	nodes: FleetOverviewNode[];
	links: FleetLink[];
}

export interface StatusEvent {
	id: number;
	kind: string;
	generation: number | null;
	status: string | null;
	created_at: string | null;
	payload: Record<string, unknown>;
}

// One reconcile drift item, as carried in a report event's payload.drift.
// Mirrors dn42_schemas.DriftItem.
export type DriftSeverity = 'info' | 'warning' | 'critical';
export interface DriftItem {
	component: string;
	name: string;
	severity: DriftSeverity;
	message: string;
	desired?: string | null;
	observed?: string | null;
}

// agent 进程自观测，随 RuntimeSnapshot 上报、落在 last_snapshot.self_metrics。
// 全可选——旧 agent / 尚未采到时为 null。镜像 dn42_schemas.AgentSelfMetrics。
export interface AgentSelfMetrics {
	cpu_percent: number | null;
	rss_mb: number | null;
	last_routing_collect_seconds: number | null;
	last_reresolve_seconds: number | null;
	last_reconcile_duration_seconds: number | null;
	total_reconciles: number | null;
	total_failures: number | null;
	consecutive_failures: number | null;
	self_observed_at: string | null;
	last_reconcile_at: string | null;
}

// Slim status-event list row (GET /ui/nodes/{id}/status-events): no payload —
// report rows carry the pre-extracted drift_count instead. Full payload comes
// from GET /ui/status-events/{id} on demand. List stays newest-first (log
// semantics, paged via before_id).
export interface StatusEventSummary {
	id: number;
	kind: string;
	generation: number | null;
	status: string | null;
	created_at: string | null;
	drift_count?: number | null;
}
export interface NodeStatusEventsSlim {
	node_id: string;
	events: StatusEventSummary[];
}

// GET /ui/nodes/{id}/trends — sparkline-ready series distilled server-side from
// the snapshot/report/apply event history. All series are chronological
// (oldest→newest). A never-reported node yields 200 with null currents / empty
// series (404 is reserved for "node does not exist").
export interface TrendsSelfMetricsPoint {
	at: string;
	cpu_percent: number | null;
	rss_mb: number | null;
	last_routing_collect_seconds: number | null;
	last_reresolve_seconds: number | null;
}
export interface NodeTrendsOut {
	node_id: string;
	// series distillation time (as-of stamp)
	generated_at?: string;
	self_metrics: {
		current: AgentSelfMetrics | null;
		series: TrendsSelfMetricsPoint[];
	};
	drift: {
		current: number;
		series: { at: string; count: number }[];
	};
	apply: {
		total: number;
		succeeded: number;
		last_status: string | null;
		last_at: string | null;
		series: { at: string; status: string | null }[];
	};
}

// WebUI-specific observability aggregates (server pre-computes these).
// In `?range=` grid mode the series is a fixed-length bucket grid: buckets with
// no data carry null rates (gaps, not fabricated zeros).
export interface TrafficPoint {
	captured_at: string | null;
	rx_bytes_per_sec: number | null;
	tx_bytes_per_sec: number | null;
}
export interface NodeTraffic {
	node_id: string;
	points: TrafficPoint[];
	// `?compare=1`: the immediately-preceding window, same bucket size and
	// count as `points` — overlay by index.
	points_previous?: TrafficPoint[];
}
export interface FleetTraffic {
	points: TrafficPoint[];
	points_previous?: TrafficPoint[];
}
export interface NodeTrafficNow {
	node_id: string;
	rx_bytes_per_sec: number;
	tx_bytes_per_sec: number;
}
export interface PeerTrafficNow {
	node_id: string;
	interface: string | null;
	public_key: string | null;
	endpoint: string | null;
	rx_bytes_per_sec: number;
	tx_bytes_per_sec: number;
}
export interface FleetTrafficBreakdown {
	nodes: NodeTrafficNow[];
	peers: PeerTrafficNow[];
}
export interface LinkStatus {
	interface: string | null;
	type: string;
	public_key: string | null;
	endpoint: string | null;
	last_handshake_seconds: number | null;
	transfer_rx_bytes: number;
	transfer_tx_bytes: number;
	status: string; // up / stale / down
}
export interface NodeLinks {
	node_id: string;
	links: LinkStatus[];
}
export interface BgpSessionStatus {
	name: string | null;
	session: string | null;
	scope: string; // internal / external
	state: string | null;
	health: string; // up / connecting / down
	since: string | null;
	info: string | null;
}
export interface PeeringIssue extends BgpSessionStatus {
	node_id: string;
}
export interface FleetPeeringIssues {
	issues: PeeringIssue[];
}
export interface NodeBgpSessions {
	node_id: string;
	sessions: BgpSessionStatus[];
}

// One-shot node page payload — health row + everything the overview/status columns
// need, so the page fetches once instead of 4× nodeHealth + parsing last_snapshot.
// Embeds the full node record (+ resolved dns_group name and geo), so the page no
// longer pairs this with GET /admin/nodes/{id}. 404 only when the node doesn't
// exist; a never-reported node returns a health:"unknown" skeleton + full `node`.
export interface NodeOverview extends NodeHealthRow, AgentLivenessFields {
	capabilities: string[];
	self_metrics: AgentSelfMetrics | null;
	drift: DriftItem[];
	links: LinkStatus[];
	bgp_sessions: BgpSessionStatus[];
	agent_target_version: string | null;
	node: NodeOut;
	dns_group: { id: number; name: string } | null;
	geo: NodeGeo | null;
}

// GET /ui/nodes — node list rows with the liveness/health join done server-side
// (replaces the client-side listNodes + fleetOverview merge). Carries NodeOut's
// scalar fields but not the heavy base_template / inventory blobs.
export interface UiNodeRow extends AgentLivenessFields {
	node_id: string;
	asn: number;
	router_id: string;
	site: string | null;
	loopback_ipv4: string | null;
	loopback_ipv6: string | null;
	link_local: string | null;
	ipv4_prefixes: string[];
	ipv6_prefixes: string[];
	labels: Record<string, string>;
	current_generation: number;
	lifecycle: string;
	dns_group_id: number | null;
	created_at: string;
	updated_at: string;
	health: NodeHealthValue;
}

export interface GenerationOut {
	generation: number;
	reason: string | null;
	published_at: string;
}

export interface GenerationDetailOut extends GenerationOut {
	snapshot: Record<string, unknown>;
}

export interface GenerationDiffOut {
	node_id: string;
	from_generation: number;
	to_generation: number;
	changed: boolean;
	changes: Array<Record<string, unknown>>;
}

export interface PeeringOut {
	id: number;
	local_node_id: string;
	remote_node_id: string | null;
	name: string;
	remote_asn: number;
	remote_label: string | null;
	is_internal: boolean;
	enabled: boolean;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

export interface PeeringIn {
	name: string;
	remote_asn: number;
	remote_node_id?: string | null;
	remote_label?: string | null;
	is_internal?: boolean;
	enabled?: boolean;
	notes?: string | null;
}

export interface InterfaceOut {
	id: number;
	node_id: string;
	peering_id: number | null;
	name: string;
	kind: string;
	enabled: boolean;
	sort_order: number;
	spec: Record<string, unknown>;
}

export interface SessionOut {
	id: number;
	node_id: string;
	peering_id: number | null;
	name: string;
	remote_asn: number;
	enabled: boolean;
	sort_order: number;
	spec: Record<string, unknown>;
}

// --- Route tuning (GET/PUT /ui/nodes/{id}/route-tuning) ---
// The server does field-level merging into base_template.bird / session specs,
// so the browser never round-trips raw JSON blobs (no lost-update races).
export interface RouteTuningRule {
	prefix: string;
	local_pref: number;
}
export interface RouteTuningSession {
	id: number;
	name: string;
	remote_asn: number;
	link_latency: number | null;
}
export interface RouteTuningView {
	node_id: string;
	cold_potato_med: number;
	route_local_pref: RouteTuningRule[];
	sessions: RouteTuningSession[];
	updated_at?: string | null;
}

// GET /ui/nodes/{id}/peer-defaults — the peer wizard's prefill, derived
// server-side (node WG key reuse + the house link-local convention).
export interface PeerDefaults {
	node_id: string;
	wireguard: {
		private_key_ref: string | null;
		link_local: string | null;
		used_listen_ports: number[];
	};
}

// POST /admin/nodes/{id}/peerings/provision with bgp_specs[] — everything is
// created in one transaction (no partial-success states).
export interface ProvisionPeeringOut {
	peering: PeeringOut;
	interface: InterfaceOut;
	sessions: SessionOut[];
}

export interface DnsGroupOut {
	id: number;
	name: string;
	bind_addresses: string[];
	cache_ttl_seconds: number;
	forwards: Record<string, unknown>[];
	enabled: boolean;
	zone_count: number;
	member_count: number;
	created_at: string;
	updated_at: string;
}

export interface DnsGroupZoneOut {
	id: number;
	dns_group_id: number;
	zone: string;
	primary_ns: string | null;
	admin_email: string | null;
	soa_refresh: number | null;
	soa_retry: number | null;
	soa_expire: number | null;
	soa_minimum: number | null;
	default_ttl: number | null;
	enabled: boolean;
	record_count: number;
	created_at: string;
	updated_at: string;
}

export interface DnsRecordOut {
	id: number;
	dns_group_zone_id: number;
	name: string;
	type: string;
	content: string;
	ttl: number | null;
	comment: string | null;
	enabled: boolean;
	sort_order: number;
	created_at: string;
	updated_at: string;
}

// DNS zone/record write responses carry the freshly-recounted parent, so the UI
// can update zone_count/record_count in place instead of double-refreshing.
// DELETE returns 200 with this body (not 204) — `zone`/`record` is null then.
export interface DnsZoneWriteOut {
	zone: DnsGroupZoneOut | null;
	group: DnsGroupOut;
}
export interface DnsRecordWriteOut {
	record: DnsRecordOut | null;
	zone: DnsGroupZoneOut;
}

export interface AgentTokenOut {
	token: string;
	secret: string | null;
	node_id: string;
	agent_id: string;
	issued_at: string;
	expires_at: string | null;
	revoked_at: string | null;
}

export interface EnrollmentTokenOut {
	token_id: string;
	node_id: string | null;
	description: string | null;
	expires_at: string | null;
	used_at: string | null;
	created_at: string;
}

export interface EnrollmentTokenCreated extends EnrollmentTokenOut {
	secret: string;
}

export interface Registration {
	id: number;
	node_id: string;
	agent_id?: string | null;
	status: 'pending' | 'approved' | 'rejected';
	inventory?: Record<string, unknown>;
	note?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	[key: string]: unknown;
}

export interface AuditEntry {
	id: number;
	actor: string | null;
	method: string;
	path: string;
	status_code: number;
	detail: Record<string, unknown>;
	created_at?: string | null;
	[key: string]: unknown;
}

// --- Routing table (Radar-style full-table analysis) ---

export interface RpkiCounts {
	valid: number;
	invalid: number;
	not_found: number;
}

export interface RouteEntry {
	prefix: string;
	origin_asn: number | null;
	as_path: number[];
	next_hop: string | null;
	protocol: string | null;
	primary: boolean;
	local: boolean;
	communities: string[];
	large_communities: string[];
	rpki: string | null;
}

export interface RoutingSummary {
	node_id: string;
	observation: string;
	captured_at: string | null;
	updated_at: string | null;
	route_count: number;
	route_count_v4: number;
	route_count_v6: number;
	local_count: number;
	rpki: RpkiCounts;
	rpki_observed: boolean;
	// { "4": { "24": n, ... }, "6": { "48": n, ... } }
	prefix_lengths: Record<string, Record<string, number>>;
	// { "<as_path_len>": n }
	as_path_lengths: Record<string, number>;
	peers: Array<{ protocol: string; count: number }>;
	prefilter: PrefilterRpki | null;
}

export interface PrefilterPeer {
	protocol: string;
	remote_asn: number | null;
	received: number;
	accepted: number;
	valid: number;
	invalid: number;
	not_found: number;
}

export interface PrefilterRoute {
	prefix: string;
	origin_asn: number | null;
	protocol: string;
	// 仅 filtered_routes：out_of_range | self_net | as_path_too_long | blocked_asn | policy
	reason?: string | null;
}

export interface PrefilterRpki {
	received: number;
	accepted: number;
	valid: number;
	invalid: number;
	not_found: number;
	peers: PrefilterPeer[];
	invalid_routes: PrefilterRoute[];
	filtered_routes: PrefilterRoute[];
}

export interface RoutingOrigins {
	node_id: string;
	total: number;
	origins: Array<{ asn: number; count: number }>;
}

export interface RoutingPrefixes {
	node_id: string;
	total: number;
	limit: number;
	offset: number;
	routes: RouteEntry[];
}

export interface RoutingTimelineEvent {
	id: number;
	captured_at: string | null;
	created_at: string | null;
	route_count: number;
	route_count_v4: number;
	route_count_v6: number;
	rpki: RpkiCounts;
	announced: number;
	withdrawn: number;
}

export interface RoutingTimeline {
	node_id: string;
	events: RoutingTimelineEvent[];
}

export interface RoutingDashboard {
	node_id: string;
	summary: RoutingSummary;
	origins: RoutingOrigins;
	timeline: RoutingTimeline;
}

export interface FleetRoutingNode {
	node_id: string;
	observation: string;
	captured_at: string | null;
	route_count: number;
	route_count_v4: number;
	route_count_v6: number;
	rpki: RpkiCounts;
}

export interface FleetRouting {
	summary: {
		route_count: number;
		route_count_v4: number;
		route_count_v6: number;
		rpki: RpkiCounts;
		// per-family RPKI splits (same fleet-wide aggregation as `rpki`)
		rpki_v4: RpkiCounts;
		rpki_v6: RpkiCounts;
		// distinct origin ASes in the RIB (fleet-wide dedup; per-family dedup
		// separately — the same AS can count on both sides)
		as_count: number;
		as_count_v4: number;
		as_count_v6: number;
		nodes_reporting: number;
	};
	nodes: FleetRoutingNode[];
}

export interface FleetRoutingTrendPoint {
	captured_at: string | null;
	size: number; // total (= v4 + v6), kept for compatibility
	size_v4: number;
	size_v6: number;
	announced: number;
	withdrawn: number;
}

export interface OriginEntry {
	asn: number;
	count: number;
	count_v4: number;
	count_v6: number;
}

export interface FleetRoutingOverview {
	summary: FleetRouting['summary'];
	nodes: FleetRoutingNode[];
	// newest routing snapshot among the aggregated nodes (as-of stamp)
	captured_at: string | null;
	trend: FleetRoutingTrendPoint[];
	origins: OriginEntry[];
	invalid_routes: Array<{ prefix: string; origin_asn: number | null; node_count: number }>;
}

// GET /ui/dashboard — the whole dashboard in one call (server caches ~3s).
// Each block is field-for-field identical to its fine-grained endpoint;
// peering_issues is the bare issue array.
export interface UiDashboard {
	// server-side aggregation time (cache-generation time on TTL hits) — the
	// widgets' "updated at" stamp
	generated_at: string;
	overview: FleetOverview;
	traffic: FleetTraffic;
	traffic_breakdown: FleetTrafficBreakdown;
	peering_issues: PeeringIssue[];
	routing: FleetRoutingOverview;
}

// GET /ui/session — token probe + server metadata. 401 = bad token, 403 =
// locked out. heartbeat_interval_seconds is the fleet-wide agent default.
export interface SessionInfo {
	authenticated: boolean;
	scope: string;
	server_version: string;
	agent_target_version: string | null;
	heartbeat_interval_seconds: number;
	liveness_thresholds: { online_seconds: number; stale_seconds: number };
	features: string[];
}

// iBGP/OSPF are not bgp_sessions records — they are synthesised from
// bird.internal_topology. This view (GET /ui/nodes/{id}/internal-topology)
// exposes that config plus a routing-derived liveness hint (rib_routes).
export interface IbgpPeerView {
	node: string;
	ownip: string;
	ownip6: string;
	protocol: string;
	rib_routes: number;
	in_rib: boolean;
}

export interface OspfNeighborView {
	node: string;
	interface: string | null;
	cost: number | null;
	iface_type: string;
}

export interface OspfProtocolView {
	protocol: string;
	rib_routes: number;
	in_rib: boolean;
}

export interface InternalTopologyView {
	node_id: string;
	configured: boolean;
	full_mesh_ibgp: boolean;
	ospf_v2: boolean;
	ospf_v3: boolean;
	routers: string[];
	ibgp_peers: IbgpPeerView[];
	ospf_neighbors: OspfNeighborView[];
	ospf: OspfProtocolView[];
	// rib_routes liveness is only as fresh as the last routing snapshot.
	routing_observed: boolean;
	captured_at: string | null;
}

export interface NotifyResponse {
	node_id: string;
	event: string;
	generation: number | null;
	subscribers: number;
	delivered: number;
}

export interface ProvisionOut {
	node_id: string;
	generation: number;
	subscribers: number;
	delivered: number;
}

// --- Agent releases / self-update (global target version model) ---
// Source: control-server app/api/v1/admin/agent_releases.py. Liveness + version
// come from the WS-heartbeat-fed in-memory AgentLivenessRegistry, so `nodes`
// only lists agents heard from since the control server last started.

export interface NodeVersionOut {
	node_id: string;
	agent_version: string;
	applied_generation: number | null;
	apply_status: string | null;
	last_seen: string; // ISO 8601 — when control received the last heartbeat
	up_to_date: boolean; // agent_version === target
	liveness: AgentLiveness; // server-graded, same thresholds as the fleet rows
}

export interface ReleasesStatus {
	target: string | null; // global target version (null until set)
	versions: string[]; // uploaded release versions
	nodes: NodeVersionOut[];
}

export interface AgentWheel {
	filename: string;
	sha256: string;
	size: number;
}

export interface AgentReleaseManifest {
	version: string;
	wheels: AgentWheel[];
}

// --- Active probing (ping / mtr / traceroute) ---
export type ProbeTool = 'ping' | 'mtr' | 'traceroute';

export interface ProbeSpec {
	tool: ProbeTool;
	target: string;
	count?: number;
	// Resolve per-hop addresses to rDNS names (mtr shows IP + hostname, traceroute
	// shows "hostname (IP)"); off = numeric only. Ignored by ping.
	resolve?: boolean;
}

export interface ProbeStarted {
	probe_id: string;
}

export interface ProbeOutput {
	type: 'output';
	probe_id: string;
	seq: number;
	stream: 'stdout' | 'stderr';
	text: string;
}

export interface ProbeDone {
	type: 'done';
	probe_id: string;
	exit_code: number | null;
	error: string | null;
}

export type ProbeMessage = ProbeOutput | ProbeDone;
