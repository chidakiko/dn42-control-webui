// Geographic taxonomy for the fleet map: a single source of truth that turns a
// node's `site` (city/datacenter code) into coordinates, country and DN42 region.
//
// The convention is three nested levels, mirroring DN42's BGP community model:
//
//   Region (DN42 origin-region community, 41..57)
//     └─ Country / area (ISO-3166-1 numeric)
//          └─ City / site (the IATA city/metropolitan code stored as `site`)
//
// City code convention: the node's `site` is the IATA CITY / METROPOLITAN code —
// one code per city, not per airport (Tokyo `tyo` not nrt/hnd, Shanghai `sha` not
// pvg, New York `nyc` not jfk). DN42 itself standardises only the region (41..57)
// and country (ISO-3166-1 numeric) communities; the city layer is this convention.
//
// Region and country are DERIVED from the city: each city carries its ISO numeric
// country, and each country carries its DN42 region. So adding a node only means
// making sure its `site` code exists in CITIES below. The node's own `region`
// field (authoritative, set on the backend) still wins when present; the derived
// region is the fallback.
//
// Refs:
//   - DN42 region communities (64511, 41..57): https://dn42.dev/howto/Bird-communities
//   - ISO-3166-1 numeric: https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes

export type RegionCode = number; // 41..57

export interface RegionInfo {
	name: string;
	/** Representative centre [lat, lon] for region-level clustering / fallback. */
	center: [number, number];
}

export interface CountryInfo {
	name: string;
	alpha2: string;
	region: RegionCode;
}

export interface CityInfo {
	name: string;
	lat: number;
	lon: number;
	/** ISO-3166-1 numeric country code (region is derived from it). */
	country: number;
	/** Override the country's default region (e.g. the US spans E/C/W). */
	region?: RegionCode;
}

// --- DN42 origin-region communities (41..57) ---------------------------------
export const REGIONS: Record<RegionCode, RegionInfo> = {
	41: { name: 'Europe', center: [50, 9] },
	42: { name: 'North America-E', center: [41, -74] },
	43: { name: 'North America-C', center: [40, -97] },
	44: { name: 'North America-W', center: [37, -120] },
	45: { name: 'Central America', center: [17, -92] },
	46: { name: 'South America-E', center: [-15, -47] },
	47: { name: 'South America-W', center: [-16, -72] },
	48: { name: 'Africa-N', center: [27, 13] },
	49: { name: 'Africa-S', center: [-26, 26] },
	50: { name: 'Asia-S', center: [22, 78] },
	51: { name: 'Asia-SE', center: [4, 108] },
	52: { name: 'Asia-E', center: [31, 116] },
	53: { name: 'Pacific & Oceania', center: [-30, 150] },
	54: { name: 'Antarctica', center: [-78, 0] },
	55: { name: 'Asia-N', center: [60, 90] },
	56: { name: 'Asia-W', center: [33, 48] },
	57: { name: 'Central Asia', center: [43, 68] }
};

