import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  MapPin,
  Loader2,
  Navigation,
} from 'lucide-react';
import {
  extractHouseNumberFromText,
  geocodeUzbekistanAddress,
  parseUzbekAddressQuery,
  streetTokensMatch,
} from '../lib/geocoding.ts';
import type { GeocodedPlace } from '../lib/geocoding.ts';
import type { CadastralStatus, HouseRecord } from '../shared/types.ts';
import {
  UZBEKISTAN_CENTER,
  UZBEKISTAN_DEFAULT_ZOOM,
  UZBEKISTAN_REGIONS,
  getStatusLabel,
  normalizeUzbekSearch,
} from '../shared/uzbekistanRegions.ts';
import { SearchableGeoSelect } from './SearchableGeoSelect.tsx';
import type { GeoOption } from './SearchableGeoSelect.tsx';

interface AddressSearchBarProps {
  allHouses: HouseRecord[];
  selectedRegion: string;
  selectedDistrict: string;
  statusFilter: 'ALL' | CadastralStatus;
  assignedRegion: string;
  onRegionChange: (region: string, target?: { lat: number; lng: number; zoom: number }) => void;
  onDistrictChange: (
    district: string,
    target?: { lat: number; lng: number; zoom: number },
    autoRegion?: string
  ) => void;
  onStatusFilterChange: (status: 'ALL' | CadastralStatus) => void;
  onSelectSearchResult: (house: HouseRecord) => void;
  onSelectGeocodedPlace: (place: GeocodedPlace) => Promise<void> | void;
}

type NavigableItem =
  | { kind: 'house'; house: HouseRecord }
  | { kind: 'place'; place: GeocodedPlace }
  | {
      kind: 'area';
      area: {
        type: 'region' | 'district';
        regionName: string;
        districtName?: string;
        lat: number;
        lng: number;
        zoom: number;
      };
    };

