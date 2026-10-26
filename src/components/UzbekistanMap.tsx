import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { LocateFixed, Maximize2, Crosshair, X, PlusCircle, Navigation } from 'lucide-react';
import { api } from '../lib/api.ts';
import { reverseGeocodeUzbekistanPoint } from '../lib/geocoding.ts';
import { loadAnnotatedViewportBuildings } from '../lib/osmBuildings.ts';
import type { BuildingFootprint } from '../lib/osmBuildings.ts';
import type { CadastralStatus, HouseRecord } from '../shared/types.ts';
import {
  UZBEKISTAN_CENTER,
  UZBEKISTAN_DEFAULT_ZOOM,
  findNearestAdminArea,
  getStatusLabel,
} from '../shared/uzbekistanRegions.ts';

export interface MapViewportTarget {
  lat: number;
  lng: number;
  zoom: number;
  nonce: number;
}

export interface SearchedLocationPin {
  lat: number;
  lng: number;
  title: string;
  message: string;
}

interface UzbekistanMapProps {
  houses: HouseRecord[];
  allHouses: HouseRecord[];
  assignedRegion: string;
  selectedRegion: string;
  selectedDistrict: string;
  statusFilter: 'ALL' | CadastralStatus;
  canMarkHouses: boolean;
  selectedHouseId: number | null;
  onSelectHouse: (house: HouseRecord) => void;
  onHouseCreatedOnMap: (house: HouseRecord) => void;
  viewportTarget: MapViewportTarget | null;
  searchedLocationPin?: SearchedLocationPin | null;
  onClearSearchedLocationPin?: () => void;
  pickingCoordinates?: boolean;
  onPickCoordinate?: (lat: number, lng: number) => void;
  onCancelPickCoordinate?: () => void;
}

const STATUS_COLORS: Record<
  CadastralStatus,
  { fill: string; stroke: string; badgeText: string }
> = {
  has_cadastre: {
    fill: '#16A34A',
    stroke: '#14532D',
    badgeText: '✓',
  },
  no_cadastre: {
    fill: '#DC2626',
    stroke: '#7F1D1D',
    badgeText: '!',
  },
  unknown: {
    fill: '#D97706',
    stroke: '#78350F',
    badgeText: '?',
  },
};

function createHousePinHtml(status: CadastralStatus, isSelected: boolean): string {
  const palette: Record<CadastralStatus, { fill: string; glyph: string }> = {
    has_cadastre: {
      fill: '#16A34A',
      glyph: `<path d="M9.5 12.5l2 2 4-4.5" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    },
    no_cadastre: {
      fill: '#DC2626',
      glyph: `<path d="M12 8.5v4.2M12 15.6h.01" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" fill="none"/>`,
    },
    unknown: {
      fill: '#D97706',
      glyph: `<path d="M10.3 9.7a1.8 1.8 0 0 1 3.4.8c0 1.2-1.7 1.5-1.7 2.5M12 15.8h.01" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" fill="none"/>`,
    },
  };

  const c = palette[status];
  const size = isSelected ? 40 : 30;
  const ring = isSelected
    ? `<circle cx="12" cy="11" r="10.5" fill="none" stroke="#0F172A" stroke-width="2.2"/>`
    : '';

  return `
    <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 4px rgba(15,23,42,0.28));transform:translateY(-3px);">
      <svg viewBox="0 0 24 28" width="${size}" height="${Math.round(size * 1.15)}" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 1.5C6.75 1.5 2.5 5.75 2.5 11c0 6.6 9.5 15.2 9.5 15.2S21.5 17.6 21.5 11c0-5.25-4.25-9.5-9.5-9.5Z" fill="${c.fill}" stroke="#ffffff" stroke-width="1.8"/>
        ${ring}
        ${c.glyph}
      </svg>
    </div>
  `;
}