// --- Countries / areas (ISO-3166-1 numeric → DN42 region) --------------------
// Only the countries that have cities below (plus a few likely ones) are listed;
// extend freely. The +1000 BGP country community is just `1000 + numeric`.
export const COUNTRIES: Record<number, CountryInfo> = {
	// Asia-East (52)
	156: { name: 'China', alpha2: 'CN', region: 52 },
	344: { name: 'Hong Kong', alpha2: 'HK', region: 52 },
	446: { name: 'Macao', alpha2: 'MO', region: 52 },
	158: { name: 'Taiwan', alpha2: 'TW', region: 52 },
	392: { name: 'Japan', alpha2: 'JP', region: 52 },
	410: { name: 'South Korea', alpha2: 'KR', region: 52 },
	// Asia-Southeast (51)
	702: { name: 'Singapore', alpha2: 'SG', region: 51 },
	764: { name: 'Thailand', alpha2: 'TH', region: 51 },
	458: { name: 'Malaysia', alpha2: 'MY', region: 51 },
	360: { name: 'Indonesia', alpha2: 'ID', region: 51 },
	608: { name: 'Philippines', alpha2: 'PH', region: 51 },
	704: { name: 'Vietnam', alpha2: 'VN', region: 51 },
	// Asia-South (50)
	356: { name: 'India', alpha2: 'IN', region: 50 },
	586: { name: 'Pakistan', alpha2: 'PK', region: 50 },
	50: { name: 'Bangladesh', alpha2: 'BD', region: 50 },
	// Asia-West (56)
	364: { name: 'Iran', alpha2: 'IR', region: 56 },
	792: { name: 'Turkey', alpha2: 'TR', region: 56 },
	784: { name: 'United Arab Emirates', alpha2: 'AE', region: 56 },
	376: { name: 'Israel', alpha2: 'IL', region: 56 },
	// Central Asia (57)
	860: { name: 'Uzbekistan', alpha2: 'UZ', region: 57 },
	398: { name: 'Kazakhstan', alpha2: 'KZ', region: 57 },
	// Asia-North (55)
	643: { name: 'Russia', alpha2: 'RU', region: 55 },
	// Europe (41)
	276: { name: 'Germany', alpha2: 'DE', region: 41 },
	528: { name: 'Netherlands', alpha2: 'NL', region: 41 },
	826: { name: 'United Kingdom', alpha2: 'GB', region: 41 },
	250: { name: 'France', alpha2: 'FR', region: 41 },
	756: { name: 'Switzerland', alpha2: 'CH', region: 41 },
	578: { name: 'Norway', alpha2: 'NO', region: 41 },
	752: { name: 'Sweden', alpha2: 'SE', region: 41 },
	246: { name: 'Finland', alpha2: 'FI', region: 41 },
	616: { name: 'Poland', alpha2: 'PL', region: 41 },
	40: { name: 'Austria', alpha2: 'AT', region: 41 },
	380: { name: 'Italy', alpha2: 'IT', region: 41 },
	724: { name: 'Spain', alpha2: 'ES', region: 41 },
	620: { name: 'Portugal', alpha2: 'PT', region: 41 },
	208: { name: 'Denmark', alpha2: 'DK', region: 41 },
	372: { name: 'Ireland', alpha2: 'IE', region: 41 },
	56: { name: 'Belgium', alpha2: 'BE', region: 41 },
	203: { name: 'Czechia', alpha2: 'CZ', region: 41 },
	642: { name: 'Romania', alpha2: 'RO', region: 41 },
	804: { name: 'Ukraine', alpha2: 'UA', region: 41 },
	// North America (42 East / 43 Central / 44 West) — region set per-city below
	840: { name: 'United States', alpha2: 'US', region: 42 },
	124: { name: 'Canada', alpha2: 'CA', region: 44 },
	// Central America (45)
	484: { name: 'Mexico', alpha2: 'MX', region: 45 },
	// South America (46 East / 47 West)
	76: { name: 'Brazil', alpha2: 'BR', region: 46 },
	152: { name: 'Chile', alpha2: 'CL', region: 47 },
	604: { name: 'Peru', alpha2: 'PE', region: 47 },
	// Africa (48 North / 49 South)
	818: { name: 'Egypt', alpha2: 'EG', region: 48 },
	710: { name: 'South Africa', alpha2: 'ZA', region: 49 },
	// Pacific & Oceania (53)
	36: { name: 'Australia', alpha2: 'AU', region: 53 },
	554: { name: 'New Zealand', alpha2: 'NZ', region: 53 }
};

