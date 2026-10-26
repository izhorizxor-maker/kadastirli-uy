import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, Loader2, Search } from 'lucide-react';
import { geocodeUzbekistanAddress, reverseGeocodeUzbekistanPoint } from '../lib/geocoding.ts';
import { loadAnnotatedViewportBuildings } from '../lib/osmBuildings.ts';
import type { BuildingFootprint } from '../lib/osmBuildings.ts';
import type { CadastralStatus, HouseRecord } from '../shared/types.ts';
import { findNearestAdminArea, getStatusLabel } from '../shared/uzbekistanRegions.ts';

interface VillageMapPickerProps {
  houses: HouseRecord[];
  region: string;
  district: string;
  lat: number;
  lng: number;
  editingId: number | null;
  focusTrigger: number;
  onPickLocation: (picked: {
    lat: number;
    lng: number;
    region: string;
    district: string;
    suggestedMahalla?: string;
    suggestedStreet?: string;
    existingHouse?: HouseRecord;
  }) => void;
}

const STATUS_STYLE: Record<CadastralStatus, { fill: string; stroke: string; glyph: string }> = {
  has_cadastre: { fill: '#16A34A', stroke: '#14532D', glyph: '✓' },
  no_cadastre: { fill: '#DC2626', stroke: '#7F1D1D', glyph: '!' },
  unknown: { fill: '#D97706', stroke: '#78350F', glyph: '?' },
};

function cleanSuggestedStreetForInput(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/turar joy\s*\(raqam kiritilmagan\)/i.test(trimmed)) {
    return undefined;
  }
  if (/\(uy raqami kiritilmagan\)/i.test(trimmed)) {
    const streetOnly = trimmed.replace(/\s*\(uy raqami kiritilmagan\)\s*$/i, '').trim();
    return streetOnly ? `${streetOnly}, ` : undefined;
  }
  return trimmed;
}

