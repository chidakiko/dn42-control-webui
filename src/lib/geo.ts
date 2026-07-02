// Geo presentation helpers for the fleet map / node headers.
//
// The site→coordinate/country/region REGISTRY lives on the control server now
// (adding a datacenter no longer requires a webui release): every node row from
// the /ui endpoints carries a server-resolved `geo` object (lat/lon, city name,
// ISO alpha-2 country, DN42 region; lat/lon fall back to the region centre when
// the site code is unknown). What remains here is pure presentation:
//
//   - DN42 region community names (41..57) — protocol-standard, static.
//   - country display names via Intl.DisplayNames (localised for free).
//   - single-city areas (SARs etc.) where the map/list tree skips the
//     redundant city level under the country.
//   - the adapter that turns a server NodeGeo into the ResolvedGeo shape the
//     FleetMap clustering/tree code consumes.

import type { NodeGeo } from './types';

export type RegionCode = number; // 41..57

// DN42 origin-region communities (64511, 41..57): https://dn42.dev/howto/Bird-communities
export const REGION_NAMES: Record<RegionCode, string> = {
	41: 'Europe',
	42: 'North America-E',
	43: 'North America-C',
	44: 'North America-W',
	45: 'Central America',
	46: 'South America-E',
	47: 'South America-W',
	48: 'Africa-N',
	49: 'Africa-S',
	50: 'Asia-S',
	51: 'Asia-SE',
	52: 'Asia-E',
	53: 'Pacific & Oceania',
	54: 'Antarctica',
	55: 'Asia-N',
	56: 'Asia-W',
	57: 'Central Asia'
};

// Areas that map to a single city (SARs / city-states): the tree hangs nodes
// straight off the country, skipping the redundant city sublevel.
const SINGLE_CITY = new Set(['HK', 'MO', 'SG']);

// Localised country names from the alpha-2 code; falls back to the raw code on
// exotic runtimes. Instantiated lazily so SSR/prerender never trips on it.
let displayNames: Intl.DisplayNames | null | undefined;
function countryName(alpha2: string): string {
	if (displayNames === undefined) {
		try {
			displayNames = new Intl.DisplayNames(undefined, { type: 'region' });
		} catch {
			displayNames = null;
		}
	}
	try {
		return displayNames?.of(alpha2) ?? alpha2;
	} catch {
		return alpha2;
	}
}

export interface ResolvedGeo {
	/** city-level cluster key: the node's site code when it resolved to a known city. */
	site: string | null;
	cityName: string | null;
	/** ISO 3166-1 alpha-2, or null when unknown. */
	country: string | null;
	countryName: string | null;
	/** true when the area maps to a single city (the city level is redundant). */
	countrySingleCity: boolean;
	region: RegionCode | null;
	regionName: string | null;
	/** placement coordinate [lat, lon], or null when nothing is known. */
	coord: [number, number] | null;
}

/** Adapt a server-resolved NodeGeo (+ the node's raw site code) for the map. */
export function fromNodeGeo(geo: NodeGeo | null | undefined, site?: string | null): ResolvedGeo {
	if (!geo) {
		return {
			site: null,
			cityName: null,
			country: null,
			countryName: null,
			countrySingleCity: false,
			region: null,
			regionName: null,
			coord: null
		};
	}
	const alpha2 = geo.country ? geo.country.toUpperCase() : null;
	return {
		// only a registry-matched site is a valid city cluster key; when the server
		// fell back to the region centre (city null), unknown sites must not fan
		// out into bogus one-node "cities".
		site: geo.city != null && site ? site.trim().toLowerCase() : null,
		cityName: geo.city,
		country: alpha2,
		countryName: alpha2 ? countryName(alpha2) : null,
		countrySingleCity: alpha2 ? SINGLE_CITY.has(alpha2) : false,
		region: geo.region,
		regionName: geo.region != null ? (REGION_NAMES[geo.region] ?? null) : null,
		coord: [geo.lat, geo.lon]
	};
}

/** Human location label for headers: city → country → region → raw site code. */
export function geoLabel(geo: NodeGeo | null | undefined, site?: string | null): string {
	const g = fromNodeGeo(geo, site);
	return g.cityName ?? g.countryName ?? g.regionName ?? site ?? '—';
}