// --- Cities / sites (the node `site` code) -----------------------------------
// CONVENTION: the canonical `site` is the IATA city / metropolitan code — one code
// per city, NOT per airport. So Tokyo is `tyo` (not nrt/hnd), Shanghai `sha` (not
// pvg), Beijing `bjs` (not pek), Seoul `sel` (not icn), New York `nyc` (not jfk),
// Jakarta `jkt` (not cgk). Where a city has no separate metropolitan code, its
// primary airport code doubles as the city code (e.g. szx, dxb, sfo).
//
// The US spans three DN42 regions, so US/Canada cities carry an explicit `region`
// override (the country default would otherwise put them all in North America-E).
export const CITIES: Record<string, CityInfo> = {
	// China
	bjs: { name: 'Beijing', lat: 39.9, lon: 116.41, country: 156 },
	sha: { name: 'Shanghai', lat: 31.23, lon: 121.47, country: 156 },
	can: { name: 'Guangzhou', lat: 23.13, lon: 113.26, country: 156 },
	szx: { name: 'Shenzhen', lat: 22.54, lon: 114.06, country: 156 },
	ctu: { name: 'Chengdu', lat: 30.57, lon: 104.07, country: 156 },
	hgh: { name: 'Hangzhou', lat: 30.27, lon: 120.15, country: 156 },
	wuh: { name: 'Wuhan', lat: 30.59, lon: 114.31, country: 156 },
	hkg: { name: 'Hong Kong', lat: 22.32, lon: 114.17, country: 344 },
	mfm: { name: 'Macao', lat: 22.16, lon: 113.55, country: 446 },
	tpe: { name: 'Taipei', lat: 25.03, lon: 121.57, country: 158 },
	khh: { name: 'Kaohsiung', lat: 22.63, lon: 120.3, country: 158 },
	// Japan / Korea
	tyo: { name: 'Tokyo', lat: 35.68, lon: 139.77, country: 392 },
	osa: { name: 'Osaka', lat: 34.69, lon: 135.5, country: 392 },
	sel: { name: 'Seoul', lat: 37.57, lon: 126.98, country: 410 },
	// Southeast Asia
	sin: { name: 'Singapore', lat: 1.35, lon: 103.82, country: 702 },
	bkk: { name: 'Bangkok', lat: 13.75, lon: 100.5, country: 764 },
	kul: { name: 'Kuala Lumpur', lat: 3.14, lon: 101.69, country: 458 },
	jkt: { name: 'Jakarta', lat: -6.21, lon: 106.85, country: 360 },
	mnl: { name: 'Manila', lat: 14.6, lon: 120.98, country: 608 },
	sgn: { name: 'Ho Chi Minh City', lat: 10.82, lon: 106.63, country: 704 },
	han: { name: 'Hanoi', lat: 21.03, lon: 105.85, country: 704 },
	// South Asia
	bom: { name: 'Mumbai', lat: 19.08, lon: 72.88, country: 356 },
	del: { name: 'Delhi', lat: 28.61, lon: 77.21, country: 356 },
	blr: { name: 'Bangalore', lat: 12.97, lon: 77.59, country: 356 },
	maa: { name: 'Chennai', lat: 13.08, lon: 80.27, country: 356 },
	khi: { name: 'Karachi', lat: 24.86, lon: 67.0, country: 586 },
	dac: { name: 'Dhaka', lat: 23.81, lon: 90.41, country: 50 },
	// West / Central / North Asia
	thr: { name: 'Tehran', lat: 35.69, lon: 51.39, country: 364 },
	ist: { name: 'Istanbul', lat: 41.01, lon: 28.98, country: 792 },
	dxb: { name: 'Dubai', lat: 25.2, lon: 55.27, country: 784 },
	tlv: { name: 'Tel Aviv', lat: 32.07, lon: 34.79, country: 376 },
	tas: { name: 'Tashkent', lat: 41.3, lon: 69.24, country: 860 },
	ala: { name: 'Almaty', lat: 43.24, lon: 76.89, country: 398 },
	mow: { name: 'Moscow', lat: 55.76, lon: 37.62, country: 643 },
	led: { name: 'Saint Petersburg', lat: 59.94, lon: 30.31, country: 643 },
	// Europe
	fra: { name: 'Frankfurt', lat: 50.11, lon: 8.68, country: 276 },
	ber: { name: 'Berlin', lat: 52.52, lon: 13.4, country: 276 },
	muc: { name: 'Munich', lat: 48.14, lon: 11.58, country: 276 },
	dus: { name: 'Düsseldorf', lat: 51.23, lon: 6.78, country: 276 },
	ams: { name: 'Amsterdam', lat: 52.37, lon: 4.9, country: 528 },
	lon: { name: 'London', lat: 51.51, lon: -0.13, country: 826 },
	par: { name: 'Paris', lat: 48.86, lon: 2.35, country: 250 },
	zrh: { name: 'Zürich', lat: 47.38, lon: 8.54, country: 756 },
	osl: { name: 'Oslo', lat: 59.91, lon: 10.75, country: 578 },
	sto: { name: 'Stockholm', lat: 59.33, lon: 18.07, country: 752 },
	hel: { name: 'Helsinki', lat: 60.17, lon: 24.94, country: 246 },
	waw: { name: 'Warsaw', lat: 52.23, lon: 21.01, country: 616 },
	vie: { name: 'Vienna', lat: 48.21, lon: 16.37, country: 40 },
	mil: { name: 'Milan', lat: 45.46, lon: 9.19, country: 380 },
	rom: { name: 'Rome', lat: 41.9, lon: 12.5, country: 380 },
	mad: { name: 'Madrid', lat: 40.42, lon: -3.7, country: 724 },
	bcn: { name: 'Barcelona', lat: 41.39, lon: 2.17, country: 724 },
	lis: { name: 'Lisbon', lat: 38.72, lon: -9.14, country: 620 },
	cph: { name: 'Copenhagen', lat: 55.68, lon: 12.57, country: 208 },
	dub: { name: 'Dublin', lat: 53.35, lon: -6.26, country: 372 },
	bru: { name: 'Brussels', lat: 50.85, lon: 4.35, country: 56 },
	prg: { name: 'Prague', lat: 50.08, lon: 14.44, country: 203 },
	buh: { name: 'Bucharest', lat: 44.43, lon: 26.1, country: 642 },
	iev: { name: 'Kyiv', lat: 50.45, lon: 30.52, country: 804 },
	// North America — region overridden per-city (US/CA span E/C/W)
	nyc: { name: 'New York', lat: 40.71, lon: -74.01, country: 840, region: 42 },
	was: { name: 'Washington', lat: 38.9, lon: -77.04, country: 840, region: 42 },
	mia: { name: 'Miami', lat: 25.76, lon: -80.19, country: 840, region: 42 },
	atl: { name: 'Atlanta', lat: 33.75, lon: -84.39, country: 840, region: 42 },
	chi: { name: 'Chicago', lat: 41.88, lon: -87.63, country: 840, region: 43 },
	dfw: { name: 'Dallas', lat: 32.78, lon: -96.8, country: 840, region: 43 },
	den: { name: 'Denver', lat: 39.74, lon: -104.99, country: 840, region: 43 },
	lax: { name: 'Los Angeles', lat: 34.05, lon: -118.24, country: 840, region: 44 },
	sjc: { name: 'San Jose', lat: 37.34, lon: -121.89, country: 840, region: 44 },
	sfo: { name: 'San Francisco', lat: 37.77, lon: -122.42, country: 840, region: 44 },
	sea: { name: 'Seattle', lat: 47.61, lon: -122.33, country: 840, region: 44 },
	yto: { name: 'Toronto', lat: 43.65, lon: -79.38, country: 124, region: 42 },
	yvr: { name: 'Vancouver', lat: 49.28, lon: -123.12, country: 124, region: 44 },
	// Central / South America
	mex: { name: 'Mexico City', lat: 19.43, lon: -99.13, country: 484 },
	sao: { name: 'São Paulo', lat: -23.55, lon: -46.63, country: 76 },
	scl: { name: 'Santiago', lat: -33.45, lon: -70.67, country: 152 },
	lim: { name: 'Lima', lat: -12.05, lon: -77.04, country: 604 },
	// Africa
	cai: { name: 'Cairo', lat: 30.04, lon: 31.24, country: 818 },
	jnb: { name: 'Johannesburg', lat: -26.2, lon: 28.05, country: 710 },
	cpt: { name: 'Cape Town', lat: -33.92, lon: 18.42, country: 710 },
	// Pacific & Oceania
	syd: { name: 'Sydney', lat: -33.87, lon: 151.21, country: 36 },
	mel: { name: 'Melbourne', lat: -37.81, lon: 144.96, country: 36 },
	akl: { name: 'Auckland', lat: -36.85, lon: 174.76, country: 554 }
};