function createRooftopBadgeHtml(status: CadastralStatus, isSelected: boolean): string {
  const c = STATUS_COLORS[status];
  const size = isSelected ? 24 : 18;
  const border = isSelected ? '2.5px solid #0F172A' : '1.8px solid #ffffff';
  return `
    <div style="width:${size}px;height:${size}px;border-radius:9999px;background:${c.fill};border:${border};color:#ffffff;display:flex;align-items:center;justify-content:center;font-size:${isSelected ? 12 : 10}px;font-weight:800;line-height:1;box-shadow:0 1px 4px rgba(15,23,42,0.35);">
      ${c.badgeText}
    </div>
  `;
}

function createClusterHtml(items: HouseRecord[]): string {
  const total = items.length;
  const greenCount = items.filter((h) => h.cadastralStatus === 'has_cadastre').length;
  const redCount = items.filter((h) => h.cadastralStatus === 'no_cadastre').length;
  const yellowCount = total - greenCount - redCount;

  const size = total >= 100 ? 52 : total >= 25 ? 46 : total >= 10 ? 42 : 36;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;

  const greenLen = (greenCount / total) * circumference;
  const redLen = (redCount / total) * circumference;
  const yellowLen = (yellowCount / total) * circumference;

  return `
    <div style="width:${size}px;height:${size}px;position:relative;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 3px 6px rgba(15,23,42,0.25));">
      <svg viewBox="0 0 40 40" width="${size}" height="${size}">
        <circle cx="20" cy="20" r="18" fill="#ffffff"/>
        <circle cx="20" cy="20" r="${radius}" fill="none" stroke="#E2E8F0" stroke-width="3.8"/>
        ${
          greenLen > 0
            ? `<circle cx="20" cy="20" r="${radius}" fill="none" stroke="#16A34A" stroke-width="3.8" stroke-dasharray="${greenLen} ${circumference}" stroke-dashoffset="0" transform="rotate(-90 20 20)"/>`
            : ''
        }
        ${
          redLen > 0
            ? `<circle cx="20" cy="20" r="${radius}" fill="none" stroke="#DC2626" stroke-width="3.8" stroke-dasharray="${redLen} ${circumference}" stroke-dashoffset="${-greenLen}" transform="rotate(-90 20 20)"/>`
            : ''
        }
        ${
          yellowLen > 0
            ? `<circle cx="20" cy="20" r="${radius}" fill="none" stroke="#D97706" stroke-width="3.8" stroke-dasharray="${yellowLen} ${circumference}" stroke-dashoffset="${-(greenLen + redLen)}" transform="rotate(-90 20 20)"/>`
            : ''
        }
      </svg>
      <span style="position:absolute;font-family:'JetBrains Mono',monospace;font-size:${total >= 100 ? 11 : 12}px;font-weight:700;color:#0F172A;font-variant-numeric:tabular-nums;">
        ${total}
      </span>
    </div>
  `;
}