export function AddressSearchBar({
  allHouses,
  selectedRegion,
  selectedDistrict,
  statusFilter,
  assignedRegion,
  onRegionChange,
  onDistrictChange,
  onStatusFilterChange,
  onSelectSearchResult,
  onSelectGeocodedPlace,
}: AddressSearchBarProps) {
  const [query, setQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [geocodedPlaces, setGeocodedPlaces] = useState<GeocodedPlace[]>([]);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [submittingEnter, setSubmittingEnter] = useState(false);
  const [notFoundNotice, setNotFoundNotice] = useState<string | null>(null);
  const [ambiguousNotice, setAmbiguousNotice] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const availableRegions = useMemo(() => {
    if (assignedRegion && assignedRegion !== 'ALL') {
      return UZBEKISTAN_REGIONS.filter((r) => r.name === assignedRegion);
    }
    return UZBEKISTAN_REGIONS;
  }, [assignedRegion]);

  const regionOptions: GeoOption[] = useMemo(
    () =>
      availableRegions.map((r) => ({
        value: r.name,
        label: r.name,
        subtitle: `${r.districts.length} tuman/sh.`,
        meta: r,
      })),
    [availableRegions]
  );

  const currentRegionObj = useMemo(
    () => UZBEKISTAN_REGIONS.find((r) => r.name === selectedRegion) || null,
    [selectedRegion]
  );

  const districtOptions: GeoOption[] = useMemo(() => {
    if (currentRegionObj) {
      return currentRegionObj.districts.map((d) => ({
        value: d.name,
        label: d.name,
        meta: { regionName: currentRegionObj.name, district: d },
      }));
    }

    const list: GeoOption[] = [];
    for (const reg of availableRegions) {
      for (const dist of reg.districts) {
        list.push({
          value: dist.name,
          label: dist.name,
          subtitle: reg.name.replace(/ viloyati| Respublikasi/i, ''),
          meta: { regionName: reg.name, district: dist },
        });
      }
    }
    return list;
  }, [currentRegionObj, availableRegions]);

  // Matching administrative areas (regions & districts)
  const matchingAdminAreas = useMemo(() => {
    const cleaned = normalizeUzbekSearch(query);
    if (cleaned.length < 2) return [];
    const tokens = cleaned.split(' ').filter(Boolean);

    const results: Array<{
      type: 'region' | 'district';
      regionName: string;
      districtName?: string;
      lat: number;
      lng: number;
      zoom: number;
    }> = [];

    for (const reg of availableRegions) {
      const regSearch = normalizeUzbekSearch(reg.name);
      if (tokens.every((t) => regSearch.includes(t))) {
        results.push({
          type: 'region',
          regionName: reg.name,
          lat: reg.lat,
          lng: reg.lng,
          zoom: reg.zoom,
        });
      }
      for (const dist of reg.districts) {
        const distSearch = normalizeUzbekSearch(`${reg.name} ${dist.name}`);
        if (tokens.every((t) => distSearch.includes(t))) {
          results.push({
            type: 'district',
            regionName: reg.name,
            districtName: dist.name,
            lat: dist.lat,
            lng: dist.lng,
            zoom: dist.zoom || 15,
          });
        }
      }
    }
    return results.slice(0, 4);
  }, [availableRegions, query]);

  // Strict, accurate address matching (word-boundary street tokens + exact house number equality)
  const matchingHouses = useMemo(() => {
    const rawTrimmed = query.trim();
    if (rawTrimmed.length < 2) return [];

    // Direct lookup by House UID (e.g. UY-TOS-000001) or Cadastre Number (e.g. 10:05:...)
    const isUidOrCadastre = /^uy-/i.test(rawTrimmed) || /\d{2}:\d{2}/.test(rawTrimmed);
    if (isUidOrCadastre) {
      const qLower = rawTrimmed.toLowerCase();
      return allHouses
        .filter((h) => {
          if (assignedRegion !== 'ALL' && h.region !== assignedRegion) return false;
          return (
            h.houseUid.toLowerCase().includes(qLower) ||
            (h.cadastreNumber && h.cadastreNumber.toLowerCase().includes(qLower))
          );
        })
        .slice(0, 10);
    }

    const parsedTyped = parseUzbekAddressQuery(rawTrimmed);
    const queryHouseNum = parsedTyped.houseNumber;

    // If user ONLY typed a region or district name (no street/mahalla and no house number),
    // let matchingAdminAreas handle zooming to that region/district instead of opening a random house!
    if (parsedTyped.streetTokens.length === 0 && !queryHouseNum) {
      return [];
    }

    // Require street/mahalla tokens if no district is selected, so bare "15-uy" doesn't pull random provinces
    if (
      parsedTyped.streetTokens.length === 0 &&
      !parsedTyped.district &&
      selectedDistrict === 'ALL'
    ) {
      return [];
    }

    const effectiveRegion =
      assignedRegion !== 'ALL'
        ? assignedRegion
        : parsedTyped.region || (selectedRegion !== 'ALL' ? selectedRegion : null);

    const effectiveDistrict =
      parsedTyped.district ||
      (!parsedTyped.region && selectedDistrict !== 'ALL' ? selectedDistrict : null);

    const scored: Array<{ house: HouseRecord; score: number }> = [];

    for (const h of allHouses) {
      if (effectiveRegion && h.region !== effectiveRegion) continue;
      if (effectiveDistrict && h.district !== effectiveDistrict) continue;

      const recHouseNum = extractHouseNumberFromText(h.streetAddress);

      // Exact house number check: searching "2" or "12" NEVER matches "22-uy" or "24-uy"!
      if (queryHouseNum) {
        if (!recHouseNum || recHouseNum !== queryHouseNum) {
          continue;
        }
      }

      const streetWords = normalizeUzbekSearch(`${h.mahalla || ''} ${h.streetAddress}`)
        .split(' ')
        .filter(Boolean);

      const allStreetTokensMatch = parsedTyped.streetTokens.every((tok) =>
        streetWords.some((w) => streetTokensMatch(tok, w))
      );

      if (!allStreetTokensMatch) continue;

      let score = 100;
      if (queryHouseNum && recHouseNum === queryHouseNum) score += 80;
      if (selectedRegion !== 'ALL' && h.region === selectedRegion) score += 20;
      if (selectedDistrict !== 'ALL' && h.district === selectedDistrict) score += 30;
      if (parsedTyped.district && h.district === parsedTyped.district) score += 40;

      scored.push({ house: h, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10).map((s) => s.house);
  }, [allHouses, query, selectedRegion, selectedDistrict, assignedRegion]);

  // Live debounced OpenStreetMap geocoding so villages, streets, and house addresses across Uzbekistan can be found
  useEffect(() => {
    const trimmed = query.trim();
    setNotFoundNotice(null);
    setAmbiguousNotice(null);
    setHighlightedIndex(-1);

    if (trimmed.length < 3) {
      setGeocodedPlaces([]);
      setGeocodingLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGeocodingLoading(true);
      try {
        const places = await geocodeUzbekistanAddress(trimmed, {
          selectedRegion: assignedRegion !== 'ALL' ? assignedRegion : selectedRegion,
          selectedDistrict,
          signal: controller.signal,
        });
        const filtered =
          assignedRegion !== 'ALL'
            ? places.filter((p) => p.region === assignedRegion)
            : places;
        setGeocodedPlaces(filtered.slice(0, 6));
      } catch {
        // Aborted or offline
      } finally {
        if (!controller.signal.aborted) {
          setGeocodingLoading(false);
        }
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedRegion, selectedDistrict, assignedRegion]);

  // Unified keyboard-navigable list (Database houses -> Map geocoded addresses -> Admin areas)
  const navigableItems: NavigableItem[] = useMemo(() => {
    const list: NavigableItem[] = [];
    for (const h of matchingHouses) {
      list.push({ kind: 'house', house: h });
    }
    for (const p of geocodedPlaces) {
      list.push({ kind: 'place', place: p });
    }
    for (const a of matchingAdminAreas) {
      list.push({ kind: 'area', area: a });
    }
    return list;
  }, [matchingHouses, geocodedPlaces, matchingAdminAreas]);

  const executeNavigableItem = async (item: NavigableItem) => {
    setDropdownOpen(false);
    setNotFoundNotice(null);
    setAmbiguousNotice(null);

    if (item.kind === 'house') {
      onSelectSearchResult(item.house);
      return;
    }

    if (item.kind === 'place') {
      await onSelectGeocodedPlace(item.place);
      return;
    }

    if (item.area.type === 'region') {
      onRegionChange(item.area.regionName, {
        lat: item.area.lat,
        lng: item.area.lng,
        zoom: item.area.zoom,
      });
    } else if (item.area.districtName) {
      onDistrictChange(
        item.area.districtName,
        { lat: item.area.lat, lng: item.area.lng, zoom: item.area.zoom },
        item.area.regionName
      );
    }
  };

  // Pressing Enter in the search input finds the exact target house or disambiguates similar addresses
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    setNotFoundNotice(null);
    setAmbiguousNotice(null);

    // 1. If user navigated with ArrowDown/ArrowUp, activate highlighted item
    if (highlightedIndex >= 0 && highlightedIndex < navigableItems.length) {
      setSubmittingEnter(true);
      try {
        await executeNavigableItem(navigableItems[highlightedIndex]);
      } finally {
        setSubmittingEnter(false);
      }
      return;
    }

    const isUidOrCadastre = /^uy-/i.test(trimmed) || /\d{2}:\d{2}/.test(trimmed);
    if (isUidOrCadastre && matchingHouses.length > 0) {
      setDropdownOpen(false);
      onSelectSearchResult(matchingHouses[0]);
      return;
    }

    const parsedTyped = parseUzbekAddressQuery(trimmed);

    // 2. If user typed a specific house number and there is an unambiguous match in DB, open it
    if (parsedTyped.houseNumber && matchingHouses.length === 1) {
      setDropdownOpen(false);
      onSelectSearchResult(matchingHouses[0]);
      return;
    }

    // If multiple houses in DB match (e.g. same street + house number in different districts), let user pick
    if (parsedTyped.houseNumber && matchingHouses.length > 1) {
      const distinctAreas = new Set(matchingHouses.map((h) => `${h.region}|${h.district}`));
      if (distinctAreas.size > 1) {
        setDropdownOpen(true);
        setAmbiguousNotice(
          `Bir xil nomdagi ${matchingHouses.length} ta uy topildi — ro‘yxatdan kerakli tuman/mahallani tanlang:`
        );
        return;
      }
      setDropdownOpen(false);
      onSelectSearchResult(matchingHouses[0]);
      return;
    }

    // 3. Geocode the typed Uzbekistan address (village / street / house number) live
    setSubmittingEnter(true);
    try {
      const places = await geocodeUzbekistanAddress(trimmed, {
        selectedRegion: assignedRegion !== 'ALL' ? assignedRegion : selectedRegion,
        selectedDistrict,
      });

      const allowedPlaces =
        assignedRegion !== 'ALL' ? places.filter((p) => p.region === assignedRegion) : places;

      setGeocodedPlaces(allowedPlaces.slice(0, 6));

      if (allowedPlaces.length > 0) {
        const top = allowedPlaces[0];
        const second = allowedPlaces[1];
        const uniqueTopExact = Boolean(top.exactHouseMatch && (!second || !second.exactHouseMatch));
        const districtWasSpecified = Boolean(parsedTyped.district || selectedDistrict !== 'ALL');
        const distinctDistricts = new Set(
          allowedPlaces.slice(0, 4).map((p) => `${p.region}|${p.district}`)
        );

        // TZ Section 6: If similar addresses exist across multiple districts and user didn't specify district,
        // let the user pick the right one instead of jumping to a wrong city!
        if (!uniqueTopExact && !districtWasSpecified && distinctDistricts.size > 1) {
          setDropdownOpen(true);
          setAmbiguousNotice(
            'Bir nechta hududda o‘xshash manzil topildi — kerakli tuman yoki shaharni tanlang:'
          );
          return;
        }

        setDropdownOpen(false);
        await onSelectGeocodedPlace(top);
        return;
      }

      // 4. If user typed street name without house number and DB has 1 house on that street, or multiple
      if (matchingHouses.length === 1) {
        setDropdownOpen(false);
        onSelectSearchResult(matchingHouses[0]);
        return;
      }
      if (matchingHouses.length > 1) {
        setDropdownOpen(true);
        setAmbiguousNotice('Shu ko‘chadagi kerakli uyni ro‘yxatdan tanlang:');
        return;
      }

      // 5. Fallback to administrative region/district match if typed
      if (matchingAdminAreas.length > 0) {
        await executeNavigableItem({ kind: 'area', area: matchingAdminAreas[0] });
        return;
      }

      setDropdownOpen(true);
      setNotFoundNotice(
        'Kiritilgan manzil bo‘yicha uy topilmadi. Viloyat, tuman va ko‘cha yoki qishloq nomini aniqroq kiriting.'
      );
    } finally {
      setSubmittingEnter(false);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDropdownOpen(true);
      if (navigableItems.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % navigableItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDropdownOpen(true);
      if (navigableItems.length > 0) {
        setHighlightedIndex((prev) => (prev <= 0 ? navigableItems.length - 1 : prev - 1));
      }
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  };

  const counts = useMemo(() => {
    const scoped = allHouses.filter((h) => {
      if (selectedRegion !== 'ALL' && h.region !== selectedRegion) return false;
      if (selectedDistrict !== 'ALL' && h.district !== selectedDistrict) return false;
      return true;
    });
    return {
      all: scoped.length,
      has_cadastre: scoped.filter((h) => h.cadastralStatus === 'has_cadastre').length,
      no_cadastre: scoped.filter((h) => h.cadastralStatus === 'no_cadastre').length,
      unknown: scoped.filter((h) => h.cadastralStatus === 'unknown').length,
    };
  }, [allHouses, selectedRegion, selectedDistrict]);

  const handleRegionSelect = (val: string) => {
    if (val === 'ALL') {
      onRegionChange('ALL', {
        lat: UZBEKISTAN_CENTER[0],
        lng: UZBEKISTAN_CENTER[1],
        zoom: UZBEKISTAN_DEFAULT_ZOOM,
      });
    } else {
      const reg = UZBEKISTAN_REGIONS.find((r) => r.name === val);
      onRegionChange(val, reg ? { lat: reg.lat, lng: reg.lng, zoom: reg.zoom } : undefined);
    }
  };

  const handleDistrictSelect = (val: string, opt?: GeoOption) => {
    if (val === 'ALL') {
      if (currentRegionObj) {
        onDistrictChange('ALL', {
          lat: currentRegionObj.lat,
          lng: currentRegionObj.lng,
          zoom: currentRegionObj.zoom,
        });
      } else {
        onDistrictChange('ALL', {
          lat: UZBEKISTAN_CENTER[0],
          lng: UZBEKISTAN_CENTER[1],
          zoom: UZBEKISTAN_DEFAULT_ZOOM,
        });
      }
      return;
    }

    const meta = opt?.meta as
      | { regionName: string; district: { name: string; lat: number; lng: number; zoom?: number } }
      | undefined;

    if (meta) {
      onDistrictChange(
        meta.district.name,
        {
          lat: meta.district.lat,
          lng: meta.district.lng,
          zoom: meta.district.zoom || 15,
        },
        meta.regionName
      );
      return;
    }

    const dist = currentRegionObj?.districts.find((d) => d.name === val);
    onDistrictChange(val, dist ? { lat: dist.lat, lng: dist.lng, zoom: dist.zoom || 15 } : undefined);
  };

  let runningIndex = -1;

  return (
    <div className="border-b border-slate-200 bg-white px-3 sm:px-5 py-2.5">
      <div className="flex flex-col xl:flex-row xl:items-center gap-2.5">
        {/* Search Form (Supports Enter key & Topish button) + Viloyat & Tuman Comboboxes */}
        <div className="flex flex-col md:flex-row md:items-center gap-2 flex-1 min-w-0">
          <div ref={wrapperRef} className="relative flex-1 min-w-0">
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-1.5">
              <div className="relative flex-1 min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onFocus={() => setDropdownOpen(true)}
                  onKeyDown={handleInputKeyDown}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setDropdownOpen(true);
                  }}
                  placeholder="Uy manzilini yozing va Enter bosing (qishloq, ko‘cha, uy raqami)..."
                  className="w-full rounded-lg border border-slate-300 bg-slate-50/60 pl-9 pr-8 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:bg-white focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 min-h-[40px]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setGeocodedPlaces([]);
                      setNotFoundNotice(null);
                      setDropdownOpen(false);
                      inputRef.current?.focus();
                    }}
                    aria-label="Qidiruvni tozalash"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={submittingEnter || query.trim().length < 2}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
              >
                {submittingEnter ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                <span>Topish</span>
              </button>
            </form>

            {dropdownOpen && query.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-[650] rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden max-h-96 overflow-y-auto">
                {ambiguousNotice && (
                  <div className="px-3.5 py-2 bg-amber-50 border-b border-amber-200 text-xs font-medium text-amber-900">
                    {ambiguousNotice}
                  </div>
                )}

                {/* 1. Database house matches */}
                {matchingHouses.length > 0 && (
                  <div className="border-b border-slate-100">
                    <div className="px-3.5 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                      <span>Bazadagi topilgan uylar ({matchingHouses.length} ta)</span>
                      <span>Tanlash uchun bosing</span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {matchingHouses.map((h) => {
                        runningIndex += 1;
                        const itemIndex = runningIndex;
                        const isHighlighted = highlightedIndex === itemIndex;
                        return (
                          <li key={h.id}>
                            <button
                              type="button"
                              onClick={() => void executeNavigableItem({ kind: 'house', house: h })}
                              className={`w-full text-left px-3.5 py-2.5 transition-colors flex items-start justify-between gap-3 ${
                                isHighlighted ? 'bg-slate-100' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900 truncate">
                                  {h.streetAddress}
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5 truncate">
                                  <span>{h.region}</span>
                                  <span aria-hidden="true"> · </span>
                                  <span>{h.district}</span>
                                  {h.mahalla && (
                                    <>
                                      <span aria-hidden="true"> · </span>
                                      <span>{h.mahalla}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-xs font-mono text-slate-500 tabular-nums">
                                  {h.houseUid}
                                </div>
                                <div
                                  className={`text-xs font-medium mt-0.5 whitespace-nowrap ${
                                    h.cadastralStatus === 'has_cadastre'
                                      ? 'text-green-700'
                                      : h.cadastralStatus === 'no_cadastre'
                                        ? 'text-red-700'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  {getStatusLabel(h.cadastralStatus)}
                                </div>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* 2. Live OpenStreetMap geocoded Uzbekistan addresses / villages / houses */}
                {geocodedPlaces.length > 0 && (
                  <div className="border-b border-slate-100">
                    <div className="px-3.5 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                      <span>Xaritadan topilgan manzillar</span>
                      {matchingHouses.length === 0 && <span>Enter — xaritada topish</span>}
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {geocodedPlaces.map((place) => {
                        runningIndex += 1;
                        const itemIndex = runningIndex;
                        const isHighlighted = highlightedIndex === itemIndex;
                        return (
                          <li key={place.id}>
                            <button
                              type="button"
                              onClick={() => void executeNavigableItem({ kind: 'place', place })}
                              className={`w-full text-left px-3.5 py-2.5 transition-colors flex items-center justify-between gap-3 ${
                                isHighlighted ? 'bg-slate-100' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="min-w-0 flex items-start gap-2.5">
                                <Navigation className="h-4 w-4 text-slate-500 shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-900 truncate">
                                    {place.title}
                                  </div>
                                  <div className="text-xs text-slate-500 mt-0.5 truncate">
                                    {place.subtitle}
                                  </div>
                                </div>
                              </div>
                              <span className="text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
                                {place.exactHouseMatch ? 'Uyni ochish' : 'Ko‘chani ko‘rsatish'}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* 3. Matching Regions & Districts */}
                {matchingAdminAreas.length > 0 && (
                  <div className="border-b border-slate-100">
                    <div className="px-3.5 py-1.5 bg-slate-50 text-[11px] font-semibold text-slate-500">
                      Viloyat va tumanlar
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {matchingAdminAreas.map((area, idx) => {
                        runningIndex += 1;
                        const itemIndex = runningIndex;
                        const isHighlighted = highlightedIndex === itemIndex;
                        return (
                          <li key={`${area.regionName}-${area.districtName || idx}`}>
                            <button
                              type="button"
                              onClick={() => void executeNavigableItem({ kind: 'area', area })}
                              className={`w-full text-left px-3.5 py-2 transition-colors flex items-center justify-between gap-2 text-xs sm:text-sm ${
                                isHighlighted ? 'bg-slate-100' : 'hover:bg-slate-50'
                              }`}
                            >
                              <span className="inline-flex items-center gap-2 font-medium text-slate-900 truncate">
                                <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                                <span>
                                  {area.districtName
                                    ? `${area.districtName} · ${area.regionName}`
                                    : area.regionName}
                                </span>
                              </span>
                              <span className="text-xs text-slate-500 shrink-0">Xaritada ochish</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {geocodingLoading && matchingHouses.length === 0 && geocodedPlaces.length === 0 && (
                  <div className="px-4 py-3 text-xs text-slate-600 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                    <span>Manzil O‘zbekiston xaritasidan qidirilmoqda...</span>
                  </div>
                )}

                {!geocodingLoading &&
                  matchingHouses.length === 0 &&
                  geocodedPlaces.length === 0 &&
                  matchingAdminAreas.length === 0 && (
                    <div className="p-4 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">
                        {notFoundNotice || 'Kiritilgan so‘rov bo‘yicha mos manzil topilmadi.'}
                      </div>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        Masalan: «Chilonzor Qatortol 22», «Toyloq Amir Temur 15» yoki qishloq nomini
                        yozib Enter tugmasini bosing.
                      </p>
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Searchable Viloyat & Tuman Comboboxes */}
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 shrink-0">
            <SearchableGeoSelect
              ariaLabel="Viloyatni yozib qidirish yoki tanlash"
              value={selectedRegion}
              options={regionOptions}
              placeholder="Viloyatni yozing..."
              allOptionLabel="Barcha viloyatlar"
              includeAllOption={assignedRegion === 'ALL'}
              disabled={assignedRegion !== 'ALL'}
              onChange={handleRegionSelect}
              className="w-full sm:w-[205px]"
            />

            <SearchableGeoSelect
              ariaLabel="Tumanni yozib qidirish yoki tanlash"
              value={selectedDistrict}
              options={districtOptions}
              placeholder="Tumanni yozing..."
              allOptionLabel="Barcha tumanlar"
              includeAllOption={true}
              onChange={handleDistrictSelect}
              className="w-full sm:w-[205px]"
            />
          </div>
        </div>

        {/* Cadastral Status Segmented Filter */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => onStatusFilterChange('ALL')}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              statusFilter === 'ALL'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Barchasi ({counts.all})
          </button>

          <button
            type="button"
            onClick={() => onStatusFilterChange('has_cadastre')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              statusFilter === 'has_cadastre'
                ? 'bg-white text-green-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
            <span>Kadastrli ({counts.has_cadastre})</span>
          </button>

          <button
            type="button"
            onClick={() => onStatusFilterChange('no_cadastre')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              statusFilter === 'no_cadastre'
                ? 'bg-white text-red-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
            <span>Kadastrsiz ({counts.no_cadastre})</span>
          </button>

          <button
            type="button"
            onClick={() => onStatusFilterChange('unknown')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              statusFilter === 'unknown'
                ? 'bg-white text-amber-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span>Noma’lum ({counts.unknown})</span>
          </button>
        </div>
      </div>
    </div>
  );
}