// --- resolver ----------------------------------------------------------------
export interface ResolvedGeo {
	/** city code (lowercased) if it matched the registry, else null. */
	site: string | null;
	cityName: string | null;
	country: number | null;
	countryName: string | null;
	region: RegionCode | null;
	regionName: string | null;
	/** placement coordinate [lat, lon], or null when nothing is known. */
	coord: [number, number] | null;
	/** how `coord` was derived: a known city, a region centre, or nothing. */
	placement: 'city' | 'region' | 'none';
}

/**
 * Resolve a node's `site` (+ optional authoritative DN42 `region`) into the full
 * region → country → city taxonomy with a map coordinate.
 *
 * Precedence: the explicit `region` (set on the backend) wins; otherwise the
 * region is derived from the city's country. Coordinates come from the city, and
 * fall back to the region centre when only the region is known.
 */
export function resolveGeo(site: string | null | undefined, region?: number | null): ResolvedGeo {
	const code = site ? site.trim().toLowerCase() : null;
	const city = code ? CITIES[code] : undefined;
	const country = city?.country ?? null;
	const countryInfo = country != null ? COUNTRIES[country] : undefined;

	// region: explicit (valid 41..57) > per-city override > country default
	const cityRegion = (city as (CityInfo & { region?: number }) | undefined)?.region;
	const resolvedRegion =
		region != null && REGIONS[region]
			? region
			: (cityRegion ?? countryInfo?.region ?? null);
	const regionInfo = resolvedRegion != null ? REGIONS[resolvedRegion] : undefined;

	let coord: [number, number] | null = null;
	let placement: ResolvedGeo['placement'] = 'none';
	if (city) {
		coord = [city.lat, city.lon];
		placement = 'city';
	} else if (regionInfo) {
		coord = regionInfo.center;
		placement = 'region';
	}

	return {
		site: city ? code : null,
		cityName: city?.name ?? null,
		country,
		countryName: countryInfo?.name ?? null,
		region: resolvedRegion,
		regionName: regionInfo?.name ?? null,
		coord,
		placement
	};
}