export function UzbekistanMap({
  houses,
  allHouses,
  assignedRegion,
  selectedRegion,
  selectedDistrict,
  statusFilter,
  canMarkHouses,
  selectedHouseId,
  onSelectHouse,
  onHouseCreatedOnMap,
  viewportTarget,
  searchedLocationPin = null,
  onClearSearchedLocationPin,
  pickingCoordinates = false,
  onPickCoordinate,
  onCancelPickCoordinate,
}: UzbekistanMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const canvasRendererRef = useRef<L.Canvas | null>(null);

  const buildingsLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const userLocationLayerRef = useRef<L.LayerGroup | null>(null);
  const searchedPinLayerRef = useRef<L.LayerGroup | null>(null);

  const osmStreetTileRef = useRef<L.TileLayer | null>(null);
  const cleanStreetTileRef = useRef<L.TileLayer | null>(null);
  const satelliteTileRef = useRef<L.TileLayer | null>(null);
  const hybridLabelsTileRef = useRef<L.TileLayer | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  const [mapStyle, setMapStyle] = useState<'street' | 'hybrid' | 'clean'>('street');
  const [locating, setLocating] = useState(false);
  const [markingHouseMode, setMarkingHouseMode] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [resolvingClick, setResolvingClick] = useState(false);
  const [geoNotice, setGeoNotice] = useState<string | null>(null);
  const [viewportCounts, setViewportCounts] = useState<{
    zoom: number;
    total: number;
    green: number;
    red: number;
    amber: number;
  }>({ zoom: UZBEKISTAN_DEFAULT_ZOOM, total: 0, green: 0, red: 0, amber: 0 });

  const handleBuildingClick = useCallback(
    async (fp: BuildingFootprint) => {
      if (pickingCoordinates || markingHouseMode) return;
      onClearSearchedLocationPin?.();

      if (fp.linkedHouse) {
        onSelectHouse(fp.linkedHouse);
        return;
      }

      setResolvingClick(true);
      try {
        let resolvedStreet = fp.streetAddress;
        let resolvedMahalla = fp.mahalla;

        // If building lacks an exact house number in OSM, enrich via live reverse geocoding
        if (!fp.hasExactAddress) {
          const rev = await reverseGeocodeUzbekistanPoint(fp.centerLat, fp.centerLng);
          if (rev) {
            if (
              rev.hasHouseNumber ||
              /turar joy/i.test(resolvedStreet) ||
              (!resolvedStreet.includes('ko‘cha') && rev.streetAddress.includes('ko‘cha'))
            ) {
              resolvedStreet = rev.streetAddress;
            }
            if (!resolvedMahalla && rev.mahalla) {
              resolvedMahalla = rev.mahalla;
            }
          }
        }

        const res = await api.resolveBuilding({
          osmId: fp.osmId ?? undefined,
          region: fp.region,
          district: fp.district,
          mahalla: resolvedMahalla ?? undefined,
          streetAddress: resolvedStreet,
          lat: fp.centerLat,
          lng: fp.centerLng,
          cadastralStatus: fp.cadastralStatus,
          cadastreNumber: fp.cadastreNumber,
          verificationBasis: fp.verificationBasis,
        });
        if (res.created) {
          onHouseCreatedOnMap(res.house);
        }
        onSelectHouse(res.house);
      } catch (err) {
        setGeoNotice(
          err instanceof Error ? err.message : 'Tanlangan uy ma’lumotini ochishda xatolik.'
        );
      } finally {
        setResolvingClick(false);
      }
    },
    [
      pickingCoordinates,
      markingHouseMode,
      onSelectHouse,
      onHouseCreatedOnMap,
      onClearSearchedLocationPin,
    ]
  );

  const renderNeighborhoodBuildings = useCallback(async () => {
    const map = mapRef.current;
    const buildingsLayer = buildingsLayerRef.current;
    const markersLayer = markersLayerRef.current;
    const renderer = canvasRendererRef.current;
    if (!map || !buildingsLayer || !markersLayer || !renderer) return;

    const zoom = map.getZoom();
    if (zoom < 15) {
      buildingsLayer.clearLayers();
      setLoadingBuildings(false);
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    const bounds = map.getBounds().pad(0.08);
    setLoadingBuildings(true);

    try {
      const footprints = await loadAnnotatedViewportBuildings({
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
        dbHouses: allHouses,
        assignedRegion,
        selectedRegion,
        selectedDistrict,
        statusFilter,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      buildingsLayer.clearLayers();
      markersLayer.clearLayers();

      let green = 0;
      let red = 0;
      let amber = 0;

      const isHybrid = mapStyle === 'hybrid';
      const showRooftopBadges = zoom >= 16.5 || footprints.length <= 160;

      for (const fp of footprints) {
        if (fp.cadastralStatus === 'has_cadastre') green += 1;
        else if (fp.cadastralStatus === 'no_cadastre') red += 1;
        else amber += 1;

        const isSelected = Boolean(fp.linkedHouse && fp.linkedHouse.id === selectedHouseId);
        const colors = STATUS_COLORS[fp.cadastralStatus];

        const poly = L.polygon(fp.polygon, {
          renderer,
          color: isSelected ? '#0F172A' : isHybrid ? '#FFFFFF' : colors.stroke,
          weight: isSelected ? 3 : isHybrid ? 1.8 : 1.5,
          fillColor: colors.fill,
          fillOpacity: isSelected ? 0.72 : isHybrid ? 0.56 : 0.48,
        });

        const tooltipText = `<div style="font-size:12px;line-height:1.35;"><strong>${fp.streetAddress}</strong><br/><span>${getStatusLabel(
          fp.cadastralStatus
        )}</span>${fp.cadastreNumber ? `<br/><span style="font-family:monospace;">${fp.cadastreNumber}</span>` : ''}</div>`;
        poly.bindTooltip(tooltipText, { sticky: true, direction: 'top', opacity: 0.96 });

        poly.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          void handleBuildingClick(fp);
        });

        buildingsLayer.addLayer(poly);

        if (showRooftopBadges || isSelected) {
          const size = isSelected ? 24 : 18;
          const badgeIcon = L.divIcon({
            className: 'kadastr-marker-icon',
            html: createRooftopBadgeHtml(fp.cadastralStatus, isSelected),
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });
          const badgeMarker = L.marker([fp.centerLat, fp.centerLng], {
            icon: badgeIcon,
            zIndexOffset: isSelected ? 950 : 200,
          });
          badgeMarker.on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            void handleBuildingClick(fp);
          });
          markersLayer.addLayer(badgeMarker);
        }
      }

      setViewportCounts({
        zoom,
        total: footprints.length,
        green,
        red,
        amber,
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('Building layer load error:', err);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoadingBuildings(false);
      }
    }
  }, [
    allHouses,
    assignedRegion,
    selectedRegion,
    selectedDistrict,
    statusFilter,
    selectedHouseId,
    mapStyle,
    handleBuildingClick,
  ]);

  const renderOverviewClusters = useCallback(() => {
    const map = mapRef.current;
    const markersLayer = markersLayerRef.current;
    const buildingsLayer = buildingsLayerRef.current;
    if (!map || !markersLayer || !buildingsLayer) return;

    const zoom = map.getZoom();
    if (zoom >= 15) {
      // Handled by neighborhood building footprint renderer
      return;
    }

    buildingsLayer.clearLayers();
    markersLayer.clearLayers();

    const bounds = map.getBounds().pad(0.2);
    const visibleHouses = houses.filter((h) => bounds.contains([h.lat, h.lng]));

    let green = 0;
    let red = 0;
    let amber = 0;
    for (const h of visibleHouses) {
      if (h.cadastralStatus === 'has_cadastre') green += 1;
      else if (h.cadastralStatus === 'no_cadastre') red += 1;
      else amber += 1;
    }
    setViewportCounts({
      zoom,
      total: visibleHouses.length,
      green,
      red,
      amber,
    });

    if (zoom >= 13.5) {
      visibleHouses.forEach((house) => {
        const isSelected = house.id === selectedHouseId;
        const size = isSelected ? 40 : 30;
        const icon = L.divIcon({
          className: 'kadastr-marker-icon',
          html: createHousePinHtml(house.cadastralStatus, isSelected),
          iconSize: [size, size],
          iconAnchor: [size / 2, size - 2],
        });
        const marker = L.marker([house.lat, house.lng], {
          icon,
          zIndexOffset: isSelected ? 900 : 100,
        });
        marker.bindTooltip(
          `<strong>${house.streetAddress}</strong><br/>${getStatusLabel(house.cadastralStatus)}`,
          { direction: 'top', offset: [0, -20] }
        );
        marker.on('click', () => onSelectHouse(house));
        markersLayer.addLayer(marker);
      });
      return;
    }

    const clusterRadiusPx = zoom <= 7 ? 56 : zoom <= 10 ? 50 : 42;
    const clusters: Array<{
      items: HouseRecord[];
      pxSumX: number;
      pxSumY: number;
    }> = [];

    visibleHouses.forEach((house) => {
      if (house.id === selectedHouseId) {
        const icon = L.divIcon({
          className: 'kadastr-marker-icon',
          html: createHousePinHtml(house.cadastralStatus, true),
          iconSize: [40, 40],
          iconAnchor: [20, 38],
        });
        const marker = L.marker([house.lat, house.lng], { icon, zIndexOffset: 950 });
        marker.on('click', () => onSelectHouse(house));
        markersLayer.addLayer(marker);
        return;
      }

      const pt = map.latLngToContainerPoint([house.lat, house.lng]);
      let matchedCluster: (typeof clusters)[number] | null = null;

      for (const cl of clusters) {
        const cx = cl.pxSumX / cl.items.length;
        const cy = cl.pxSumY / cl.items.length;
        if (Math.hypot(pt.x - cx, pt.y - cy) <= clusterRadiusPx) {
          matchedCluster = cl;
          break;
        }
      }

      if (matchedCluster) {
        matchedCluster.items.push(house);
        matchedCluster.pxSumX += pt.x;
        matchedCluster.pxSumY += pt.y;
      } else {
        clusters.push({
          items: [house],
          pxSumX: pt.x,
          pxSumY: pt.y,
        });
      }
    });

    clusters.forEach((cl) => {
      if (cl.items.length === 1) {
        const house = cl.items[0];
        const icon = L.divIcon({
          className: 'kadastr-marker-icon',
          html: createHousePinHtml(house.cadastralStatus, false),
          iconSize: [30, 30],
          iconAnchor: [15, 28],
        });
        const marker = L.marker([house.lat, house.lng], { icon });
        marker.on('click', () => onSelectHouse(house));
        markersLayer.addLayer(marker);
      } else {
        const avgLat = cl.items.reduce((acc, h) => acc + h.lat, 0) / cl.items.length;
        const avgLng = cl.items.reduce((acc, h) => acc + h.lng, 0) / cl.items.length;
        const size =
          cl.items.length >= 100 ? 52 : cl.items.length >= 25 ? 46 : cl.items.length >= 10 ? 42 : 36;
        const icon = L.divIcon({
          className: 'kadastr-marker-icon',
          html: createClusterHtml(cl.items),
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const clusterMarker = L.marker([avgLat, avgLng], { icon, zIndexOffset: 300 });
        clusterMarker.on('click', () => {
          const clusterBounds = L.latLngBounds(cl.items.map((h) => [h.lat, h.lng]));
          map.flyToBounds(clusterBounds, {
            padding: [55, 55],
            maxZoom: Math.min(16, Math.max(map.getZoom() + 3, 14)),
            duration: 0.5,
          });
        });
        markersLayer.addLayer(clusterMarker);
      }
    });
  }, [houses, selectedHouseId, onSelectHouse]);

  // Initialize Leaflet map once with maxNativeZoom tile scaling so zooming in NEVER blanks out!
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: UZBEKISTAN_CENTER,
      zoom: UZBEKISTAN_DEFAULT_ZOOM,
      minZoom: 5,
      maxZoom: 21,
      zoomControl: false,
      preferCanvas: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 1. Detailed OpenStreetMap layer showing every building footprint & street in Uzbekistan
    // maxNativeZoom: 19 + maxZoom: 21 ensures smooth scaling up to rooftop zoom 21 without grey/missing tiles!
    const osmStreetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxNativeZoom: 19,
      maxZoom: 21,
      keepBuffer: 4,
    });

    // 2. Clean Carto Voyager schematic layer
    const cleanStreetLayer = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxNativeZoom: 19,
        maxZoom: 21,
        keepBuffer: 4,
      }
    );

    // 3. Esri Satellite World Imagery: native tiles across Uzbekistan districts go up to z17;
    // setting maxNativeZoom: 17 prevents Esri's grey "Map data not yet available" screen at z18-z21!
    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; Esri',
        maxNativeZoom: 17,
        maxZoom: 21,
        keepBuffer: 4,
      }
    );

    // Hybrid transparent street/place labels on top of satellite imagery
    const hybridLabelsLayer = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; CARTO',
        maxNativeZoom: 19,
        maxZoom: 21,
        pane: 'overlayPane',
      }
    );

    osmStreetLayer.addTo(map);
    osmStreetTileRef.current = osmStreetLayer;
    cleanStreetTileRef.current = cleanStreetLayer;
    satelliteTileRef.current = satelliteLayer;
    hybridLabelsTileRef.current = hybridLabelsLayer;

    canvasRendererRef.current = L.canvas({ padding: 0.5 });
    buildingsLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    userLocationLayerRef.current = L.layerGroup().addTo(map);
    searchedPinLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      if (abortRef.current) abortRef.current.abort();
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch map tile styles cleanly
  useEffect(() => {
    const map = mapRef.current;
    const osm = osmStreetTileRef.current;
    const clean = cleanStreetTileRef.current;
    const sat = satelliteTileRef.current;
    const labels = hybridLabelsTileRef.current;
    if (!map || !osm || !clean || !sat || !labels) return;

    [osm, clean, sat, labels].forEach((layer) => {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    });

    if (mapStyle === 'street') {
      osm.addTo(map);
    } else if (mapStyle === 'hybrid') {
      sat.addTo(map);
      labels.addTo(map);
    } else {
      clean.addTo(map);
    }
  }, [mapStyle]);

  // Ensure Leaflet recalculates container width when detail drawer opens or closes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const timer = window.setTimeout(() => {
      map.invalidateSize({ pan: false });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [selectedHouseId]);

  // Sync map layers on pan/zoom and filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const refreshLayers = () => {
      const z = map.getZoom();
      if (z < 15) {
        if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
        if (abortRef.current) abortRef.current.abort();
        setLoadingBuildings(false);
        renderOverviewClusters();
      } else {
        if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = window.setTimeout(() => {
          void renderNeighborhoodBuildings();
        }, 200);
      }
    };

    refreshLayers();
    map.on('zoomend', refreshLayers);
    map.on('moveend', refreshLayers);

    return () => {
      map.off('zoomend', refreshLayers);
      map.off('moveend', refreshLayers);
    };
  }, [renderOverviewClusters, renderNeighborhoodBuildings]);

  // Handle coordinate picker click mode OR "Mark new house on map" mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const container = map.getContainer();
    if (pickingCoordinates || markingHouseMode) {
      container.style.cursor = 'crosshair';
    } else {
      container.style.cursor = '';
    }

    const handleClick = async (e: L.LeafletMouseEvent) => {
      const roundedLat = Number(e.latlng.lat.toFixed(6));
      const roundedLng = Number(e.latlng.lng.toFixed(6));

      if (pickingCoordinates && onPickCoordinate) {
        onPickCoordinate(roundedLat, roundedLng);
        return;
      }

      if (markingHouseMode) {
        setMarkingHouseMode(false);
        onClearSearchedLocationPin?.();
        setResolvingClick(true);
        try {
          const area = findNearestAdminArea(roundedLat, roundedLng);
          const rev = await reverseGeocodeUzbekistanPoint(roundedLat, roundedLng);
          const res = await api.resolveBuilding({
            region: area.region,
            district: area.district,
            mahalla: rev?.mahalla || undefined,
            streetAddress:
              rev?.streetAddress ||
              `${area.district}, turar joy (raqam kiritilmagan)`,
            lat: roundedLat,
            lng: roundedLng,
            cadastralStatus: 'unknown',
          });
          if (res.created) {
            onHouseCreatedOnMap(res.house);
          }
          onSelectHouse(res.house);
        } catch (err) {
          setGeoNotice(
            err instanceof Error ? err.message : 'Uyni ro‘yxatga olishda xatolik yuz berdi.'
          );
        } finally {
          setResolvingClick(false);
        }
      }
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [
    pickingCoordinates,
    markingHouseMode,
    onPickCoordinate,
    onHouseCreatedOnMap,
    onSelectHouse,
    onClearSearchedLocationPin,
  ]);

  // Render searched street/village indicator pin when address search lands on a street
  useEffect(() => {
    const pinLayer = searchedPinLayerRef.current;
    if (!pinLayer) return;
    pinLayer.clearLayers();
    if (!searchedLocationPin) return;

    L.circle([searchedLocationPin.lat, searchedLocationPin.lng], {
      radius: 42,
      color: '#0F172A',
      weight: 1.8,
      dashArray: '4 4',
      fillColor: '#0F172A',
      fillOpacity: 0.08,
    }).addTo(pinLayer);

    const targetIcon = L.divIcon({
      className: 'searched-street-pin',
      html: `<div style="width:32px;height:32px;border-radius:9999px;background:#0F172A;border:2.5px solid #ffffff;color:#ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(15,23,42,0.4);"><div style="width:8px;height:8px;border-radius:9999px;background:#FBBF24;"></div></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    L.marker([searchedLocationPin.lat, searchedLocationPin.lng], {
      icon: targetIcon,
      zIndexOffset: 980,
    })
      .bindTooltip(`<strong>${searchedLocationPin.title}</strong>`, {
        direction: 'top',
        offset: [0, -14],
      })
      .addTo(pinLayer);
  }, [searchedLocationPin]);

  // Fly to target region, district, or searched house
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !viewportTarget) return;
    map.flyTo([viewportTarget.lat, viewportTarget.lng], viewportTarget.zoom, {
      duration: 0.6,
    });
  }, [viewportTarget]);

  const handleResetUzbekistan = () => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo(UZBEKISTAN_CENTER, UZBEKISTAN_DEFAULT_ZOOM, { duration: 0.6 });
  };

  const handleLocateMe = () => {
    setGeoNotice(null);
    if (!navigator.geolocation) {
      setGeoNotice('Qurilmangizda GPS joylashuvni aniqlash imkoniyati mavjud emas.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude, accuracy } = pos.coords;
        const map = mapRef.current;
        const locLayer = userLocationLayerRef.current;
        if (!map || !locLayer) return;

        locLayer.clearLayers();
        L.circle([latitude, longitude], {
          radius: Math.min(accuracy, 400),
          color: '#2563EB',
          fillColor: '#3B82F6',
          fillOpacity: 0.14,
          weight: 1.5,
        }).addTo(locLayer);

        L.circleMarker([latitude, longitude], {
          radius: 7,
          color: '#ffffff',
          weight: 2.5,
          fillColor: '#2563EB',
          fillOpacity: 1,
        })
          .bindTooltip('Joriy joylashuvingiz')
          .addTo(locLayer);

        map.flyTo([latitude, longitude], 17, { duration: 0.7 });
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoNotice('GPS joylashuvga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering.');
        } else {
          setGeoNotice('Joriy joylashuvni aniqlab bo‘lmadi.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="relative h-full w-full min-h-[420px] select-none">
      <div ref={containerRef} className="h-full w-full z-0" />

      {/* Coordinate picker or Mark House banner */}
      {(pickingCoordinates || markingHouseMode) && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 rounded-lg bg-slate-900 text-white px-4 py-2.5 text-xs sm:text-sm shadow-md">
          <Crosshair className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            {pickingCoordinates
              ? 'Uy koordinatasini olish uchun xaritadagi kerakli nuqtani bosing'
              : 'Kadastr holatini belgilash uchun xaritadagi uyni bosing'}
          </span>
          <button
            type="button"
            onClick={() => {
              if (pickingCoordinates && onCancelPickCoordinate) {
                onCancelPickCoordinate();
              }
              setMarkingHouseMode(false);
            }}
            className="ml-1 rounded p-1 hover:bg-slate-800 transition-colors"
            aria-label="Bekor qilish"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Searched Street / Village Target Banner */}
      {searchedLocationPin && !pickingCoordinates && !markingHouseMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[490] flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/95 text-white px-4 py-2 text-xs sm:text-sm shadow-md max-w-[92vw] sm:max-w-lg">
          <Navigation className="h-4 w-4 shrink-0 text-amber-400" />
          <span className="leading-snug">{searchedLocationPin.message}</span>
          {onClearSearchedLocationPin && (
            <button
              type="button"
              onClick={onClearSearchedLocationPin}
              className="ml-1 rounded p-1 hover:bg-slate-800 transition-colors shrink-0"
              aria-label="Yopish"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Subtle loading indicator while fetching live building polygons */}
      {(loadingBuildings || resolvingClick) && !pickingCoordinates && !markingHouseMode && (
        <div className="absolute top-3 right-3 z-[450] rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs">
          {resolvingClick
            ? 'Uy ma’lumoti ochilmoqda...'
            : 'Hududdagi barcha uylar kadastr qatlami yuklanmoqda...'}
        </div>
      )}

      {/* GPS / Action Notice Toast */}
      {geoNotice && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3.5 py-2 text-xs shadow-sm max-w-sm">
          <span>{geoNotice}</span>
          <button
            type="button"
            onClick={() => setGeoNotice(null)}
            className="p-0.5 text-amber-700 hover:text-amber-950"
            aria-label="Yopish"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Top-Left Layer Switcher */}
      <div className="absolute top-3 left-3 sm:left-4 z-[400] flex items-center gap-1 p-1 rounded-lg border border-slate-200 bg-white/95 backdrop-blur-xs shadow-xs">
        <button
          type="button"
          onClick={() => setMapStyle('street')}
          className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
            mapStyle === 'street'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          Aniq xarita
        </button>
        <button
          type="button"
          onClick={() => setMapStyle('hybrid')}
          className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
            mapStyle === 'hybrid'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          Sun’iy yo‘ldosh
        </button>
        <button
          type="button"
          onClick={() => setMapStyle('clean')}
          className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
            mapStyle === 'clean'
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          Sxema
        </button>
      </div>

      {/* Bottom-Left Map Action Controls & Live Legend */}
      <div className="absolute bottom-4 left-3 sm:left-4 z-[400] flex flex-col gap-2 max-w-[calc(100vw-72px)]">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleLocateMe}
            disabled={locating}
            title="GPS orqali joriy joylashuvni ko‘rish"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-xs hover:bg-slate-50 transition-colors min-h-[38px] whitespace-nowrap"
          >
            <LocateFixed className="h-4 w-4 text-slate-700" />
            <span className="hidden sm:inline">
              {locating ? 'Aniqlanmoqda...' : 'Joylashuvim'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleResetUzbekistan}
            title="Butun O‘zbekiston xaritasini ko‘rish"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-xs hover:bg-slate-50 transition-colors min-h-[38px] whitespace-nowrap"
          >
            <Maximize2 className="h-4 w-4 text-slate-700" />
            <span className="hidden sm:inline">O‘zbekiston</span>
          </button>

          {canMarkHouses && !pickingCoordinates && (
            <button
              type="button"
              onClick={() => setMarkingHouseMode((prev) => !prev)}
              title="Xaritadan istalgan uyni bosib kadastr holatini belgilash"
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold shadow-xs transition-colors min-h-[38px] whitespace-nowrap ${
                markingHouseMode
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              <PlusCircle className="h-4 w-4" />
              <span>Uyni belgilash</span>
            </button>
          )}
        </div>

        {/* Clean Semantic Legend + Live Viewport Summary */}
        <div className="rounded-lg border border-slate-200 bg-white/95 backdrop-blur-xs px-3 py-2 shadow-xs space-y-1 text-xs text-slate-700">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2.5 w-2.5 rounded-xs bg-green-600 shrink-0" aria-hidden="true" />
              <span>Kadastr mavjud ({viewportCounts.green})</span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2.5 w-2.5 rounded-xs bg-red-600 shrink-0" aria-hidden="true" />
              <span>Kadastr mavjud emas ({viewportCounts.red})</span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2.5 w-2.5 rounded-xs bg-amber-600 shrink-0" aria-hidden="true" />
              <span>Holati noma’lum ({viewportCounts.amber})</span>
            </span>
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums">
            {viewportCounts.zoom >= 15
              ? `Ko‘rinayotgan barcha binolar belgilangan: ${viewportCounts.total} ta uy (tahrirlash uchun uyni bosing)`
              : `Xarita ko‘rinishida: ${viewportCounts.total} ta uy · Ko‘cha va tomlarni ko‘rish uchun yaqinlashtiring`}
          </div>
        </div>
      </div>
    </div>
  );
}
