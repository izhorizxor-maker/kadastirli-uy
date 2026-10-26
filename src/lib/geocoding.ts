import {
  UZBEKISTAN_BOUNDS,
  UZBEKISTAN_REGIONS,
  findNearestAdminArea,
  normalizeUzbekSearch,
} from '../shared/uzbekistanRegions.ts';
import {
  formatCleanHouseNumber,
  formatOsmPlaceName,
  formatOsmStreetName,
  transliterateToUzbekLatin,
  uzbekPhoneticStreetToken,
} from './osmBuildings.ts';

export function streetTokensMatch(queryTok: string, candidateWord: string): boolean {
  if (candidateWord === queryTok) return true;
  if (queryTok.length >= 3 && (candidateWord.startsWith(queryTok) || queryTok.startsWith(candidateWord))) {
    return true;
  }
  const qp = uzbekPhoneticStreetToken(queryTok);
  const cp = uzbekPhoneticStreetToken(candidateWord);
  if (!qp || !cp) return false;
  return cp === qp || (qp.length >= 4 && (cp.startsWith(qp) || qp.startsWith(cp)));
}

function latinToCyrillicSearchVariant(text: string): string {
  return text
    .replace(/['`´ʻʼ‘’]/g, "'")
    .replace(/o'/gi, 'у')
    .replace(/g'/gi, 'г')
    .replace(/sh/gi, 'ш')
    .replace(/ch/gi, 'ч')
    .replace(/yo/gi, 'ё')
    .replace(/yu/gi, 'ю')
    .replace(/ya/gi, 'я')
    .replace(/q/gi, 'к')
    .replace(/x/gi, 'х')
    .replace(/h/gi, 'х')
    .replace(/j/gi, 'дж')
    .replace(/a/gi, 'а')
    .replace(/b/gi, 'б')
    .replace(/d/gi, 'д')
    .replace(/e/gi, 'е')
    .replace(/f/gi, 'ф')
    .replace(/g/gi, 'г')
    .replace(/i/gi, 'и')
    .replace(/k/gi, 'к')
    .replace(/l/gi, 'л')
    .replace(/m/gi, 'м')
    .replace(/n/gi, 'н')
    .replace(/o/gi, 'о')
    .replace(/p/gi, 'п')
    .replace(/r/gi, 'р')
    .replace(/s/gi, 'с')
    .replace(/t/gi, 'т')
    .replace(/u/gi, 'у')
    .replace(/v/gi, 'в')
    .replace(/y/gi, 'й')
    .replace(/z/gi, 'з');
}

export interface GeocodedPlace {
  id: string;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  zoom: number;
  isAddressOrHouse: boolean;
  exactHouseMatch: boolean;
  region: string;
  district: string;
  mahalla: string | null;
  streetAddress: string;
}

interface NominatimItem {
  place_id: number;
  lat: string;
  lon: string;
  category?: string;
  type?: string;
  name?: string;
  display_name: string;
  address?: {
    house_number?: string;
    road?: string;
    street?: string;
    pedestrian?: string;
    residential?: string;
    neighbourhood?: string;
    quarter?: string;
    suburb?: string;
    hamlet?: string;
    village?: string;
    town?: string;
    city?: string;
    county?: string;
    state?: string;
  };
}

interface ParsedUzbekAddressQuery {
  region: string | null;
  district: string | null;
  districtCenter: { lat: number; lng: number } | null;
  houseNumber: string | null;
  streetOrPlaceRaw: string;
  streetTokens: string[];
}

const geocodeCache = new Map<string, GeocodedPlace[]>();
const reverseCache = new Map<
  string,
  { streetAddress: string; mahalla: string | null; hasHouseNumber: boolean } | null
>();

const FILLER_TOKENS = new Set([
  'viloyati',
  'viloyat',
  'respublikasi',
  'respublika',
  'tumani',
  'tuman',
  'shahri',
  'shahar',
  'qishlogi',
  'qishloq',
  'mfy',
  'mahallasi',
  'mahalla',
  'kochasi',
  'kocha',
  'shoh',
  'tor',
  'berk',
  'uy',
  'xonadon',
  'kv',
]);

function isInsideUzbekistan(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= UZBEKISTAN_BOUNDS.minLat &&
    lat <= UZBEKISTAN_BOUNDS.maxLat &&
    lng >= UZBEKISTAN_BOUNDS.minLng &&
    lng <= UZBEKISTAN_BOUNDS.maxLng
  );
}

function approxKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111.32;
  const dLng = (lng2 - lng1) * 111.32 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * Extracts house number cleanly from Uzbek/Russian address strings:
 * e.g. "Qatortol ko‘chasi, 18A-uy" -> "18a"
 *      "14-uy Navbahor ko‘chasi" -> "14"
 *      "Amir Temur 22" -> "22"
 */
export function extractHouseNumberFromText(text: string): string | null {
  const s = transliterateToUzbekLatin(text).trim();
  if (!s) return null;

  // 1. Explicit "... 18A-uy" or "№ 18A" or "uy 18A"
  const explicitUy = s.match(/(?:^|[\s,#№-]+)(\d+[A-Za-z]?)\s*-?\s*uy\b/i);
  if (explicitUy) return explicitUy[1].toLowerCase();

  const prefixUy = s.match(/(?:№|#|uy\s+)(\d+[A-Za-z]?)\b/i);
  if (prefixUy) return prefixUy[1].toLowerCase();

  // 2. Trailing house number after street/place words: "Qatortol 22A" or "Qatortol, 22"
  const trailing = s.match(/(?:[\s,]+)(\d+[A-Za-z]?)\s*$/);
  if (trailing) return trailing[1].toLowerCase();

  return null;
}

const STREET_OR_PLACE_FOLLOWERS =
  '(?:kochasi|kocha|shoh|tor|berk|yoli|maydoni|mahallasi|mahalla|mfy|qishlogi|qishloq|dahasi|daha|mavzesi|massivi|massiv|\\d+[a-z]?(?:\\s*uy)?\\b)';

function isFollowedByStreetOrHouseIndicator(normFull: string, phraseNorm: string): boolean {
  const escaped = phraseNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\s+${STREET_OR_PLACE_FOLLOWERS}`, 'i');
  return re.test(normFull);
}

export function parseUzbekAddressQuery(
  rawQuery: string,
  options?: { selectedRegion?: string; selectedDistrict?: string }
): ParsedUzbekAddressQuery {
  const latinQuery = transliterateToUzbekLatin(rawQuery);
  const normFull = normalizeUzbekSearch(latinQuery);
  const houseNumber = extractHouseNumberFromText(latinQuery);

  let matchedRegion: string | null =
    options?.selectedRegion && options.selectedRegion !== 'ALL' ? options.selectedRegion : null;
  let matchedDistrict: string | null =
    options?.selectedDistrict && options.selectedDistrict !== 'ALL'
      ? options.selectedDistrict
      : null;
  let districtCenter: { lat: number; lng: number } | null = null;

  // Strip house number first to test remaining tokens cleanly
  let withoutHouse = latinQuery
    .replace(/(?:^|[\s,#№-]+)\d+[A-Za-z]?\s*-?\s*uy\b/gi, ' ')
    .replace(/(?:№|#)\s*\d+[A-Za-z]?\b/gi, ' ');
  if (houseNumber) {
    withoutHouse = withoutHouse.replace(new RegExp(`[\\s,]+${houseNumber}\\s*$`, 'i'), ' ');
  }

  const countMeaningfulTokens = (text: string): number =>
    normalizeUzbekSearch(text)
      .split(' ')
      .filter((t) => (t.length >= 2 || /^\d+$/.test(t)) && !FILLER_TOKENS.has(t)).length;

  // 1. Detect explicit region in query text (e.g. "Samarqand viloyati" or bare "Samarqand" before district/street)
  let explicitRegionInQuery = false;
  for (const reg of UZBEKISTAN_REGIONS) {
    const fullReg = normalizeUzbekSearch(reg.name);
    const baseReg = normalizeUzbekSearch(
      reg.name.replace(/\s+(viloyati|shahri|Respublikasi)$/i, '')
    );

    if (new RegExp(`\\b${fullReg}\\b`).test(normFull)) {
      matchedRegion = reg.name;
      explicitRegionInQuery = true;
      break;
    }

    if (baseReg.length >= 4 && new RegExp(`\\b${baseReg}\\b`).test(normFull)) {
      // Do NOT treat bare "Navoiy" / "Samarqand" / "Guliston" as region if followed by "ko‘chasi" / "MFY" / house number!
      if (isFollowedByStreetOrHouseIndicator(normFull, baseReg)) {
        continue;
      }
      const strippedTest = withoutHouse.replace(
        new RegExp(`\\b${baseReg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
        ' '
      );
      const remainingCount = countMeaningfulTokens(strippedTest);
      if (remainingCount >= 1 || (!houseNumber && normFull.trim() === baseReg)) {
        if (!matchedRegion) {
          matchedRegion = reg.name;
          explicitRegionInQuery = true;
        }
      }
    }
  }

  // 2. Detect explicit or unambiguous district/city in query text
  // Pass A: Explicit "<name> tumani / tuman / shahri / shahar"
  let explicitDistFound = false;
  for (const reg of UZBEKISTAN_REGIONS) {
    if (explicitRegionInQuery && matchedRegion && reg.name !== matchedRegion) continue;
    for (const dist of reg.districts) {
      const baseDist = normalizeUzbekSearch(dist.name.replace(/\s+(tumani|shahri)$/i, ''));
      if (
        baseDist.length >= 3 &&
        new RegExp(`\\b${baseDist}\\s+(tumani|tuman|shahri|shahar)\\b`).test(normFull)
      ) {
        matchedDistrict = dist.name;
        matchedRegion = reg.name;
        districtCenter = { lat: dist.lat, lng: dist.lng };
        explicitDistFound = true;
        break;
      }
    }
    if (explicitDistFound) break;
  }

  // Pass B: Bare district name (e.g. "Chilonzor Qatortol 22" or "Toyloq Amir Temur 15")
  // Never match bare district name if it is followed by street/mahalla suffix or house number (e.g. "Do‘stlik ko‘chasi 14", "Beruniy 12")!
  if (!explicitDistFound) {
    let bestDistLen = 0;
    const candidateRegions = matchedRegion
      ? [
          ...UZBEKISTAN_REGIONS.filter((r) => r.name === matchedRegion),
          ...(explicitRegionInQuery ? [] : UZBEKISTAN_REGIONS.filter((r) => r.name !== matchedRegion)),
        ]
      : UZBEKISTAN_REGIONS;

    for (const reg of candidateRegions) {
      for (const dist of reg.districts) {
        const baseDist = normalizeUzbekSearch(dist.name.replace(/\s+(tumani|shahri)$/i, ''));
        if (baseDist.length < 4 || baseDist.length <= bestDistLen) continue;
        if (!new RegExp(`\\b${baseDist}\\b`).test(normFull)) continue;
        if (isFollowedByStreetOrHouseIndicator(normFull, baseDist)) continue;

        let testRem = withoutHouse.replace(
          new RegExp(`\\b${baseDist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
          ' '
        );
        if (reg.name) {
          const regBase = reg.name.replace(/\s+(viloyati|shahri|Respublikasi)$/i, '').trim();
          testRem = testRem.replace(
            new RegExp(`\\b${regBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s+(viloyati|viloyat|shahri|shahar|respublikasi))?\\b`, 'gi'),
            ' '
          );
        }

        const remainingStreetCount = countMeaningfulTokens(testRem);
        const isPureDistrictLookup = !houseNumber && remainingStreetCount === 0 && normFull.trim() === baseDist;

        if (remainingStreetCount >= 1 || isPureDistrictLookup) {
          matchedDistrict = dist.name;
          matchedRegion = reg.name;
          districtCenter = { lat: dist.lat, lng: dist.lng };
          bestDistLen = baseDist.length;
        }
      }
    }
  }

  if (!districtCenter && matchedDistrict) {
    for (const reg of UZBEKISTAN_REGIONS) {
      const d = reg.districts.find((x) => x.name === matchedDistrict);
      if (d) {
        districtCenter = { lat: d.lat, lng: d.lng };
        if (!matchedRegion) matchedRegion = reg.name;
        break;
      }
    }
  }

  let remainder = withoutHouse;

  if (matchedDistrict) {
    const distBase = matchedDistrict.replace(/\s+(tumani|shahri)$/i, '').trim();
    const testStripDist = remainder
      .replace(
        new RegExp(`\\b${distBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s+(tumani|tuman|shahri|shahar))?\\b`, 'gi'),
        ' '
      )
      .replace(/[,.\s]+/g, ' ')
      .trim();
    if (testStripDist.length >= 1 || !houseNumber) {
      remainder = testStripDist;
    }
  }

  if (matchedRegion) {
    const regBase = matchedRegion.replace(/\s+(viloyati|shahri|Respublikasi)$/i, '').trim();
    const testStripReg = remainder
      .replace(
        new RegExp(`\\b${regBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s+(viloyati|viloyat|shahri|shahar|respublikasi))?\\b`, 'gi'),
        ' '
      )
      .replace(/[,.\s]+/g, ' ')
      .trim();
    if (testStripReg.length >= 1 || !houseNumber) {
      remainder = testStripReg;
    }
  }

  const streetOrPlaceRaw = remainder.replace(/^[,.\s-]+|[,.\s-]+$/g, '').replace(/\s+/g, ' ');
  const streetTokens = normalizeUzbekSearch(streetOrPlaceRaw)
    .split(' ')
    .filter((t) => (t.length >= 2 || /^\d+$/.test(t)) && !FILLER_TOKENS.has(t));

  return {
    region: matchedRegion,
    district: matchedDistrict,
    districtCenter,
    houseNumber,
    streetOrPlaceRaw,
    streetTokens,
  };
}

async function queryNominatimFreeform(q: string, signal?: AbortSignal): Promise<NominatimItem[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('countrycodes', 'uz');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '10');
  url.searchParams.set('accept-language', 'uz,ru,en');
  url.searchParams.set('q', q.replace(/[‘’`ʼʻ]/g, "'"));

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as NominatimItem[];
  return Array.isArray(data) ? data : [];
}

async function queryNominatimStructured(
  params: { street: string; city?: string; state?: string },
  signal?: AbortSignal
): Promise<NominatimItem[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('countrycodes', 'uz');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '10');
  url.searchParams.set('accept-language', 'uz,ru,en');
  url.searchParams.set('street', params.street.replace(/[‘’`ʼʻ]/g, "'"));
  if (params.city) url.searchParams.set('city', params.city.replace(/[‘’`ʼʻ]/g, "'"));
  if (params.state) url.searchParams.set('state', params.state.replace(/[‘’`ʼʻ]/g, "'"));

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as NominatimItem[];
  return Array.isArray(data) ? data : [];
}

async function queryPhotonCandidates(
  q: string,
  biasCenter: { lat: number; lng: number } | null,
  signal?: AbortSignal
): Promise<
  Array<{
    id: string;
    lat: number;
    lng: number;
    road: string | null;
    houseNumber: string | null;
    mahalla: string | null;
    rawText: string;
  }>
> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q.replace(/[‘’`ʼʻ]/g, "'"));
  url.searchParams.set('lat', String(biasCenter?.lat ?? 41.3111));
  url.searchParams.set('lon', String(biasCenter?.lng ?? 69.2406));
  url.searchParams.set('bbox', '55.95,37.15,73.25,45.65');
  url.searchParams.set('limit', '10');

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: {
        osm_id?: number;
        name?: string;
        street?: string;
        housenumber?: string;
        district?: string;
        city?: string;
        state?: string;
        type?: string;
      };
    }>;
  };

  if (!Array.isArray(json.features)) return [];
  const out: Array<{
    id: string;
    lat: number;
    lng: number;
    road: string | null;
    houseNumber: string | null;
    mahalla: string | null;
    rawText: string;
  }> = [];

  for (const f of json.features) {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (!isInsideUzbekistan(lat, lng)) continue;
    const p = f.properties || {};
    const road = formatOsmStreetName(p.street || (p.type === 'street' ? p.name : null));
    const placeName = !road ? formatOsmPlaceName(p.name) : null;
    out.push({
      id: `photon-${p.osm_id || `${lat.toFixed(5)},${lng.toFixed(5)}`}`,
      lat,
      lng,
      road: road || placeName,
      houseNumber: p.housenumber ? transliterateToUzbekLatin(p.housenumber).toLowerCase() : null,
      mahalla: formatOsmPlaceName(p.district),
      rawText: transliterateToUzbekLatin(
        `${p.name || ''} ${p.street || ''} ${p.district || ''} ${p.city || ''} ${p.state || ''}`
      ),
    });
  }
  return out;
}

export async function geocodeUzbekistanAddress(
  rawQuery: string,
  options?: {
    selectedRegion?: string;
    selectedDistrict?: string;
    signal?: AbortSignal;
  }
): Promise<GeocodedPlace[]> {
  const cleaned = rawQuery.trim();
  if (cleaned.length < 2) return [];

  const regionCtx =
    options?.selectedRegion && options.selectedRegion !== 'ALL' ? options.selectedRegion : '';
  const districtCtx =
    options?.selectedDistrict && options.selectedDistrict !== 'ALL'
      ? options.selectedDistrict
      : '';

  const cacheKey = `${normalizeUzbekSearch(cleaned)}|${regionCtx}|${districtCtx}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  const parsed = parseUzbekAddressQuery(cleaned, options);
  const cleanDistName = parsed.district
    ? parsed.district.replace(/\s+(tumani|shahri)$/i, '').trim()
    : '';
  const cleanRegName = parsed.region
    ? parsed.region.replace(/\s+(viloyati|Respublikasi)$/i, '').trim()
    : '';

  const streetBase = parsed.streetOrPlaceRaw
    .replace(/\b(ko‘chasi|ko'chasi|kochasi|ko‘cha|ko'cha|mfy|mahallasi|qishlog‘i|qishlog'i)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  type ScoredCandidate = {
    place: GeocodedPlace;
    score: number;
  };
  const candidates: ScoredCandidate[] = [];

  const evaluateCandidate = (params: {
    id: string;
    lat: number;
    lng: number;
    osmRoad: string | null;
    osmPlaceName: string | null;
    osmHouseNum: string | null;
    osmMahalla: string | null;
    fullDisplayText: string;
    osmType?: string;
  }) => {
    if (!isInsideUzbekistan(params.lat, params.lng)) return;

    const admin = findNearestAdminArea(params.lat, params.lng);

    // Enforce geographic region/district match if the user specified one!
    if (parsed.region && admin.region !== parsed.region) {
      // Allow slight border tolerance (~12km) around target district center, otherwise reject wrong city!
      if (!parsed.districtCenter || approxKm(params.lat, params.lng, parsed.districtCenter.lat, parsed.districtCenter.lng) > 18) {
        return;
      }
    }
    if (parsed.district && parsed.districtCenter) {
      const distKm = approxKm(
        params.lat,
        params.lng,
        parsed.districtCenter.lat,
        parsed.districtCenter.lng
      );
      if (distKm > 32) {
        return;
      }
    }

    const haystackNorm = normalizeUzbekSearch(
      `${params.osmRoad || ''} ${params.osmPlaceName || ''} ${params.osmMahalla || ''} ${params.fullDisplayText}`
    );
    const haystackWords = haystackNorm.split(' ').filter(Boolean);

    // If user typed street/village tokens, require them to actually match the candidate's street/place
    // (Prevents returning a generic district center like "Chilonzor tumani" as a fake street match!)
    let matchedStreetTokens = 0;
    for (const tok of parsed.streetTokens) {
      if (haystackWords.some((w) => streetTokensMatch(tok, w))) {
        matchedStreetTokens += 1;
      }
    }

    if (parsed.streetTokens.length > 0 && matchedStreetTokens === 0) {
      return;
    }

    const candHouseNorm = params.osmHouseNum
      ? transliterateToUzbekLatin(params.osmHouseNum).replace(/-?uy$/i, '').trim().toLowerCase()
      : null;

    // Never return a DIFFERENT house number on the same street (e.g. returning 18-uy when user typed 14-uy)!
    if (parsed.houseNumber && candHouseNorm && candHouseNorm !== parsed.houseNumber) {
      return;
    }

    const exactHouseMatch = Boolean(
      parsed.houseNumber && candHouseNorm && candHouseNorm === parsed.houseNumber
    );

    const bestRoadLabel =
      params.osmRoad ||
      (parsed.streetOrPlaceRaw ? formatOsmStreetName(parsed.streetOrPlaceRaw) : null) ||
      params.osmPlaceName ||
      params.osmMahalla ||
      admin.district;

    let streetAddress: string;
    if (exactHouseMatch && parsed.houseNumber) {
      streetAddress = `${bestRoadLabel}, ${formatCleanHouseNumber(parsed.houseNumber.toUpperCase())}`;
    } else if (parsed.houseNumber && params.osmRoad) {
      // Street was found accurately, though individual house number is not mapped in OSM
      streetAddress = `${params.osmRoad}, ${formatCleanHouseNumber(parsed.houseNumber.toUpperCase())}`;
    } else if (params.osmHouseNum && params.osmRoad) {
      streetAddress = `${params.osmRoad}, ${formatCleanHouseNumber(params.osmHouseNum)}`;
    } else {
      streetAddress = params.osmRoad || params.osmPlaceName || bestRoadLabel;
    }

    let score = matchedStreetTokens * 40;
    if (exactHouseMatch) score += 200;
    else if (!parsed.houseNumber && params.osmRoad) score += 80;
    else if (parsed.houseNumber && params.osmRoad) score += 60;

    if (parsed.district && admin.district === parsed.district) score += 50;
    if (parsed.region && admin.region === parsed.region) score += 25;

    const statusHint = exactHouseMatch
      ? 'Aniq uy topildi'
      : parsed.houseNumber
        ? 'Ko‘cha joylashuvi topildi'
        : null;

    const subtitleParts = [
      statusHint,
      params.osmMahalla,
      admin.district,
      admin.region,
    ].filter((val, idx, arr) => Boolean(val) && arr.indexOf(val) === idx);

    candidates.push({
      score,
      place: {
        id: params.id,
        title: streetAddress,
        subtitle: subtitleParts.join(' · '),
        lat: params.lat,
        lng: params.lng,
        zoom: exactHouseMatch ? 19 : params.osmRoad ? 18 : 16,
        isAddressOrHouse: exactHouseMatch,
        exactHouseMatch,
        region: admin.region,
        district: admin.district,
        mahalla: params.osmMahalla,
        streetAddress,
      },
    });
  };

  try {
    const tasks: Array<Promise<void>> = [];

    // 1. Nominatim structured search when street & house number or city/district are present
    if (streetBase) {
      const streetParam = parsed.houseNumber ? `${parsed.houseNumber} ${streetBase}` : streetBase;
      tasks.push(
        queryNominatimStructured(
          {
            street: streetParam,
            city: cleanDistName || undefined,
            state: cleanRegName || undefined,
          },
          options?.signal
        ).then((items) => {
          for (const item of items) {
            const addr = item.address || {};
            evaluateCandidate({
              id: `nom-struct-${item.place_id}`,
              lat: Number(item.lat),
              lng: Number(item.lon),
              osmRoad: formatOsmStreetName(addr.road || addr.street || addr.pedestrian || addr.residential),
              osmPlaceName: formatOsmPlaceName(item.name),
              osmHouseNum: addr.house_number || null,
              osmMahalla: formatOsmPlaceName(
                addr.neighbourhood || addr.quarter || addr.suburb || addr.village || addr.hamlet
              ),
              fullDisplayText: transliterateToUzbekLatin(item.display_name),
              osmType: item.type,
            });
          }
        })
      );
    }

    // 2. Nominatim free-form query with house number
    const freeformWithHouse = [
      streetBase ? `${streetBase}${parsed.houseNumber ? ` ${parsed.houseNumber}` : ''}` : cleaned,
      cleanDistName,
      cleanRegName,
    ]
      .filter(Boolean)
      .join(', ');

    tasks.push(
      queryNominatimFreeform(freeformWithHouse, options?.signal).then((items) => {
        for (const item of items) {
          const addr = item.address || {};
          evaluateCandidate({
            id: `nom-free-${item.place_id}`,
            lat: Number(item.lat),
            lng: Number(item.lon),
            osmRoad: formatOsmStreetName(
              addr.road || addr.street || addr.pedestrian || addr.residential || (item.category === 'highway' ? item.name : null)
            ),
            osmPlaceName: formatOsmPlaceName(item.name),
            osmHouseNum: addr.house_number || null,
            osmMahalla: formatOsmPlaceName(
              addr.neighbourhood || addr.quarter || addr.suburb || addr.village || addr.hamlet
            ),
            fullDisplayText: transliterateToUzbekLatin(item.display_name),
            osmType: item.type,
          });
        }
      })
    );

    // 3. Photon search (handles Cyrillic/Russian OSM street & housenumber tags seamlessly)
    const photonQuery = [
      streetBase || cleaned,
      parsed.houseNumber || '',
      cleanDistName,
      cleanRegName || 'Uzbekistan',
    ]
      .filter(Boolean)
      .join(' ');

    tasks.push(
      queryPhotonCandidates(photonQuery, parsed.districtCenter, options?.signal).then((pItems) => {
        for (const p of pItems) {
          evaluateCandidate({
            id: p.id,
            lat: p.lat,
            lng: p.lng,
            osmRoad: p.road,
            osmPlaceName: p.road,
            osmHouseNum: p.houseNumber,
            osmMahalla: p.mahalla,
            fullDisplayText: p.rawText,
          });
        }
      })
    );

    await Promise.all(tasks);

    // 4. Only if no exact house or street match was found yet,
    // try street-only and Cyrillic-transliterated Nominatim queries so Russian-tagged rural OSM streets are also found!
    if (candidates.length === 0 && streetBase) {
      const fallbackQueries: string[] = [];
      if (parsed.houseNumber) {
        fallbackQueries.push([streetBase, cleanDistName, cleanRegName].filter(Boolean).join(', '));
      }
      if (!/[А-Яа-я]/.test(streetBase)) {
        const cyrStreet = latinToCyrillicSearchVariant(streetBase);
        const cyrDist = cleanDistName ? latinToCyrillicSearchVariant(cleanDistName) : '';
        fallbackQueries.push(
          [
            parsed.houseNumber ? `${cyrStreet} ${parsed.houseNumber}` : cyrStreet,
            cyrDist,
          ]
            .filter(Boolean)
            .join(', ')
        );
      }

      const fallbackLists = await Promise.all(
        fallbackQueries.map((fq) => queryNominatimFreeform(fq, options?.signal))
      );
      for (const items of fallbackLists) {
        for (const item of items) {
          const addr = item.address || {};
          evaluateCandidate({
            id: `nom-street-${item.place_id}`,
            lat: Number(item.lat),
            lng: Number(item.lon),
            osmRoad: formatOsmStreetName(
              addr.road || addr.street || (item.category === 'highway' ? item.name : null)
            ),
            osmPlaceName: formatOsmPlaceName(item.name),
            osmHouseNum: addr.house_number || null,
            osmMahalla: formatOsmPlaceName(
              addr.neighbourhood || addr.quarter || addr.suburb || addr.village || addr.hamlet
            ),
            fullDisplayText: transliterateToUzbekLatin(item.display_name),
            osmType: item.type,
          });
        }
      }
    }

    // 5. If user requested a specific house number AND we located the street/area,
    // check Overpass building/address polygons along that street so buildings tagged with
    // addr:housenumber (even without addr:street) resolve to their EXACT rooftop!
    const hasExactAlready = candidates.some((c) => c.place.exactHouseMatch);
    if (!hasExactAlready && parsed.houseNumber && candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const anchor = candidates[0].place;
      const overpassHit = await findExactHouseOnStreetViaOverpass({
        anchorLat: anchor.lat,
        anchorLng: anchor.lng,
        targetHouseNumber: parsed.houseNumber,
        streetTokens: parsed.streetTokens,
        fallbackStreetLabel: anchor.streetAddress.replace(/,\s*\d+[A-Za-z]?-uy$/i, ''),
        signal: options?.signal,
      });

      if (overpassHit) {
        const hitAdmin = findNearestAdminArea(overpassHit.lat, overpassHit.lng);
        const exactTitle = `${overpassHit.streetName}, ${formatCleanHouseNumber(
          parsed.houseNumber.toUpperCase()
        )}`;
        const subtitleParts = [
          'Aniq uy tomi topildi',
          overpassHit.mahalla || anchor.mahalla,
          hitAdmin.district,
          hitAdmin.region,
        ].filter((val, idx, arr) => Boolean(val) && arr.indexOf(val) === idx);

        candidates.unshift({
          score: candidates[0].score + 300,
          place: {
            id: `overpass-exact-${overpassHit.osmId}`,
            title: exactTitle,
            subtitle: subtitleParts.join(' · '),
            lat: overpassHit.lat,
            lng: overpassHit.lng,
            zoom: 19,
            isAddressOrHouse: true,
            exactHouseMatch: true,
            region: hitAdmin.region,
            district: hitAdmin.district,
            mahalla: overpassHit.mahalla || anchor.mahalla,
            streetAddress: exactTitle,
          },
        });
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
  }

  // Deduplicate nearby identical results & sort by highest score
  candidates.sort((a, b) => b.score - a.score);
  const deduped: GeocodedPlace[] = [];
  for (const c of candidates) {
    const duplicate = deduped.some(
      (existing) =>
        approxKm(existing.lat, existing.lng, c.place.lat, c.place.lng) < 0.035 &&
        existing.exactHouseMatch === c.place.exactHouseMatch
    );
    if (!duplicate) {
      deduped.push(c.place);
    }
  }

  if (deduped.length > 0) {
    const top = deduped.slice(0, 6);
    geocodeCache.set(cacheKey, top);
    return top;
  }

  return [];
}

async function findExactHouseOnStreetViaOverpass(params: {
  anchorLat: number;
  anchorLng: number;
  targetHouseNumber: string;
  streetTokens: string[];
  fallbackStreetLabel: string;
  signal?: AbortSignal;
}): Promise<{
  osmId: number;
  lat: number;
  lng: number;
  streetName: string;
  mahalla: string | null;
} | null> {
  const { anchorLat, anchorLng, targetHouseNumber, streetTokens, fallbackStreetLabel, signal } =
    params;

  const south = (anchorLat - 0.0065).toFixed(5);
  const north = (anchorLat + 0.0065).toFixed(5);
  const west = (anchorLng - 0.0085).toFixed(5);
  const east = (anchorLng + 0.0085).toFixed(5);

  const query = `[out:json][timeout:4];(way["building"]["addr:housenumber"](${south},${west},${north},${east});node["addr:housenumber"](${south},${west},${north},${east});way["highway"]["name"](${south},${west},${north},${east}););out body geom;`;

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), 2400);
  const onParentAbort = () => timeoutCtrl.abort();
  signal?.addEventListener('abort', onParentAbort);

  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `data=${encodeURIComponent(query)}`,
      signal: timeoutCtrl.signal,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      elements?: Array<{
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        geometry?: Array<{ lat: number; lon: number }>;
        tags?: Record<string, string>;
      }>;
    };
    if (!Array.isArray(json.elements)) return null;

    const matchingRoadSegments: Array<{ name: string; points: Array<[number, number]> }> = [];
    const houseElements: Array<{
      id: number;
      lat: number;
      lng: number;
      houseNorm: string;
      taggedStreet: string | null;
      taggedMahalla: string | null;
    }> = [];

    for (const el of json.elements) {
      const tags = el.tags || {};
      if (el.type === 'way' && tags.highway && Array.isArray(el.geometry) && el.geometry.length >= 2) {
        const rName = formatOsmStreetName(
          tags['name:uz'] || tags['name:uz-Latn'] || tags.name || tags['name:ru']
        );
        if (!rName) continue;
        const rWords = normalizeUzbekSearch(rName).split(' ').filter(Boolean);
        const matchesQueryRoad =
          streetTokens.length === 0 ||
          streetTokens.some((tok) => rWords.some((w) => streetTokensMatch(tok, w)));
        if (matchesQueryRoad) {
          matchingRoadSegments.push({
            name: rName,
            points: el.geometry.map((pt) => [pt.lat, pt.lon]),
          });
        }
      } else if (tags['addr:housenumber']) {
        const hNorm = transliterateToUzbekLatin(tags['addr:housenumber'])
          .replace(/\s*-?\s*uy$/i, '')
          .trim()
          .toLowerCase();
        if (hNorm !== targetHouseNumber) continue;

        let cLat: number | null = null;
        let cLng: number | null = null;
        if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
          cLat = el.lat;
          cLng = el.lon;
        } else if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3) {
          let sLat = 0;
          let sLng = 0;
          for (const pt of el.geometry) {
            sLat += pt.lat;
            sLng += pt.lon;
          }
          cLat = sLat / el.geometry.length;
          cLng = sLng / el.geometry.length;
        }
        if (cLat === null || cLng === null) continue;

        houseElements.push({
          id: el.id,
          lat: cLat,
          lng: cLng,
          houseNorm: hNorm,
          taggedStreet: formatOsmStreetName(
            tags['addr:street:uz'] || tags['addr:street'] || tags['addr:street:ru'] || tags['addr:place']
          ),
          taggedMahalla: formatOsmPlaceName(
            tags['addr:quarter'] || tags['addr:suburb'] || tags['addr:neighbourhood']
          ),
        });
      }
    }

    let bestHit: {
      osmId: number;
      lat: number;
      lng: number;
      streetName: string;
      mahalla: string | null;
      distKm: number;
    } | null = null;

    for (const h of houseElements) {
      let streetMatched = false;
      let resolvedStreet = h.taggedStreet || fallbackStreetLabel;

      if (h.taggedStreet || h.taggedMahalla) {
        const tagWords = normalizeUzbekSearch(`${h.taggedStreet || ''} ${h.taggedMahalla || ''}`)
          .split(' ')
          .filter(Boolean);
        if (
          streetTokens.length > 0 &&
          streetTokens.some((tok) => tagWords.some((w) => streetTokensMatch(tok, w)))
        ) {
          streetMatched = true;
        }
      }

      if (!streetMatched && matchingRoadSegments.length > 0) {
        for (const road of matchingRoadSegments) {
          for (let i = 0; i < road.points.length - 1; i++) {
            const segMidLat = (road.points[i][0] + road.points[i + 1][0]) / 2;
            const segMidLng = (road.points[i][1] + road.points[i + 1][1]) / 2;
            if (approxKm(h.lat, h.lng, segMidLat, segMidLng) <= 0.125) {
              streetMatched = true;
              resolvedStreet = road.name;
              break;
            }
          }
          if (streetMatched) break;
        }
      }

      if (!streetMatched) continue;

      const distToAnchor = approxKm(h.lat, h.lng, anchorLat, anchorLng);
      if (!bestHit || distToAnchor < bestHit.distKm) {
        bestHit = {
          osmId: h.id,
          lat: h.lat,
          lng: h.lng,
          streetName: resolvedStreet,
          mahalla: h.taggedMahalla,
          distKm: distToAnchor,
        };
      }
    }

    return bestHit;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Reverse-geocodes a clicked rooftop coordinate via Nominatim so unnumbered OSM buildings
 * still obtain their true street name, mahalla/village, and house number when available.
 */
export async function reverseGeocodeUzbekistanPoint(
  lat: number,
  lng: number
): Promise<{ streetAddress: string; mahalla: string | null; hasHouseNumber: boolean } | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (reverseCache.has(key)) {
    return reverseCache.get(key) ?? null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2400);

  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', lat.toFixed(6));
    url.searchParams.set('lon', lng.toFixed(6));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'uz,ru,en');

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      reverseCache.set(key, null);
      return null;
    }

    const data = (await res.json()) as NominatimItem;
    const addr = data.address || {};

    const road = formatOsmStreetName(
      addr.road || addr.street || addr.pedestrian || addr.residential
    );
    const mahalla = formatOsmPlaceName(
      addr.neighbourhood || addr.quarter || addr.suburb || addr.village || addr.hamlet
    );
    const houseNo = addr.house_number ? formatCleanHouseNumber(addr.house_number) : null;

    if (!road && !mahalla && !houseNo) {
      reverseCache.set(key, null);
      return null;
    }

    let streetAddress: string;
    if (road && houseNo) {
      streetAddress = `${road}, ${houseNo}`;
    } else if (houseNo && mahalla) {
      streetAddress = `${mahalla}, ${houseNo}`;
    } else if (road) {
      streetAddress = `${road} (uy raqami kiritilmagan)`;
    } else {
      streetAddress = `${mahalla}, turar joy (raqam kiritilmagan)`;
    }

    const result = {
      streetAddress,
      mahalla,
      hasHouseNumber: Boolean(houseNo),
    };
    reverseCache.set(key, result);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