export function VillageMapPicker({
  houses,
  region,
  district,
  lat,
  lng,
  editingId,
  focusTrigger,
  onPickLocation,
}: VillageMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const housesLayerRef = useRef<L.LayerGroup | null>(null);
  const buildingsLayerRef = useRef<L.LayerGroup | null>(null);
  const activePinRef = useRef<L.Marker | null>(null);

  const [mapStyle, setMapStyle] = useState<'satellite' | 'street'>('satellite');
  const [villageSearch, setVillageSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

  const housesRef = useRef(houses);
  housesRef.current = houses;
  const onPickRef = useRef(onPickLocation);
  onPickRef.current = onPickLocation;

  const syncBaseTiles = useCallback((map: L.Map, style: 'satellite' | 'street') => {
    if (!tileLayerGroupRef.current) {
      tileLayerGroupRef.current = L.layerGroup().addTo(map);
    }
    const group = tileLayerGroupRef.current;
    group.clearLayers();

    if (style === 'satellite') {
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 21,
          maxNativeZoom: 17,
          attribution: '&copy; Esri',
        }
      ).addTo(group);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 21,
        maxNativeZoom: 19,
        subdomains: 'abcd',
        pane: 'overlayPane',
      }).addTo(group);
    } else {
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 21,
        maxNativeZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(group);
    }
  }, []);

  const renderMapOverlays = useCallback(async () => {
    const map = mapRef.current;
    const housesLayer = housesLayerRef.current;
    const buildingsLayer = buildingsLayerRef.current;
    if (!map || !housesLayer || !buildingsLayer) return;

    const bounds = map.getBounds().pad(0.15);
    const zoom = map.getZoom();

    housesLayer.clearLayers();
    const visibleHouses = housesRef.current.filter((h) => bounds.contains([h.lat, h.lng]));

    for (const h of visibleHouses) {
      const st = STATUS_STYLE[h.cadastralStatus];
      const isEditing = editingId === h.id;
      const size = isEditing ? 26 : 20;

      const marker = L.marker([h.lat, h.lng], {
        icon: L.divIcon({
          className: 'village-house-dot',
          html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${st.fill};border:${isEditing ? '2.5px solid #0F172A' : '1.8px solid #ffffff'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;box-shadow:0 1px 4px rgba(15,23,42,0.4);">${st.glyph}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
      });

      marker.bindTooltip(`${h.streetAddress} · ${getStatusLabel(h.cadastralStatus)}`, {
        direction: 'top',
        offset: [0, -8],
      });

      marker.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        onPickRef.current({
          lat: h.lat,
          lng: h.lng,
          region: h.region,
          district: h.district,
          existingHouse: h,
        });
      });

      marker.addTo(housesLayer);
    }

    buildingsLayer.clearLayers();
    if (zoom >= 15) {
      const b = map.getBounds();
      try {
        const footprints: BuildingFootprint[] = await loadAnnotatedViewportBuildings({
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
          dbHouses: housesRef.current,
          assignedRegion: 'ALL',
          selectedRegion: 'ALL',
          selectedDistrict: 'ALL',
          statusFilter: 'ALL',
        });

        for (const fp of footprints) {
          const st = STATUS_STYLE[fp.cadastralStatus];
          const poly = L.polygon(fp.polygon, {
            color: st.stroke,
            weight: fp.linkedHouse ? 2 : 1.4,
            fillColor: st.fill,
            fillOpacity: fp.linkedHouse ? 0.42 : 0.24,
          });

          poly.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            if (fp.linkedHouse) {
              onPickRef.current({
                lat: fp.linkedHouse.lat,
                lng: fp.linkedHouse.lng,
                region: fp.linkedHouse.region,
                district: fp.linkedHouse.district,
                existingHouse: fp.linkedHouse,
              });
              return;
            }

            onPickRef.current({
              lat: fp.centerLat,
              lng: fp.centerLng,
              region: fp.region,
              district: fp.district,
              suggestedMahalla: fp.mahalla || undefined,
              suggestedStreet: cleanSuggestedStreetForInput(fp.streetAddress),
            });

            if (!fp.hasExactAddress) {
              void reverseGeocodeUzbekistanPoint(fp.centerLat, fp.centerLng).then((rev) => {
                if (!rev) return;
                onPickRef.current({
                  lat: fp.centerLat,
                  lng: fp.centerLng,
                  region: fp.region,
                  district: fp.district,
                  suggestedMahalla: fp.mahalla || rev.mahalla || undefined,
                  suggestedStreet: cleanSuggestedStreetForInput(rev.streetAddress),
                });
              });
            }
          });

          poly.addTo(buildingsLayer);
        }
      } catch {
        // Ignore transient Overpass timeout
      }
    }
  }, [editingId]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialLat = Number.isFinite(lat) ? lat : 41.275;
    const initialLng = Number.isFinite(lng) ? lng : 69.205;

    const map = L.map(containerRef.current, {
      center: [initialLat, initialLng],
      zoom: 16,
      minZoom: 5,
      maxZoom: 21,
      zoomControl: true,
    });

    mapRef.current = map;
    buildingsLayerRef.current = L.layerGroup().addTo(map);
    housesLayerRef.current = L.layerGroup().addTo(map);

    syncBaseTiles(map, 'satellite');

    map.on('click', (e: L.LeafletMouseEvent) => {
      const clickLat = e.latlng.lat;
      const clickLng = e.latlng.lng;

      // Check if an existing house is within ~14m
      const existing = housesRef.current.find(
        (h) => Math.abs(h.lat - clickLat) < 0.00013 && Math.abs(h.lng - clickLng) < 0.00013
      );

      if (existing) {
        onPickRef.current({
          lat: existing.lat,
          lng: existing.lng,
          region: existing.region,
          district: existing.district,
          existingHouse: existing,
        });
        return;
      }

      const nearest = findNearestAdminArea(clickLat, clickLng);
      onPickRef.current({
        lat: clickLat,
        lng: clickLng,
        region: nearest.region,
        district: nearest.district,
      });

      void reverseGeocodeUzbekistanPoint(clickLat, clickLng).then((rev) => {
        if (!rev) return;
        onPickRef.current({
          lat: clickLat,
          lng: clickLng,
          region: nearest.region,
          district: nearest.district,
          suggestedMahalla: rev.mahalla || undefined,
          suggestedStreet: cleanSuggestedStreetForInput(rev.streetAddress),
        });
      });
    });

    map.on('moveend', () => {
      void renderMapOverlays();
    });

    setTimeout(() => {
      map.invalidateSize();
      void renderMapOverlays();
    }, 80);

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerGroupRef.current = null;
      housesLayerRef.current = null;
      buildingsLayerRef.current = null;
      activePinRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    syncBaseTiles(mapRef.current, mapStyle);
  }, [mapStyle, syncBaseTiles]);

  // Update active selected coordinate crosshair pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

    if (!activePinRef.current) {
      activePinRef.current = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'active-draft-pin',
          html: `<div style="width:28px;height:28px;border-radius:9999px;border:3px solid #0F172A;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(15,23,42,0.45);"><div style="width:8px;height:8px;border-radius:9999px;background:#0F172A;"></div></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        zIndexOffset: 900,
      }).addTo(map);
    } else {
      activePinRef.current.setLatLng([lat, lng]);
    }
  }, [lat, lng]);

  // Re-center map only when region/district/search/edit explicitly triggers focus
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !Number.isFinite(lat) || !Number.isFinite(lng) || focusTrigger === 0) return;
    const nextZoom = Math.max(map.getZoom(), 16);
    map.setView([lat, lng], nextZoom, { animate: true });
  }, [focusTrigger, lat, lng]);

  // Re-render house markers when houses array or editingId changes
  useEffect(() => {
    void renderMapOverlays();
  }, [houses, editingId, renderMapOverlays]);

  const handleVillageSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = villageSearch.trim();
    if (!q || !mapRef.current) return;

    setSearching(true);
    setSearchFeedback(null);
    try {
      const results = await geocodeUzbekistanAddress(q, {
        selectedRegion: region,
        selectedDistrict: district,
      });

      if (results.length > 0) {
        const best = results[0];
        mapRef.current.setView([best.lat, best.lng], Math.max(best.zoom, 17), { animate: true });
        onPickRef.current({
          lat: best.lat,
          lng: best.lng,
          region: best.region,
          district: best.district,
          suggestedMahalla: best.mahalla || undefined,
          suggestedStreet: best.exactHouseMatch
            ? best.streetAddress
            : cleanSuggestedStreetForInput(
                `${best.streetAddress.replace(/,\s*\d+[A-Za-z]?-uy$/i, '')} (uy raqami kiritilmagan)`
              ),
        });
        setSearchFeedback(`${best.title} (${best.district}) xaritada ochildi.`);
      } else {
        setSearchFeedback('Manzil topilmadi. Qishloq yoki tuman nomini aniqroq yozing.');
      }
    } catch {
      setSearchFeedback('Qidiruvda xatolik yuz berdi.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-[360px] rounded-lg border border-slate-200 overflow-hidden bg-slate-100">
      {/* Mini-map search + layer bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 border-b border-slate-200">
        <form onSubmit={handleVillageSearchSubmit} className="flex items-center gap-1.5 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={villageSearch}
              onChange={(e) => setVillageSearch(e.target.value)}
              placeholder="Qishloq, mahalla yoki ko‘chani yozib Enter bosing..."
              className="w-full rounded-md border border-slate-300 bg-white pl-8 pr-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span>Topish</span>}
          </button>
        </form>

        <div className="flex items-center gap-1 p-0.5 bg-slate-200/80 rounded-md shrink-0">
          <button
            type="button"
            onClick={() => setMapStyle('satellite')}
            className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors whitespace-nowrap ${
              mapStyle === 'satellite' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Sun’iy yo‘ldosh
          </button>
          <button
            type="button"
            onClick={() => setMapStyle('street')}
            className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors whitespace-nowrap ${
              mapStyle === 'street' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Oddiy xarita
          </button>
        </div>
      </div>

      {/* Interactive Village Map Canvas */}
      <div className="relative flex-1 min-h-[300px]">
        <div ref={containerRef} className="absolute inset-0" />
      </div>

      {/* Instruction / status footer */}
      <div className="px-3 py-2 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <Crosshair className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span>
            {searchFeedback ||
              'Qishloqdagi uy tomini xaritadan bosing — koordinata avtomatik olinadi yoki mavjud uy tahrirlanadi.'}
          </span>
        </span>
        <span className="font-mono text-slate-700 tabular-nums shrink-0">
          {Number.isFinite(lat) ? lat.toFixed(6) : '—'}, {Number.isFinite(lng) ? lng.toFixed(6) : '—'}
        </span>
      </div>
    </div>
  );
}
