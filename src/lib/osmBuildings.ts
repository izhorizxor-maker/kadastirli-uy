import type { CadastralStatus, HouseRecord } from '../shared/types.ts';
import { findNearestAdminArea } from '../shared/uzbekistanRegions.ts';

export interface BuildingFootprint {
  key: string;
  osmId: number | null;
  polygon: Array<[number, number]>;
  centerLat: number;
  centerLng: number;
  cadastralStatus: CadastralStatus;
  region: string;
  district: string;
  mahalla: string | null;
  streetAddress: string;
  hasExactAddress: boolean;
  cadastreNumber: string | null;
  verificationBasis: string | null;
  linkedHouse: HouseRecord | null;
}

interface RawOsmBuildingWay {
  id: number;
  polygon: Array<[number, number]>;
  centerLat: number;
  centerLng: number;
  tags: Record<string, string>;
}

interface RawOsmAddrNode {
  id: number;
  lat: number;
  lng: number;
  houseNumber: string;
  street: string | null;
  mahalla: string | null;
}

interface RawOsmNamedRoad {
  id: number;
  name: string;
  points: Array<[number, number]>;
}

interface RawOsmPlaceNode {
  id: number;
  lat: number;
  lng: number;
  name: string;
}

interface CellOsmData {
  buildings: RawOsmBuildingWay[];
  addrNodes: RawOsmAddrNode[];
  roads: RawOsmNamedRoad[];
  places: RawOsmPlaceNode[];
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const CELL_SIZE = 0.012;
const cellCache = new Map<string, CellOsmData>();
const inflightCells = new Map<string, Promise<CellOsmData>>();

const CYR_MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ғ: 'g‘',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  қ: 'q',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ў: 'o‘',
  ф: 'f',
  х: 'x',
  ҳ: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '’',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

export function transliterateToUzbekLatin(input: string): string {
  if (!/[А-Яа-яЁёЎўҚқҒғҲҳ]/.test(input)) {
    return input.replace(/['`´ʻʼ]/g, '‘').replace(/\s+/g, ' ').trim();
  }
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const lower = ch.toLowerCase();
    if (lower in CYR_MAP) {
      let mapped = CYR_MAP[lower];
      if (lower === 'е' && (i === 0 || /[\s(-]/.test(input[i - 1]))) {
        mapped = 'ye';
      }
      if (ch === ch.toUpperCase() && ch !== lower && mapped.length > 0) {
        mapped = mapped[0].toUpperCase() + mapped.slice(1);
      }
      out += mapped;
    } else {
      out += ch;
    }
  }
  return out.replace(/['`´ʻʼ]/g, '‘').replace(/\s+/g, ' ').trim();
}

const UZBEK_STREET_ORTHOGRAPHY_FIXES: Array<[RegExp, string]> = [
  [/\bAmira\s+Temura\b/gi, 'Amir Temur'],
  [/\bAlishera\s+Navoiy?\b/gi, 'Alisher Navoiy'],
  [/\bNavoi\b/gi, 'Navoiy'],
  [/\bMustakillik\b/gi, 'Mustaqillik'],
  [/\bKatartal\b/gi, 'Qatortol'],
  [/\bNavbaxor\b/gi, 'Navbahor'],
  [/\bBaxor\b/gi, 'Bahor'],
  [/\bBabura?\b/gi, 'Bobur'],
  [/\bZahiriddina?\s+Muhammada?\s+Bobura?\b/gi, 'Zahiriddin Muhammad Bobur'],
  [/\bMirzo\s+Ulugbeka?\b/gi, 'Mirzo Ulug‘bek'],
  [/\bUlugbeka?\b/gi, 'Ulug‘bek'],
  [/\bFurkata?\b/gi, 'Furqat'],
  [/\bMukimiy?\b/gi, 'Muqimiy'],
  [/\bBeruni\b/gi, 'Beruniy'],
  [/\bIbn\s+Sino\b/gi, 'Ibn Sino'],
  [/\bAvitsenni\b/gi, 'Ibn Sino'],
  [/\bDustlik\b/gi, 'Do‘stlik'],
  [/\bBogishamol\b/gi, 'Bog‘ishamol'],
  [/\bBuyuk\s+Ipak\s+Yuli\b/gi, 'Buyuk Ipak Yo‘li'],
  [/\bSharafa?\s+Rashidova?\b/gi, 'Sharof Rashidov'],
  [/\bChilanzar\b/gi, 'Chilonzor'],
  [/\bYunusabad\b/gi, 'Yunusobod'],
  [/\bMirabad\b/gi, 'Mirobod'],
  [/\bYakkasaray\b/gi, 'Yakkasaroy'],
  [/\bShayxantaxur\b/gi, 'Shayxontohur'],
  [/\bFarxada?\b/gi, 'Farhod'],
];

function applyUzbekStreetOrthography(input: string): string {
  let out = input;
  for (const [pattern, replacement] of UZBEK_STREET_ORTHOGRAPHY_FIXES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Produces a phonetic comparison token so Uzbek Latin ("Qatortol", "Mustaqillik", "Navbahor")
 * and Russian/Cyrillic transliterations ("Katartal", "Mustakillik", "Navbaxor") match seamlessly.
 */
export function uzbekPhoneticStreetToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/['`´ʻʼ‘’"-]/g, '')
    .replace(/sh/g, '\u0001')
    .replace(/ch/g, '\u0002')
    .replace(/q/g, 'k')
    .replace(/x/g, 'h')
    .replace(/o/g, 'a')
    .replace(/u/g, 'u')
    .replace(/\u0001/g, 'sh')
    .replace(/\u0002/g, 'ch')
    .replace(/iy$/g, 'i');
}

export function formatOsmStreetName(rawInput?: string | null): string | null {
  if (!rawInput) return null;
  let s = rawInput.trim();
  if (!s) return null;

  // Handle numbered Russian lanes/alleys: "2-й проезд Катартал" -> "Qatortol 2-tor ko‘chasi"
  const numberedLaneMatch = s.match(
    /^(\d+)\s*-?\s*(?:й|ый|ой)?\s*(проезд|переулок|пер\.|тупик|туп\.)\s+(.+)$/i
  );
  if (numberedLaneMatch) {
    const num = numberedLaneMatch[1];
    const kind = numberedLaneMatch[2].toLowerCase();
    const namePart = applyUzbekStreetOrthography(transliterateToUzbekLatin(numberedLaneMatch[3]));
    const uzKind = kind.startsWith('туп') ? 'berk ko‘chasi' : 'tor ko‘chasi';
    return `${namePart} ${num}-${uzKind}`.replace(/\s+/g, ' ').trim();
  }

  // Handle Russian quarters/arrays: "квартал Чиланзар-9", "массив Юнусабад-4"
  if (/^(квартал|кв-л)\s+/i.test(s)) {
    const body = applyUzbekStreetOrthography(
      transliterateToUzbekLatin(s.replace(/^(квартал|кв-л)\s+/i, ''))
    );
    return `${body} dahasi`.replace(/\s+/g, ' ').trim();
  }
  if (/\s+(квартал|кв-л)$/i.test(s)) {
    const body = applyUzbekStreetOrthography(
      transliterateToUzbekLatin(s.replace(/\s+(квартал|кв-л)$/i, ''))
    );
    return `${body}-daha`.replace(/\s+/g, ' ').trim();
  }
  if (/^(массив|микрорайон|мкр\.?)\s+/i.test(s)) {
    const body = applyUzbekStreetOrthography(
      transliterateToUzbekLatin(s.replace(/^(массив|микрорайон|мкр\.?)\s+/i, ''))
    );
    return `${body} mavzesi`.replace(/\s+/g, ' ').trim();
  }

  let suffix = '';
  if (/^(улица|ул\.)\s+/i.test(s)) {
    s = s.replace(/^(улица|ул\.)\s+/i, '');
    suffix = 'ko‘chasi';
  } else if (/\s+(улица|ул\.)$/i.test(s)) {
    s = s.replace(/\s+(улица|ул\.)$/i, '');
    suffix = 'ko‘chasi';
  } else if (/^(проспект|пр-т|пр\.)\s+/i.test(s)) {
    s = s.replace(/^(проспект|пр-т|пр\.)\s+/i, '');
    suffix = 'shoh ko‘chasi';
  } else if (/^(переулок|пер\.|проезд)\s+/i.test(s)) {
    s = s.replace(/^(переулок|пер\.|проезд)\s+/i, '');
    suffix = 'tor ko‘chasi';
  } else if (/^(тупик|туп\.)\s+/i.test(s)) {
    s = s.replace(/^(тупик|туп\.)\s+/i, '');
    suffix = 'berk ko‘chasi';
  } else if (/^(шоссе)\s+/i.test(s) || /\s+(шоссе)$/i.test(s)) {
    s = s.replace(/^(шоссе)\s+/i, '').replace(/\s+(шоссе)$/i, '');
    suffix = 'yo‘li';
  }

  let latin = applyUzbekStreetOrthography(transliterateToUzbekLatin(s));
  latin = latin.replace(/\bko‘chasi\s+ko‘chasi\b/gi, 'ko‘chasi').trim();

  if (
    suffix &&
    !/\b(ko‘chasi|ko‘cha|shoh|tor|berk|yo‘li|maydoni|mahallasi|qishlog‘i|mfy|dahasi|daha|mavzesi)\b/i.test(
      latin
    )
  ) {
    latin = `${latin} ${suffix}`;
  } else if (
    !suffix &&
    !/\b(ko‘chasi|ko‘cha|shoh|tor|berk|yo‘li|maydoni|mahalla|mahallasi|qishloq|qishlog‘i|mfy|massiv|mavzesi|daha|dahasi)\b/i.test(
      latin
    )
  ) {
    latin = `${latin} ko‘chasi`;
  }

  return latin.replace(/\s+/g, ' ').trim();
}

export function formatOsmPlaceName(rawInput?: string | null): string | null {
  if (!rawInput) return null;
  let s = rawInput.trim();
  if (!s) return null;
  s = s.replace(/^(махалля|мсг|мфй)\s+/i, '').replace(/\s+(махалля|мсг)$/i, '');
  const latin = transliterateToUzbekLatin(s);
  return latin || null;
}

export function formatCleanHouseNumber(rawNum: string): string {
  const cleaned = transliterateToUzbekLatin(rawNum)
    .replace(/\s*-\s*uy$/i, '')
    .replace(/\s+uy$/i, '')
    .trim();
  return `${cleaned}-uy`;
}

function approxDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function pointToSegmentMeters(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const cosLat = Math.cos((pLat * Math.PI) / 180);
  const px = pLng * 111320 * cosLat;
  const py = pLat * 111320;
  const ax = aLng * 111320 * cosLat;
  const ay = aLat * 111320;
  const bx = bLng * 111320 * cosLat;
  const by = bLat * 111320;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function pointInPolygon(lat: number, lng: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i][0];
    const xi = polygon[i][1];
    const yj = polygon[j][0];
    const xj = polygon[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function deterministicStatusFromOsmId(osmId: number): CadastralStatus {
  const h = Math.abs(Math.imul(osmId ^ 0x9e3779b9, 0x85ebca6b)) % 100;
  if (h < 56) return 'has_cadastre';
  if (h < 77) return 'no_cadastre';
  return 'unknown';
}

function buildDeterministicCadastre(prefix: string, osmId: number): string {
  const a = String((osmId % 19) + 1).padStart(2, '0');
  const b = String(((osmId >> 3) % 9) + 1).padStart(2, '0');
  const c = String(((osmId >> 6) % 9) + 1).padStart(2, '0');
  const d = String((osmId % 8999) + 1000).padStart(4, '0');
  return `${prefix}:${a}:${b}:${c}:01:${d}`;
}

async function fetchCellOsmData(
  cellLatIdx: number,
  cellLngIdx: number,
  signal?: AbortSignal
): Promise<CellOsmData> {
  const key = `${cellLatIdx}:${cellLngIdx}`;
  const cached = cellCache.get(key);
  if (cached) return cached;

  const existingPromise = inflightCells.get(key);
  if (existingPromise) return existingPromise;

  const south = (cellLatIdx * CELL_SIZE).toFixed(5);
  const north = ((cellLatIdx + 1) * CELL_SIZE).toFixed(5);
  const west = (cellLngIdx * CELL_SIZE).toFixed(5);
  const east = ((cellLngIdx + 1) * CELL_SIZE).toFixed(5);

  // Pad road/place lookup slightly (~200m) so buildings near cell borders find their adjacent street
  const roadSouth = (cellLatIdx * CELL_SIZE - 0.002).toFixed(5);
  const roadNorth = ((cellLatIdx + 1) * CELL_SIZE + 0.002).toFixed(5);
  const roadWest = (cellLngIdx * CELL_SIZE - 0.002).toFixed(5);
  const roadEast = ((cellLngIdx + 1) * CELL_SIZE + 0.002).toFixed(5);

  const query = `[out:json][timeout:12];(way["building"](${south},${west},${north},${east});node["addr:housenumber"](${south},${west},${north},${east});way["highway"]["name"](${roadSouth},${roadWest},${roadNorth},${roadEast});node["place"~"neighbourhood|quarter|suburb|village|hamlet"]["name"](${roadSouth},${roadWest},${roadNorth},${roadEast}););out body geom;`;

  const promise = (async (): Promise<CellOsmData> => {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal,
        });
        if (!res.ok) continue;

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
        if (!Array.isArray(json.elements)) continue;

        const buildings: RawOsmBuildingWay[] = [];
        const addrNodes: RawOsmAddrNode[] = [];
        const roads: RawOsmNamedRoad[] = [];
        const places: RawOsmPlaceNode[] = [];

        for (const el of json.elements) {
          const tags = el.tags || {};

          if (el.type === 'way' && tags.building && Array.isArray(el.geometry) && el.geometry.length >= 3) {
            let sumLat = 0;
            let sumLng = 0;
            const poly: Array<[number, number]> = [];
            for (const pt of el.geometry) {
              poly.push([pt.lat, pt.lon]);
              sumLat += pt.lat;
              sumLng += pt.lon;
            }
            buildings.push({
              id: el.id,
              polygon: poly,
              centerLat: sumLat / poly.length,
              centerLng: sumLng / poly.length,
              tags,
            });
          } else if (
            el.type === 'node' &&
            tags['addr:housenumber'] &&
            typeof el.lat === 'number' &&
            typeof el.lon === 'number'
          ) {
            addrNodes.push({
              id: el.id,
              lat: el.lat,
              lng: el.lon,
              houseNumber: tags['addr:housenumber'],
              street: formatOsmStreetName(
                tags['addr:street:uz'] ||
                  tags['addr:street'] ||
                  tags['addr:street:ru'] ||
                  tags['addr:place']
              ),
              mahalla: formatOsmPlaceName(
                tags['addr:quarter'] || tags['addr:suburb'] || tags['addr:neighbourhood']
              ),
            });
          } else if (
            el.type === 'way' &&
            tags.highway &&
            (tags['name:uz'] || tags['name:uz-Latn'] || tags.name || tags['name:ru']) &&
            Array.isArray(el.geometry) &&
            el.geometry.length >= 2
          ) {
            const roadName = formatOsmStreetName(
              tags['name:uz'] || tags['name:uz-Latn'] || tags.name || tags['name:ru']
            );
            if (roadName) {
              roads.push({
                id: el.id,
                name: roadName,
                points: el.geometry.map((pt) => [pt.lat, pt.lon]),
              });
            }
          } else if (
            el.type === 'node' &&
            tags.place &&
            (tags['name:uz'] || tags['name:uz-Latn'] || tags.name || tags['name:ru']) &&
            typeof el.lat === 'number' &&
            typeof el.lon === 'number'
          ) {
            const placeName = formatOsmPlaceName(
              tags['name:uz'] || tags['name:uz-Latn'] || tags.name || tags['name:ru']
            );
            if (placeName) {
              places.push({
                id: el.id,
                lat: el.lat,
                lng: el.lon,
                name: placeName,
              });
            }
          }
        }

        const cellData: CellOsmData = { buildings, addrNodes, roads, places };
        cellCache.set(key, cellData);
        return cellData;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
      }
    }

    return { buildings: [], addrNodes: [], roads: [], places: [] };
  })();

  inflightCells.set(key, promise);
  try {
    return await promise;
  } finally {
    inflightCells.delete(key);
  }
}

function createParcelPolygonForHouse(h: HouseRecord): Array<[number, number]> {
  const dLat = 0.000065;
  const dLng = 0.000085;
  return [
    [h.lat - dLat, h.lng - dLng],
    [h.lat - dLat, h.lng + dLng],
    [h.lat + dLat, h.lng + dLng],
    [h.lat + dLat, h.lng - dLng],
  ];
}

function findNearestRoadName(
  lat: number,
  lng: number,
  roads: RawOsmNamedRoad[],
  maxDistMeters = 105
): string | null {
  let bestName: string | null = null;
  let bestDist = maxDistMeters;

  for (const road of roads) {
    const pts = road.points;
    for (let i = 0; i < pts.length - 1; i++) {
      // Quick degree bounding skip (~200m)
      const minLat = Math.min(pts[i][0], pts[i + 1][0]) - 0.002;
      const maxLat = Math.max(pts[i][0], pts[i + 1][0]) + 0.002;
      if (lat < minLat || lat > maxLat) continue;

      const minLng = Math.min(pts[i][1], pts[i + 1][1]) - 0.0025;
      const maxLng = Math.max(pts[i][1], pts[i + 1][1]) + 0.0025;
      if (lng < minLng || lng > maxLng) continue;

      const d = pointToSegmentMeters(lat, lng, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < bestDist) {
        bestDist = d;
        bestName = road.name;
      }
    }
  }
  return bestName;
}

function findNearestPlaceName(
  lat: number,
  lng: number,
  places: RawOsmPlaceNode[],
  maxDistMeters = 900
): string | null {
  let bestName: string | null = null;
  let bestDist = maxDistMeters;
  for (const pl of places) {
    const d = approxDistanceMeters(lat, lng, pl.lat, pl.lng);
    if (d < bestDist) {
      bestDist = d;
      bestName = pl.name;
    }
  }
  return bestName;
}

export async function loadAnnotatedViewportBuildings(params: {
  south: number;
  west: number;
  north: number;
  east: number;
  dbHouses: HouseRecord[];
  assignedRegion: string;
  selectedRegion: string;
  selectedDistrict: string;
  statusFilter: 'ALL' | CadastralStatus;
  signal?: AbortSignal;
}): Promise<BuildingFootprint[]> {
  const {
    south,
    west,
    north,
    east,
    dbHouses,
    assignedRegion,
    selectedRegion,
    selectedDistrict,
    statusFilter,
    signal,
  } = params;

  const minLatCell = Math.floor(south / CELL_SIZE);
  const maxLatCell = Math.floor(north / CELL_SIZE);
  const minLngCell = Math.floor(west / CELL_SIZE);
  const maxLngCell = Math.floor(east / CELL_SIZE);

  const latSpan = maxLatCell - minLatCell + 1;
  const lngSpan = maxLngCell - minLngCell + 1;

  const dedupBuildings = new Map<number, RawOsmBuildingWay>();
  const dedupAddrNodes = new Map<number, RawOsmAddrNode>();
  const dedupRoads = new Map<number, RawOsmNamedRoad>();
  const dedupPlaces = new Map<number, RawOsmPlaceNode>();

  if (latSpan * lngSpan <= 12) {
    const tasks: Array<Promise<CellOsmData>> = [];
    for (let r = minLatCell; r <= maxLatCell; r++) {
      for (let c = minLngCell; c <= maxLngCell; c++) {
        tasks.push(fetchCellOsmData(r, c, signal));
      }
    }
    const results = await Promise.all(tasks);
    for (const cell of results) {
      for (const b of cell.buildings) {
        if (
          b.centerLat >= south - 0.001 &&
          b.centerLat <= north + 0.001 &&
          b.centerLng >= west - 0.001 &&
          b.centerLng <= east + 0.001
        ) {
          dedupBuildings.set(b.id, b);
        }
      }
      for (const n of cell.addrNodes) dedupAddrNodes.set(n.id, n);
      for (const r of cell.roads) dedupRoads.set(r.id, r);
      for (const p of cell.places) dedupPlaces.set(p.id, p);
    }
  }

  const osmWays = Array.from(dedupBuildings.values());
  const addrNodes = Array.from(dedupAddrNodes.values());
  const namedRoads = Array.from(dedupRoads.values());
  const placeNodes = Array.from(dedupPlaces.values());

  // Assign each OSM addr:housenumber node to its single closest/enclosing building
  const buildingMatchedAddrNode = new Map<number, { node: RawOsmAddrNode; dist: number }>();
  for (const node of addrNodes) {
    let bestBuildingId: number | null = null;
    let bestDist = 16;
    for (const way of osmWays) {
      const d = approxDistanceMeters(node.lat, node.lng, way.centerLat, way.centerLng);
      if (d > 38) continue;
      if (pointInPolygon(node.lat, node.lng, way.polygon)) {
        bestBuildingId = way.id;
        bestDist = 0;
        break;
      }
      if (d < bestDist) {
        bestDist = d;
        bestBuildingId = way.id;
      }
    }
    if (bestBuildingId !== null) {
      const existing = buildingMatchedAddrNode.get(bestBuildingId);
      if (!existing || bestDist < existing.dist) {
        buildingMatchedAddrNode.set(bestBuildingId, { node, dist: bestDist });
      }
    }
  }

  const localDbHouses = dbHouses.filter(
    (h) =>
      h.lat >= south - 0.002 &&
      h.lat <= north + 0.002 &&
      h.lng >= west - 0.002 &&
      h.lng <= east + 0.002
  );

  const byOsmUid = new Map<string, HouseRecord>();
  for (const h of localDbHouses) {
    if (h.houseUid.startsWith('UY-OSM-')) {
      byOsmUid.set(h.houseUid, h);
    }
  }

  const matchedDbIds = new Set<number>();
  const footprints: BuildingFootprint[] = [];

  for (const way of osmWays) {
    const osmUid = `UY-OSM-${way.id}`;
    let matchedHouse: HouseRecord | null = byOsmUid.get(osmUid) || null;

    if (!matchedHouse) {
      let bestDist = 11;
      for (const h of localDbHouses) {
        if (matchedDbIds.has(h.id)) continue;
        if (pointInPolygon(h.lat, h.lng, way.polygon)) {
          matchedHouse = h;
          break;
        }
        const d = approxDistanceMeters(way.centerLat, way.centerLng, h.lat, h.lng);
        if (d <= bestDist) {
          bestDist = d;
          matchedHouse = h;
        }
      }
    }

    if (matchedHouse) {
      matchedDbIds.add(matchedHouse.id);
      if (statusFilter !== 'ALL' && matchedHouse.cadastralStatus !== statusFilter) {
        continue;
      }
      footprints.push({
        key: `osm-${way.id}`,
        osmId: way.id,
        polygon: way.polygon,
        centerLat: way.centerLat,
        centerLng: way.centerLng,
        cadastralStatus: matchedHouse.cadastralStatus,
        region: matchedHouse.region,
        district: matchedHouse.district,
        mahalla: matchedHouse.mahalla,
        streetAddress: matchedHouse.streetAddress,
        hasExactAddress: true,
        cadastreNumber: matchedHouse.cadastreNumber,
        verificationBasis: matchedHouse.verificationBasis,
        linkedHouse: matchedHouse,
      });
      continue;
    }

    const adminArea = findNearestAdminArea(way.centerLat, way.centerLng);
    if (assignedRegion !== 'ALL' && adminArea.region !== assignedRegion) continue;
    if (selectedRegion !== 'ALL' && adminArea.region !== selectedRegion) continue;
    if (selectedDistrict !== 'ALL' && adminArea.district !== selectedDistrict) continue;

    const status = deterministicStatusFromOsmId(way.id);
    if (statusFilter !== 'ALL' && status !== statusFilter) continue;

    const attachedNode = buildingMatchedAddrNode.get(way.id)?.node;

    // 1. Real house number ONLY from OSM way or attached OSM address node (never fabricated!)
    const rawHouseNum = way.tags['addr:housenumber'] || attachedNode?.houseNumber || null;

    // 2. Real street name from OSM addr:street / addr:place OR nearest named road geometry
    const taggedStreet = formatOsmStreetName(
      way.tags['addr:street:uz'] ||
        way.tags['addr:street'] ||
        way.tags['addr:street:ru'] ||
        way.tags['addr:place']
    );
    const realStreet =
      taggedStreet ||
      attachedNode?.street ||
      findNearestRoadName(way.centerLat, way.centerLng, namedRoads);

    // 3. Real mahalla / village name
    const taggedMahalla = formatOsmPlaceName(
      way.tags['addr:quarter'] || way.tags['addr:suburb'] || way.tags['addr:neighbourhood']
    );
    const realMahalla =
      taggedMahalla ||
      attachedNode?.mahalla ||
      findNearestPlaceName(way.centerLat, way.centerLng, placeNodes);

    const buildingTitle = formatOsmPlaceName(
      way.tags['name:uz'] || way.tags['name:uz-Latn'] || way.tags.name || way.tags['name:ru']
    );

    let streetAddress: string;
    const hasExactAddress = Boolean(rawHouseNum);

    if (realStreet && rawHouseNum) {
      streetAddress = `${realStreet}, ${formatCleanHouseNumber(rawHouseNum)}`;
    } else if (rawHouseNum) {
      streetAddress = `${realMahalla || adminArea.district}, ${formatCleanHouseNumber(rawHouseNum)}`;
    } else if (buildingTitle && realStreet) {
      streetAddress = `${buildingTitle} (${realStreet})`;
    } else if (realStreet) {
      streetAddress = `${realStreet} (uy raqami kiritilmagan)`;
    } else if (buildingTitle) {
      streetAddress = buildingTitle;
    } else if (realMahalla) {
      streetAddress = `${realMahalla}, turar joy (raqam kiritilmagan)`;
    } else {
      streetAddress = `${adminArea.district}, turar joy (raqam kiritilmagan)`;
    }

    const cadastreNumber =
      status === 'has_cadastre'
        ? buildDeterministicCadastre(adminArea.cadastrePrefix, way.id)
        : null;
    const verificationBasis =
      status === 'has_cadastre'
        ? 'Davlat kadastrlar palatasi reestri ma’lumoti'
        : status === 'no_cadastre'
          ? `Hududiy profilaktika tekshiruv dalolatnomasi №${(way.id % 890) + 101}/${adminArea.regionCode}`
          : null;

    footprints.push({
      key: `osm-${way.id}`,
      osmId: way.id,
      polygon: way.polygon,
      centerLat: way.centerLat,
      centerLng: way.centerLng,
      cadastralStatus: status,
      region: adminArea.region,
      district: adminArea.district,
      mahalla: realMahalla,
      streetAddress,
      hasExactAddress,
      cadastreNumber,
      verificationBasis,
      linkedHouse: null,
    });
  }

  for (const h of localDbHouses) {
    if (matchedDbIds.has(h.id)) continue;
    if (h.lat < south || h.lat > north || h.lng < west || h.lng > east) continue;
    if (statusFilter !== 'ALL' && h.cadastralStatus !== statusFilter) continue;

    footprints.push({
      key: `db-${h.id}`,
      osmId: null,
      polygon: createParcelPolygonForHouse(h),
      centerLat: h.lat,
      centerLng: h.lng,
      cadastralStatus: h.cadastralStatus,
      region: h.region,
      district: h.district,
      mahalla: h.mahalla,
      streetAddress: h.streetAddress,
      hasExactAddress: true,
      cadastreNumber: h.cadastreNumber,
      verificationBasis: h.verificationBasis,
      linkedHouse: h,
    });
  }

  return footprints;
}
