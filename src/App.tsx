import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, ShieldAlert, UserCheck } from 'lucide-react';
import { api, getAuthToken, setAuthToken } from './lib/api.ts';
import type { GeocodedPlace } from './lib/geocoding.ts';
import type { CadastralStatus, HouseRecord, UserProfile } from './shared/types.ts';
import { UZBEKISTAN_REGIONS } from './shared/uzbekistanRegions.ts';
import { LoginView } from './components/LoginView.tsx';
import { UzbekistanMap } from './components/UzbekistanMap.tsx';
import type { MapViewportTarget, SearchedLocationPin } from './components/UzbekistanMap.tsx';
import { AddressSearchBar } from './components/AddressSearchBar.tsx';
import { HouseDetailDrawer } from './components/HouseDetailDrawer.tsx';
import { AdminPanel, createEmptyHouseDraft } from './components/AdminPanel.tsx';
import type { AdminTabKey, HouseFormDraft } from './components/AdminPanel.tsx';

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginInitialMode, setLoginInitialMode] = useState<'login' | 'admin_login' | 'activate'>(
    'login'
  );

  const [activeView, setActiveView] = useState<'map' | 'admin'>('map');
  const [requestedAdminTab, setRequestedAdminTab] = useState<AdminTabKey>('houses');
  const [requestedAdminTabNonce, setRequestedAdminTabNonce] = useState(0);

  const [houses, setHouses] = useState<HouseRecord[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<HouseRecord | null>(null);

  const [selectedRegion, setSelectedRegion] = useState<string>('ALL');
  const [selectedDistrict, setSelectedDistrict] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CadastralStatus>('ALL');
  const [viewportTarget, setViewportTarget] = useState<MapViewportTarget | null>(null);
  const [searchedLocationPin, setSearchedLocationPin] = useState<SearchedLocationPin | null>(null);

  // Shared draft state so Admin can pick coordinates directly on the map or inside AdminPanel
  const [adminHouseDraft, setAdminHouseDraft] = useState<HouseFormDraft | null>(() =>
    createEmptyHouseDraft()
  );
  const [pickingCoordinates, setPickingCoordinates] = useState(false);

  const fetchHouses = useCallback(async () => {
    try {
      const res = await api.getHouses();
      setHouses(res.houses);
    } catch (err) {
      console.error('Failed to load houses:', err);
    }
  }, []);

  // Verify existing session token on mount
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }

    api
      .getMe()
      .then((res) => {
        setCurrentUser(res.user);
        if (res.user.permissions.assignedRegion !== 'ALL') {
          setSelectedRegion(res.user.permissions.assignedRegion);
          const reg = UZBEKISTAN_REGIONS.find(
            (r) => r.name === res.user.permissions.assignedRegion
          );
          if (reg) {
            setViewportTarget({
              lat: reg.lat,
              lng: reg.lng,
              zoom: reg.zoom,
              nonce: Date.now(),
            });
          }
        }
      })
      .catch(() => {
        setAuthToken(null);
        setCurrentUser(null);
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchHouses();
    }
  }, [currentUser, fetchHouses]);

  const handleAuthenticated = (user: UserProfile, initialTarget: 'map' | 'admin' = 'map') => {
    setCurrentUser(user);
    if (initialTarget === 'admin' && user.role === 'admin') {
      setActiveView('admin');
      setRequestedAdminTab('houses');
      setRequestedAdminTabNonce((n) => n + 1);
    } else {
      setActiveView('map');
    }

    if (user.permissions.assignedRegion !== 'ALL') {
      setSelectedRegion(user.permissions.assignedRegion);
      const reg = UZBEKISTAN_REGIONS.find((r) => r.name === user.permissions.assignedRegion);
      if (reg) {
        setViewportTarget({
          lat: reg.lat,
          lng: reg.lng,
          zoom: reg.zoom,
          nonce: Date.now(),
        });
      }
    } else {
      setSelectedRegion('ALL');
    }
    setSelectedDistrict('ALL');
    setStatusFilter('ALL');
  };

  const handleLogout = (nextLoginMode: 'login' | 'admin_login' | 'activate' = 'login') => {
    setAuthToken(null);
    setCurrentUser(null);
    setSelectedHouse(null);
    setHouses([]);
    setActiveView('map');
    setPickingCoordinates(false);
    setLoginInitialMode(nextLoginMode);
  };

  // Filtered houses shown on map
  const visibleMapHouses = useMemo(() => {
    return houses.filter((h) => {
      if (selectedRegion !== 'ALL' && h.region !== selectedRegion) return false;
      if (selectedDistrict !== 'ALL' && h.district !== selectedDistrict) return false;
      if (statusFilter !== 'ALL' && h.cadastralStatus !== statusFilter) return false;
      return true;
    });
  }, [houses, selectedRegion, selectedDistrict, statusFilter]);

  const handleSelectHouseFromSearch = (house: HouseRecord) => {
    if (selectedRegion !== 'ALL' && selectedRegion !== house.region) {
      setSelectedRegion('ALL');
    }
    if (selectedDistrict !== 'ALL' && selectedDistrict !== house.district) {
      setSelectedDistrict('ALL');
    }
    if (statusFilter !== 'ALL' && statusFilter !== house.cadastralStatus) {
      setStatusFilter('ALL');
    }
    setSearchedLocationPin(null);
    setSelectedHouse(house);
    setViewportTarget({
      lat: house.lat,
      lng: house.lng,
      zoom: 19,
      nonce: Date.now(),
    });
  };

  // Resolve a live geocoded address from map search (Enter key / click)
  const handleSelectGeocodedPlace = async (place: GeocodedPlace) => {
    if (selectedRegion !== 'ALL' && selectedRegion !== place.region) {
      setSelectedRegion(
        currentUser?.permissions.assignedRegion && currentUser.permissions.assignedRegion !== 'ALL'
          ? currentUser.permissions.assignedRegion
          : 'ALL'
      );
    }
    if (selectedDistrict !== 'ALL' && selectedDistrict !== place.district) {
      setSelectedDistrict('ALL');
    }

    // Only resolve/open a specific house record if OSM matched the EXACT house number rooftop!
    // Otherwise (street or village match), zoom directly onto the street and let user click the exact house.
    if (place.exactHouseMatch) {
      setSearchedLocationPin(null);
      setViewportTarget({
        lat: place.lat,
        lng: place.lng,
        zoom: 19,
        nonce: Date.now(),
      });

      try {
        if (statusFilter !== 'ALL') {
          setStatusFilter('ALL');
        }
        const res = await api.resolveBuilding({
          lat: place.lat,
          lng: place.lng,
          region: place.region,
          district: place.district,
          mahalla: place.mahalla || undefined,
          streetAddress: place.streetAddress,
          cadastralStatus: 'unknown',
        });
        setHouses((prev) =>
          prev.some((h) => h.id === res.house.id) ? prev : [res.house, ...prev]
        );
        setSelectedHouse(res.house);
      } catch (err) {
        console.error('Could not resolve searched address:', err);
      }
      return;
    }

    // Street / mahalla / village match: zoom close so rooftops are visible without opening a wrong house!
    setSelectedHouse(null);
    setViewportTarget({
      lat: place.lat,
      lng: place.lng,
      zoom: Math.max(place.zoom, 18),
      nonce: Date.now(),
    });
    setSearchedLocationPin({
      lat: place.lat,
      lng: place.lng,
      title: place.title,
      message: `«${place.title}» (${place.district}) topildi — shu ko‘chadagi kerakli uyni xaritadan bosing`,
    });
  };

  const handleHouseUpdated = (updated: HouseRecord) => {
    setHouses((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
    setSelectedHouse(updated);
  };

  const openAdminTab = (tab: AdminTabKey) => {
    setPickingCoordinates(false);
    setRequestedAdminTab(tab);
    setRequestedAdminTabNonce((n) => n + 1);
    setActiveView('admin');
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Xavfsiz sessiya tekshirilmoqda...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginView onAuthenticated={handleAuthenticated} initialMode={loginInitialMode} />
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 overflow-hidden">
      {/* Strict 3-Zone Top Navigation Bar with Admin Panel prominently at the start */}
      <header className="flex items-center justify-between gap-6 px-4 sm:px-6 h-14 border-b border-slate-200 bg-white shrink-0">
        {/* Zone 1: Single wordmark */}
        <button
          type="button"
          onClick={() => setActiveView('map')}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Kadastrli uy
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm font-medium text-slate-600 overflow-x-auto">
          <button
            type="button"
            onClick={() => openAdminTab('houses')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'admin' && !pickingCoordinates
                ? 'text-slate-900 font-semibold underline underline-offset-8 decoration-2 decoration-slate-900'
                : 'hover:text-slate-900'
            }`}
          >
            Admin panel
          </button>

          <button
            type="button"
            onClick={() => {
              setPickingCoordinates(false);
              setActiveView('map');
            }}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'map' || pickingCoordinates
                ? 'text-slate-900 font-semibold underline underline-offset-8 decoration-2 decoration-slate-900'
                : 'hover:text-slate-900'
            }`}
          >
            Asosiy xarita
          </button>

          <button
            type="button"
            onClick={() => openAdminTab('houses')}
            className="hidden md:inline-block py-1 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            Qishloq uylarini kiritish
          </button>

          {currentUser.role === 'admin' && (
            <button
              type="button"
              onClick={() => openAdminTab('import')}
              className="hidden lg:inline-block py-1 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Excel yuklash
            </button>
          )}
        </nav>

        {/* Zone 3: User account & Sign out */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-600">
            <UserCheck className="h-3.5 w-3.5 text-slate-500" />
            <span className="font-medium text-slate-900 max-w-[150px] truncate">
              {currentUser.fullName}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-500">{currentUser.serviceId}</span>
          </div>

          <button
            type="button"
            onClick={() => handleLogout('login')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 min-h-[36px]"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Chiqish</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      {activeView === 'map' || pickingCoordinates ? (
        <div className="flex-1 flex flex-col min-h-0">
          <AddressSearchBar
            allHouses={houses}
            selectedRegion={selectedRegion}
            selectedDistrict={selectedDistrict}
            statusFilter={statusFilter}
            assignedRegion={currentUser.permissions.assignedRegion}
            onRegionChange={(region, target) => {
              setSelectedRegion(region);
              setSelectedDistrict('ALL');
              if (target) {
                setViewportTarget({ ...target, nonce: Date.now() });
              }
            }}
            onDistrictChange={(district, target, autoRegion) => {
              if (autoRegion && autoRegion !== selectedRegion) {
                setSelectedRegion(autoRegion);
              }
              setSelectedDistrict(district);
              if (target) {
                setViewportTarget({ ...target, nonce: Date.now() });
              }
            }}
            onStatusFilterChange={(st) => setStatusFilter(st)}
            onSelectSearchResult={handleSelectHouseFromSearch}
            onSelectGeocodedPlace={handleSelectGeocodedPlace}
          />

          <div className="flex-1 flex min-h-0 relative">
            <div className="flex-1 min-w-0 h-full">
              <UzbekistanMap
                houses={visibleMapHouses}
                allHouses={houses}
                assignedRegion={currentUser.permissions.assignedRegion}
                selectedRegion={selectedRegion}
                selectedDistrict={selectedDistrict}
                statusFilter={statusFilter}
                canMarkHouses={
                  currentUser.role === 'admin' || currentUser.permissions.canInspect
                }
                selectedHouseId={selectedHouse?.id ?? null}
                onSelectHouse={(house) => {
                  if (!pickingCoordinates) {
                    setSearchedLocationPin(null);
                    setSelectedHouse(house);
                  }
                }}
                onHouseCreatedOnMap={(newHouse) => {
                  setHouses((prev) =>
                    prev.some((h) => h.id === newHouse.id) ? prev : [newHouse, ...prev]
                  );
                }}
                viewportTarget={viewportTarget}
                searchedLocationPin={searchedLocationPin}
                onClearSearchedLocationPin={() => setSearchedLocationPin(null)}
                pickingCoordinates={pickingCoordinates}
                onPickCoordinate={(lat, lng) => {
                  setAdminHouseDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          lat: lat.toFixed(6),
                          lng: lng.toFixed(6),
                        }
                      : createEmptyHouseDraft({
                          lat: lat.toFixed(6),
                          lng: lng.toFixed(6),
                        })
                  );
                  setPickingCoordinates(false);
                  setActiveView('admin');
                }}
                onCancelPickCoordinate={() => {
                  setPickingCoordinates(false);
                  setActiveView('admin');
                }}
              />
            </div>

            {!pickingCoordinates && selectedHouse && (
              <HouseDetailDrawer
                house={selectedHouse}
                currentUser={currentUser}
                onClose={() => setSelectedHouse(null)}
                onHouseUpdated={handleHouseUpdated}
              />
            )}
          </div>
        </div>
      ) : currentUser.role === 'admin' ? (
        <AdminPanel
          currentUser={currentUser}
          houses={houses}
          onHousesChanged={fetchHouses}
          onViewHouseOnMap={(house) => {
            setSelectedRegion('ALL');
            setSelectedDistrict('ALL');
            setStatusFilter('ALL');
            setActiveView('map');
            setSelectedHouse(house);
            setViewportTarget({
              lat: house.lat,
              lng: house.lng,
              zoom: 18,
              nonce: Date.now(),
            });
          }}
          houseDraft={adminHouseDraft}
          setHouseDraft={setAdminHouseDraft}
          onStartPickCoordinatesOnMap={() => {
            setPickingCoordinates(true);
            setActiveView('map');
          }}
          requestedTab={requestedAdminTab}
          requestedTabNonce={requestedAdminTabNonce}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-6 bg-slate-50">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center space-y-4">
            <div className="mx-auto h-11 w-11 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">
              Admin panel faqat administratorlar uchun ochiq
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Siz hozir oddiy xodim (<span className="font-mono">{currentUser.serviceId}</span>)
              sifatida tizimdasiz. Qishloq va mahalla uylarini Admin panel orqali kiritish uchun
              administrator hisobiga o‘ting.
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveView('map')}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
              >
                Xaritaga qaytish
              </button>
              <button
                type="button"
                onClick={() => handleLogout('admin_login')}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
              >
                Administrator hisobiga o‘tish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
