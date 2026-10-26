import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users,
  Home,
  Upload,
  History,
  Plus,
  Copy,
  Check,
  MapPin,
  Download,
  Database,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ChevronUp,
  ChevronDown,
  ArrowRight,
} from 'lucide-react';
import { api, downloadSampleImportTemplate } from '../lib/api.ts';
import { extractHouseNumberFromText } from '../lib/geocoding.ts';
import type {
  AuditLogEntry,
  BackupFileInfo,
  CadastralStatus,
  HouseRecord,
  ImportValidationResponse,
  UserProfile,
  UserRole,
} from '../shared/types.ts';
import {
  UZBEKISTAN_REGIONS,
  getStatusLabel,
  normalizeUzbekSearch,
} from '../shared/uzbekistanRegions.ts';
import { SearchableGeoSelect } from './SearchableGeoSelect.tsx';
import type { GeoOption } from './SearchableGeoSelect.tsx';
import { VillageMapPicker } from './VillageMapPicker.tsx';

export type AdminTabKey = 'houses' | 'import' | 'employees' | 'audit';

export interface HouseFormDraft {
  editingId: number | null;
  region: string;
  district: string;
  mahalla: string;
  streetAddress: string;
  lat: string;
  lng: string;
  cadastralStatus: CadastralStatus;
  cadastreNumber: string;
  verificationBasis: string;
  residentsCount: string;
  contactInfo: string;
  inspectionNote: string;
  lastInspectionDate: string;
}

export function createEmptyHouseDraft(
  overrides?: Partial<HouseFormDraft>
): HouseFormDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    editingId: null,
    region: 'Toshkent viloyati',
    district: 'Qibray tumani',
    mahalla: '',
    streetAddress: '',
    lat: '41.389000',
    lng: '69.465000',
    cadastralStatus: 'has_cadastre',
    cadastreNumber: '',
    verificationBasis: 'Qishloq uyma-uy xatlov va kadastr reestri tekshiruvi',
    residentsCount: '',
    contactInfo: '',
    inspectionNote: '',
    lastInspectionDate: today,
    ...overrides,
  };
}

function incrementStreetHouseNumber(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return '';
  // Match "... 12-uy" or "... 12"
  const uyMatch = trimmed.match(/^(.*?)(\d+)(\s*-\s*uy|\s+uy)$/i);
  if (uyMatch) {
    const nextNum = Number(uyMatch[2]) + 1;
    return `${uyMatch[1]}${nextNum}-uy`;
  }
  const trailingNum = trimmed.match(/^(.*?\D)(\d+)$/);
  if (trailingNum) {
    const nextNum = Number(trailingNum[2]) + 1;
    return `${trailingNum[1]}${nextNum}`;
  }
  if (/^\d+$/.test(trimmed)) {
    return `${Number(trimmed) + 1}-uy`;
  }
  return trimmed;
}

interface AdminPanelProps {
  currentUser: UserProfile;
  houses: HouseRecord[];
  onHousesChanged: () => Promise<void>;
  onViewHouseOnMap: (house: HouseRecord) => void;
  houseDraft: HouseFormDraft | null;
  setHouseDraft: React.Dispatch<React.SetStateAction<HouseFormDraft | null>>;
  onStartPickCoordinatesOnMap: () => void;
  requestedTab?: AdminTabKey;
  requestedTabNonce?: number;
}

export function AdminPanel({
  currentUser,
  houses,
  onHousesChanged,
  onViewHouseOnMap,
  houseDraft,
  setHouseDraft,
  onStartPickCoordinatesOnMap,
  requestedTab,
  requestedTabNonce,
}: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<AdminTabKey>(requestedTab || 'houses');
  const [workspaceExpanded, setWorkspaceExpanded] = useState(true);
  const [mapFocusNonce, setMapFocusNonce] = useState(1);

  // Ensure houseDraft is initialized so the Village House Entry Workspace is ready immediately
  useEffect(() => {
    if (!houseDraft) {
      setHouseDraft(createEmptyHouseDraft());
    }
  }, [houseDraft, setHouseDraft]);

  useEffect(() => {
    if (requestedTab) {
      setActiveTab(requestedTab);
      if (requestedTab === 'houses') {
        setWorkspaceExpanded(true);
      }
    }
  }, [requestedTab, requestedTabNonce]);

  // ==========================
  // 1. EMPLOYEES STATE
  // ==========================
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserServiceId, setNewUserServiceId] = useState('');
  const [newUserFullName, setNewUserFullName] = useState('');
  const [newUserDept, setNewUserDept] = useState('');
  const [newUserBadge, setNewUserBadge] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('officer');
  const [newUserRegion, setNewUserRegion] = useState('ALL');
  const [newPermResidents, setNewPermResidents] = useState(true);
  const [newPermContact, setNewPermContact] = useState(false);
  const [newPermInspect, setNewPermInspect] = useState(true);
  const [userActionError, setUserActionError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [issuedActivationInfo, setIssuedActivationInfo] = useState<{
    serviceId: string;
    fullName: string;
    code: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await api.getUsers();
      setUsers(res.users);
    } catch (err) {
      setUserActionError(
        err instanceof Error ? err.message : 'Xodimlar ro‘yxatini yuklab bo‘lmadi.'
      );
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'employees') {
      loadUsers();
    }
  }, [activeTab, loadUsers]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserActionError(null);
    setSavingUser(true);
    try {
      const res = await api.createUser({
        serviceId: newUserServiceId.trim().toUpperCase(),
        fullName: newUserFullName.trim(),
        department: newUserDept.trim(),
        badgeDoc: newUserBadge.trim(),
        role: newUserRole,
        permissions: {
          canViewResidents: newUserRole === 'admin' ? true : newPermResidents,
          canViewContact: newUserRole === 'admin' ? true : newPermContact,
          canInspect: newUserRole === 'admin' ? true : newPermInspect,
          assignedRegion: newUserRole === 'admin' ? 'ALL' : newUserRegion,
        },
      });
      setIssuedActivationInfo({
        serviceId: res.user.serviceId,
        fullName: res.user.fullName,
        code: res.activationCode,
      });
      setShowAddUser(false);
      setNewUserServiceId('');
      setNewUserFullName('');
      setNewUserDept('');
      setNewUserBadge('');
      await loadUsers();
    } catch (err) {
      setUserActionError(err instanceof Error ? err.message : 'Xodimni qo‘shishda xatolik.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleToggleUserBlock = async (u: UserProfile) => {
    setUserActionError(null);
    try {
      const targetStatus = u.status === 'blocked' ? 'active' : 'blocked';
      await api.updateUser(u.id, { status: targetStatus });
      await loadUsers();
    } catch (err) {
      setUserActionError(err instanceof Error ? err.message : 'Holatni o‘zgartirib bo‘lmadi.');
    }
  };

  const handleRegenerateCode = async (u: UserProfile) => {
    setUserActionError(null);
    try {
      const res = await api.updateUser(u.id, { regenerateActivation: true });
      if (res.activationCode) {
        setIssuedActivationInfo({
          serviceId: res.user.serviceId,
          fullName: res.user.fullName,
          code: res.activationCode,
        });
      }
      await loadUsers();
    } catch (err) {
      setUserActionError(err instanceof Error ? err.message : 'Kodni yangilab bo‘lmadi.');
    }
  };

  const handlePermissionToggle = async (
    u: UserProfile,
    patch: Partial<UserProfile['permissions']>
  ) => {
    setUserActionError(null);
    try {
      await api.updateUser(u.id, {
        permissions: {
          ...u.permissions,
          ...patch,
        },
      });
      await loadUsers();
    } catch (err) {
      setUserActionError(err instanceof Error ? err.message : 'Huquqlarni saqlashda xatolik.');
    }
  };

  // ==========================
  // 2. VILLAGE & HOUSES MANAGEMENT STATE
  // ==========================
  const [houseQuery, setHouseQuery] = useState('');
  const [adminRegionFilter, setAdminRegionFilter] = useState('ALL');
  const [adminDistrictFilter, setAdminDistrictFilter] = useState('ALL');
  const [houseStatusFilter, setHouseStatusFilter] = useState<'ALL' | CadastralStatus>('ALL');
  const [housesPage, setHousesPage] = useState(1);
  const [houseFormError, setHouseFormError] = useState<string | null>(null);
  const [houseFormSuccess, setHouseFormSuccess] = useState<string | null>(null);
  const [savingHouse, setSavingHouse] = useState(false);

  const activeDraft = houseDraft || createEmptyHouseDraft();

  const adminRegionOptions: GeoOption[] = useMemo(
    () =>
      UZBEKISTAN_REGIONS.map((r) => ({
        value: r.name,
        label: r.name,
        subtitle: `${r.districts.length} tuman/sh.`,
      })),
    []
  );

  const adminFilterDistrictOptions: GeoOption[] = useMemo(() => {
    const regObj = UZBEKISTAN_REGIONS.find((r) => r.name === adminRegionFilter);
    if (regObj) {
      return regObj.districts.map((d) => ({ value: d.name, label: d.name, meta: regObj.name }));
    }
    const all: GeoOption[] = [];
    for (const r of UZBEKISTAN_REGIONS) {
      for (const d of r.districts) {
        all.push({
          value: d.name,
          label: d.name,
          subtitle: r.name.replace(/ viloyati| Respublikasi/i, ''),
          meta: r.name,
        });
      }
    }
    return all;
  }, [adminRegionFilter]);

  const draftRegionObj = useMemo(
    () => UZBEKISTAN_REGIONS.find((r) => r.name === activeDraft.region) || null,
    [activeDraft.region]
  );

  const draftDistrictOptions: GeoOption[] = useMemo(
    () =>
      (draftRegionObj?.districts || []).map((d) => ({
        value: d.name,
        label: d.name,
        meta: d,
      })),
    [draftRegionObj]
  );

  // Existing mahallas / villages in the currently selected district for autocomplete
  const existingMahallasInDistrict = useMemo(() => {
    const set = new Set<string>();
    for (const h of houses) {
      if (h.region === activeDraft.region && h.district === activeDraft.district && h.mahalla) {
        set.add(h.mahalla);
      }
    }
    return Array.from(set).sort();
  }, [houses, activeDraft.region, activeDraft.district]);

  // Live statistics for the admin's currently selected village / district
  const activeVillageStats = useMemo(() => {
    const mahallaNorm = normalizeUzbekSearch(activeDraft.mahalla);
    const matching = houses.filter((h) => {
      if (h.region !== activeDraft.region || h.district !== activeDraft.district) return false;
      if (mahallaNorm && !normalizeUzbekSearch(h.mahalla || '').includes(mahallaNorm)) {
        return false;
      }
      return true;
    });
    return {
      total: matching.length,
      has_cadastre: matching.filter((h) => h.cadastralStatus === 'has_cadastre').length,
      no_cadastre: matching.filter((h) => h.cadastralStatus === 'no_cadastre').length,
      unknown: matching.filter((h) => h.cadastralStatus === 'unknown').length,
    };
  }, [houses, activeDraft.region, activeDraft.district, activeDraft.mahalla]);

  const filteredAdminHouses = useMemo(() => {
    const rawTrimmed = houseQuery.trim();
    const q = normalizeUzbekSearch(rawTrimmed);
    const isUidOrCadastre = /^uy-/i.test(rawTrimmed) || /\d{2}:\d{2}/.test(rawTrimmed);
    const queryHouseNum = !isUidOrCadastre ? extractHouseNumberFromText(rawTrimmed) : null;
    const textTokens = q
      .split(' ')
      .filter((tok) => Boolean(tok) && tok !== 'uy' && (!queryHouseNum || tok !== queryHouseNum));

    return houses.filter((h) => {
      if (adminRegionFilter !== 'ALL' && h.region !== adminRegionFilter) return false;
      if (adminDistrictFilter !== 'ALL' && h.district !== adminDistrictFilter) return false;
      if (houseStatusFilter !== 'ALL' && h.cadastralStatus !== houseStatusFilter) return false;
      if (!q) return true;

      if (isUidOrCadastre) {
        const lower = rawTrimmed.toLowerCase();
        return (
          h.houseUid.toLowerCase().includes(lower) ||
          Boolean(h.cadastreNumber && h.cadastreNumber.toLowerCase().includes(lower))
        );
      }

      if (queryHouseNum) {
        const recHouseNum = extractHouseNumberFromText(h.streetAddress);
        if (!recHouseNum || recHouseNum !== queryHouseNum) return false;
      }

      const haystackWords = normalizeUzbekSearch(
        `${h.houseUid} ${h.region} ${h.district} ${h.mahalla || ''} ${h.streetAddress} ${h.cadastreNumber || ''}`
      )
        .split(' ')
        .filter(Boolean);

      return textTokens.every((tok) =>
        haystackWords.some((w) => w === tok || (tok.length >= 2 && w.startsWith(tok)))
      );
    });
  }, [houses, houseQuery, adminRegionFilter, adminDistrictFilter, houseStatusFilter]);

  useEffect(() => {
    setHousesPage(1);
  }, [houseQuery, adminRegionFilter, adminDistrictFilter, houseStatusFilter]);

  const HOUSES_PER_PAGE = 50;
  const totalHousePages = Math.max(1, Math.ceil(filteredAdminHouses.length / HOUSES_PER_PAGE));
  const paginatedAdminHouses = useMemo(() => {
    const start = (housesPage - 1) * HOUSES_PER_PAGE;
    return filteredAdminHouses.slice(start, start + HOUSES_PER_PAGE);
  }, [filteredAdminHouses, housesPage]);

  const openEditHouse = (h: HouseRecord) => {
    setHouseFormError(null);
    setHouseFormSuccess(null);
    setWorkspaceExpanded(true);
    setHouseDraft({
      editingId: h.id,
      region: h.region,
      district: h.district,
      mahalla: h.mahalla || '',
      streetAddress: h.streetAddress,
      lat: h.lat.toFixed(6),
      lng: h.lng.toFixed(6),
      cadastralStatus: h.cadastralStatus,
      cadastreNumber: h.cadastreNumber || '',
      verificationBasis: h.verificationBasis || '',
      residentsCount: h.residentsCount !== null ? String(h.residentsCount) : '',
      contactInfo: h.contactInfo || '',
      inspectionNote: h.inspectionNote || '',
      lastInspectionDate: h.lastInspectionDate || new Date().toISOString().slice(0, 10),
    });
    setMapFocusNonce((n) => n + 1);
  };

  const submitHouseEntry = async (continueToNextInVillage: boolean) => {
    setHouseFormError(null);
    setHouseFormSuccess(null);

    const lat = Number(activeDraft.lat);
    const lng = Number(activeDraft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setHouseFormError('Koordinatalar son ko‘rinishida kiritilishi kerak.');
      return;
    }

    if (!activeDraft.streetAddress.trim()) {
      setHouseFormError('Ko‘cha va uy raqamini kiriting (masalan: Navbahor ko‘chasi, 12-uy).');
      return;
    }

    if (
      activeDraft.cadastralStatus !== 'unknown' &&
      !activeDraft.verificationBasis.trim()
    ) {
      setHouseFormError(
        'Kadastr holati tasdiqlanganda («Kadastr mavjud» yoki «Kadastr mavjud emas») tasdiqlash asosini ko‘rsating.'
      );
      return;
    }

    setSavingHouse(true);
    try {
      const payload = {
        region: activeDraft.region,
        district: activeDraft.district,
        mahalla: activeDraft.mahalla.trim() || undefined,
        streetAddress: activeDraft.streetAddress.trim(),
        lat,
        lng,
        cadastralStatus: activeDraft.cadastralStatus,
        cadastreNumber:
          activeDraft.cadastralStatus === 'no_cadastre'
            ? undefined
            : activeDraft.cadastreNumber.trim() || undefined,
        verificationBasis: activeDraft.verificationBasis.trim() || undefined,
        residentsCount:
          activeDraft.residentsCount.trim() === '' ? null : Number(activeDraft.residentsCount),
        contactInfo: activeDraft.contactInfo.trim() || undefined,
        inspectionNote: activeDraft.inspectionNote.trim() || undefined,
        lastInspectionDate:
          activeDraft.lastInspectionDate || new Date().toISOString().slice(0, 10),
      };

      let savedHouse: HouseRecord;
      if (activeDraft.editingId) {
        const res = await api.updateHouse(activeDraft.editingId, payload);
        savedHouse = res.house;
        setHouseFormSuccess(
          `${savedHouse.streetAddress} (${savedHouse.houseUid}) ma’lumotlari yangilandi.`
        );
      } else {
        const res = await api.createHouse(payload);
        savedHouse = res.house;
        setHouseFormSuccess(
          `${savedHouse.streetAddress} (${getStatusLabel(savedHouse.cadastralStatus)}) bazaga saqlandi!`
        );
      }

      await onHousesChanged();

      if (continueToNextInVillage) {
        // Keep Viloyat, Tuman, Qishloq/MFY, Status, and VerificationBasis intact and increment house number!
        const nextStreet = incrementStreetHouseNumber(activeDraft.streetAddress);
        const nextLng = Number((lng + 0.00018).toFixed(6));
        setHouseDraft({
          editingId: null,
          region: activeDraft.region,
          district: activeDraft.district,
          mahalla: activeDraft.mahalla,
          streetAddress: nextStreet,
          lat: lat.toFixed(6),
          lng: nextLng.toFixed(6),
          cadastralStatus: activeDraft.cadastralStatus,
          cadastreNumber: '',
          verificationBasis: activeDraft.verificationBasis,
          residentsCount: '',
          contactInfo: '',
          inspectionNote: '',
          lastInspectionDate:
            activeDraft.lastInspectionDate || new Date().toISOString().slice(0, 10),
        });
      } else {
        setWorkspaceExpanded(false);
      }
    } catch (err) {
      setHouseFormError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.');
    } finally {
      setSavingHouse(false);
    }
  };

  const handleSaveHouseForm = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitHouseEntry(true);
  };

  // ==========================
  // 3. EXCEL / CSV IMPORT STATE
  // ==========================
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [validatingFile, setValidatingFile] = useState(false);
  const [committingImport, setCommittingImport] = useState(false);
  const [importValidation, setImportValidation] = useState<ImportValidationResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportSuccess(null);
    setImportValidation(null);
    setSelectedFileName(file.name);
    setValidatingFile(true);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const resultStr = String(reader.result || '');
        const base64 = resultStr.includes(',') ? resultStr.split(',')[1] : resultStr;
        const validation = await api.validateImportFile(file.name, base64);
        setImportValidation(validation);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Faylni tekshirishda xatolik.');
      } finally {
        setValidatingFile(false);
        e.target.value = '';
      }
    };
    reader.onerror = () => {
      setValidatingFile(false);
      setImportError('Faylni brauzerda o‘qib bo‘lmadi.');
    };
    reader.readAsDataURL(file);
  };

  const handleCommitImport = async () => {
    if (!importValidation || !selectedFileName) return;
    const validItems = importValidation.rows
      .filter((r) => r.status === 'valid' && r.normalized)
      .map((r) => r.normalized!);

    if (validItems.length === 0) return;

    setCommittingImport(true);
    setImportError(null);
    try {
      const res = await api.commitImportRows(selectedFileName, validItems);
      setImportSuccess(
        `Tasdiqlangan ${res.insertedCount} ta uy muvaffaqiyatli markaziy bazaga saqlandi.`
      );
      setImportValidation(null);
      await onHousesChanged();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Bazaga saqlashda xatolik.');
    } finally {
      setCommittingImport(false);
    }
  };

  // ==========================
  // 4. AUDIT LOG & BACKUPS STATE
  // ==========================
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [backups, setBackups] = useState<BackupFileInfo[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditNotice, setAuditNotice] = useState<string | null>(null);

  const loadAuditAndBackups = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const [logsRes, backupsRes] = await Promise.all([api.getAuditLogs(), api.getBackups()]);
      setAuditLogs(logsRes.logs);
      setBackups(backupsRes.backups);
    } catch (err) {
      setAuditNotice(
        err instanceof Error ? err.message : 'O‘zgarishlar tarixini yuklashda xatolik.'
      );
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'audit') {
      loadAuditAndBackups();
    }
  }, [activeTab, loadAuditAndBackups]);

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    setAuditNotice(null);
    try {
      const res = await api.createBackup();
      setBackups(res.backups);
      await loadAuditAndBackups();
      setAuditNotice(`Zaxira nusxa yaratildi: ${res.backup.filename}`);
    } catch (err) {
      setAuditNotice(err instanceof Error ? err.message : 'Zaxira nusxa yaratishda xatolik.');
    } finally {
      setCreatingBackup(false);
    }
  };

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter((l) =>
      `${l.actorServiceId} ${l.actorName} ${l.actionType} ${l.targetId} ${l.summary}`
        .toLowerCase()
        .includes(q)
    );
  }, [auditLogs, auditSearch]);

  const draftLatNum = Number(activeDraft.lat);
  const draftLngNum = Number(activeDraft.lng);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Section Header + Clean 4-Tab Bar (Qishloq & Uylar first!) */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Admin panel — Qishloq va uylar kadastri boshqaruvi
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              Qishloq hamda mahalladagi har bir uyni tekshirib kadastr holatini ketma-ket tizimga
              kiritish
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('houses')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                activeTab === 'houses'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Home className="h-4 w-4" />
              <span>Qishloq uylari ({houses.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('import')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'import'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Upload className="h-4 w-4" />
              <span>Excel / CSV yuklash</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('employees')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'employees'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="h-4 w-4" />
              <span>Xodimlar</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'audit'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="h-4 w-4" />
              <span>O‘zgarishlar tarixi</span>
            </button>
          </div>
        </div>

        {/* ======================================================= */}
        {/* TAB 1 (DEFAULT): VILLAGE & HOUSES RAPID ENTRY WORKSPACE */}
        {/* ======================================================= */}
        {activeTab === 'houses' && (
          <div className="space-y-6">
            {houseFormSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex items-center justify-between gap-3">
                <span>{houseFormSuccess}</span>
                <button
                  type="button"
                  onClick={() => setHouseFormSuccess(null)}
                  className="text-xs font-semibold text-green-900 hover:underline shrink-0"
                >
                  Yopish
                </button>
              </div>
            )}

            {/* Village Rapid House Entry Card (Single-elevation container) */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {activeDraft.editingId
                      ? 'Tanlangan uy kadastr ma’lumotlarini tahrirlash'
                      : 'Qishloq / mahalladagi uylarni ketma-ket kiritish oynasi'}
                  </h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600 tabular-nums">
                    <span>
                      Hudud: {activeDraft.district}
                      {activeDraft.mahalla ? ` · ${activeDraft.mahalla}` : ''}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Jami kiritilgan: {activeVillageStats.total}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-green-700 font-medium">
                      Kadastrli: {activeVillageStats.has_cadastre}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-red-700 font-medium">
                      Kadastrsiz: {activeVillageStats.no_cadastre}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-700 font-medium">
                      Noma’lum: {activeVillageStats.unknown}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {activeDraft.editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        setHouseFormError(null);
                        setHouseDraft(
                          createEmptyHouseDraft({
                            region: activeDraft.region,
                            district: activeDraft.district,
                            mahalla: activeDraft.mahalla,
                            lat: activeDraft.lat,
                            lng: activeDraft.lng,
                          })
                        );
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                    >
                      Yangi uy rejimiga qaytish
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onStartPickCoordinatesOnMap}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    <span>Katta xaritadan belgilash</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWorkspaceExpanded((prev) => !prev)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    <span>{workspaceExpanded ? 'Yig‘ish' : 'Kiritish oynasini ochish'}</span>
                    {workspaceExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {workspaceExpanded && (
                <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                  {/* Left Column: Structured Rapid Village Entry Form */}
                  <form
                    onSubmit={handleSaveHouseForm}
                    className="lg:col-span-7 space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-4">
                      {houseFormError && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs sm:text-sm text-red-800">
                          {houseFormError}
                        </div>
                      )}

                      {/* Row 1: Sticky Village Location (Viloyat + Tuman + Qishloq/MFY) */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            1. Viloyat
                          </label>
                          <SearchableGeoSelect
                            ariaLabel="Viloyatni yozish yoki tanlash"
                            value={activeDraft.region}
                            options={adminRegionOptions}
                            placeholder="Viloyatni yozing..."
                            includeAllOption={false}
                            onChange={(val) => {
                              const reg = UZBEKISTAN_REGIONS.find((r) => r.name === val);
                              const firstDist = reg?.districts[0];
                              setHouseDraft((prev) => {
                                const base = prev || createEmptyHouseDraft();
                                return {
                                  ...base,
                                  editingId: null,
                                  region: val,
                                  district: firstDist?.name || '',
                                  lat: firstDist
                                    ? firstDist.lat.toFixed(6)
                                    : reg
                                      ? reg.lat.toFixed(6)
                                      : base.lat,
                                  lng: firstDist
                                    ? firstDist.lng.toFixed(6)
                                    : reg
                                      ? reg.lng.toFixed(6)
                                      : base.lng,
                                };
                              });
                              setMapFocusNonce((n) => n + 1);
                            }}
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            2. Tuman yoki shahar
                          </label>
                          <SearchableGeoSelect
                            ariaLabel="Tumanni yozish yoki tanlash"
                            value={activeDraft.district}
                            options={draftDistrictOptions}
                            placeholder="Tumanni yozing..."
                            includeAllOption={false}
                            allowCustomValue={true}
                            onChange={(val, opt) => {
                              const dist = opt?.meta as { lat: number; lng: number } | undefined;
                              setHouseDraft((prev) => {
                                const base = prev || createEmptyHouseDraft();
                                return {
                                  ...base,
                                  editingId: null,
                                  district: val,
                                  lat: dist ? dist.lat.toFixed(6) : base.lat,
                                  lng: dist ? dist.lng.toFixed(6) : base.lng,
                                };
                              });
                              setMapFocusNonce((n) => n + 1);
                            }}
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            3. Qishloq / Mahalla (MFY)
                          </label>
                          <input
                            type="text"
                            list="district-mahallas-list"
                            placeholder="Masalan: Oqyer qishlog‘i"
                            value={activeDraft.mahalla}
                            onChange={(e) =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, mahalla: e.target.value } : null
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none min-h-[40px]"
                          />
                          <datalist id="district-mahallas-list">
                            {existingMahallasInDistrict.map((m) => (
                              <option key={m} value={m} />
                            ))}
                          </datalist>
                        </div>
                      </div>

                      {/* Row 2: Street & House Number + Inspection Date */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            4. Ko‘cha nomi va uy raqami
                          </label>
                          <input
                            type="text"
                            placeholder="Masalan: Navbahor ko‘chasi, 1-uy"
                            value={activeDraft.streetAddress}
                            onChange={(e) =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, streetAddress: e.target.value } : null
                              )
                            }
                            required
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none min-h-[40px]"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Tekshiruv sanasi
                          </label>
                          <input
                            type="date"
                            value={activeDraft.lastInspectionDate}
                            onChange={(e) =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, lastInspectionDate: e.target.value } : null
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-slate-900 focus:outline-none min-h-[40px] tabular-nums"
                          />
                        </div>
                      </div>

                      {/* Row 3: 1-Click Cadastral Status Selector */}
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          5. Uyning tekshirilgan kadastr holati
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setHouseDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      cadastralStatus: 'has_cadastre',
                                      verificationBasis:
                                        prev.verificationBasis ||
                                        'Davlat kadastrlar palatasi reestri ma’lumoti',
                                    }
                                  : null
                              )
                            }
                            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                              activeDraft.cadastralStatus === 'has_cadastre'
                                ? 'border-green-700 bg-green-50 text-green-900'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                            <span>Kadastr mavjud</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setHouseDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      cadastralStatus: 'no_cadastre',
                                      cadastreNumber: '',
                                      verificationBasis:
                                        prev.verificationBasis ||
                                        'Qishloq uyma-uy xatlov tekshiruvi dalolatnomasi',
                                    }
                                  : null
                              )
                            }
                            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                              activeDraft.cadastralStatus === 'no_cadastre'
                                ? 'border-red-700 bg-red-50 text-red-900'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                            <span>Kadastr mavjud emas</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, cadastralStatus: 'unknown' } : null
                              )
                            }
                            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                              activeDraft.cadastralStatus === 'unknown'
                                ? 'border-amber-600 bg-amber-50 text-amber-900'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <HelpCircle className="h-4 w-4 text-amber-600 shrink-0" />
                            <span>Holati noma’lum</span>
                          </button>
                        </div>
                      </div>

                      {/* Row 4: Cadastre Number + Verification Basis */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Kadastr raqami
                          </label>
                          <input
                            type="text"
                            placeholder="10:05:02:04:01:0014"
                            value={activeDraft.cadastreNumber}
                            disabled={activeDraft.cadastralStatus === 'no_cadastre'}
                            onChange={(e) =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, cadastreNumber: e.target.value } : null
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 disabled:bg-slate-100 tabular-nums"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Tasdiqlash asosi
                          </label>
                          <input
                            type="text"
                            placeholder="Kadastr reestri yoki xatlov dalolatnomasi..."
                            value={activeDraft.verificationBasis}
                            onChange={(e) =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, verificationBasis: e.target.value } : null
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span>Tez tanlash:</span>
                            <button
                              type="button"
                              onClick={() =>
                                setHouseDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        verificationBasis:
                                          'Davlat kadastrlar palatasi reestri ma’lumoti',
                                      }
                                    : null
                                )
                              }
                              className="underline hover:text-slate-900"
                            >
                              Kadastr reestri
                            </button>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() =>
                                setHouseDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        verificationBasis:
                                          'Qishloq uyma-uy xatlov tekshiruvi dalolatnomasi',
                                      }
                                    : null
                                )
                              }
                              className="underline hover:text-slate-900"
                            >
                              Xatlov dalolatnomasi
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Row 5: Residents, Contact, Coordinates */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Yashovchilar soni
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            placeholder="Ixtiyoriy"
                            value={activeDraft.residentsCount}
                            onChange={(e) =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, residentsCount: e.target.value } : null
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 tabular-nums"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Aloqa telefoni
                          </label>
                          <input
                            type="text"
                            placeholder="+998 90 ..."
                            value={activeDraft.contactInfo}
                            onChange={(e) =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, contactInfo: e.target.value } : null
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Kenglik (Lat)
                          </label>
                          <input
                            type="text"
                            value={activeDraft.lat}
                            onChange={(e) =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, lat: e.target.value } : null
                              )
                            }
                            required
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-mono text-slate-900 tabular-nums"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            Uzunlik (Lng)
                          </label>
                          <input
                            type="text"
                            value={activeDraft.lng}
                            onChange={(e) =>
                              setHouseDraft((prev) =>
                                prev ? { ...prev, lng: e.target.value } : null
                              )
                            }
                            required
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-mono text-slate-900 tabular-nums"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => {
                          setAdminRegionFilter(activeDraft.region);
                          setAdminDistrictFilter(activeDraft.district);
                          setHouseQuery(activeDraft.mahalla || '');
                        }}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
                      >
                        Pastdagi jadvalda faqat shu hudud uylarini ko‘rsatish
                      </button>

                      <div className="flex items-center gap-2">
                        {activeDraft.editingId && (
                          <button
                            type="button"
                            disabled={savingHouse}
                            onClick={() => void submitHouseEntry(false)}
                            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
                          >
                            Saqlash va yopish
                          </button>
                        )}

                        <button
                          type="submit"
                          disabled={savingHouse}
                          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap"
                        >
                          <span>
                            {savingHouse
                              ? 'Saqlanmoqda...'
                              : activeDraft.editingId
                                ? 'Yangilash va keyingi uy'
                                : 'Saqlash va keyingi uyga o‘tish'}
                          </span>
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Right Column: Live Interactive Satellite/Street Village Map */}
                  <div className="lg:col-span-5 flex flex-col">
                    <VillageMapPicker
                      houses={houses}
                      region={activeDraft.region}
                      district={activeDraft.district}
                      lat={Number.isFinite(draftLatNum) ? draftLatNum : 41.389}
                      lng={Number.isFinite(draftLngNum) ? draftLngNum : 69.465}
                      editingId={activeDraft.editingId}
                      focusTrigger={mapFocusNonce}
                      onPickLocation={(picked) => {
                        setHouseFormError(null);
                        if (picked.existingHouse) {
                          openEditHouse(picked.existingHouse);
                          return;
                        }
                        setHouseDraft((prev) => {
                          const base = prev || createEmptyHouseDraft();
                          return {
                            ...base,
                            editingId: null,
                            region: picked.region || base.region,
                            district: picked.district || base.district,
                            mahalla: picked.suggestedMahalla || base.mahalla,
                            streetAddress: picked.suggestedStreet || base.streetAddress,
                            lat: picked.lat.toFixed(6),
                            lng: picked.lng.toFixed(6),
                          };
                        });
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Houses Filter & Data Table */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap flex-1 items-center gap-2">
                <div className="relative flex-1 min-w-[210px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Jadvaldan qidirish: qishloq, ko‘cha, uy ID, kadastr..."
                    value={houseQuery}
                    onChange={(e) => setHouseQuery(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none min-h-[40px]"
                  />
                </div>

                <SearchableGeoSelect
                  ariaLabel="Viloyat bo‘yicha filtrlash"
                  value={adminRegionFilter}
                  options={adminRegionOptions}
                  placeholder="Viloyatni yozing..."
                  allOptionLabel="Barcha viloyatlar"
                  onChange={(val) => {
                    setAdminRegionFilter(val);
                    setAdminDistrictFilter('ALL');
                  }}
                  className="w-[195px]"
                />

                <SearchableGeoSelect
                  ariaLabel="Tuman bo‘yicha filtrlash"
                  value={adminDistrictFilter}
                  options={adminFilterDistrictOptions}
                  placeholder="Tumanni yozing..."
                  allOptionLabel="Barcha tumanlar"
                  onChange={(val, opt) => {
                    if (val !== 'ALL' && opt?.meta && typeof opt.meta === 'string') {
                      setAdminRegionFilter(opt.meta);
                    }
                    setAdminDistrictFilter(val);
                  }}
                  className="w-[195px]"
                />

                <select
                  value={houseStatusFilter}
                  onChange={(e) => setHouseStatusFilter(e.target.value as 'ALL' | CadastralStatus)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-800 min-h-[40px]"
                >
                  <option value="ALL">Barcha holatlar</option>
                  <option value="has_cadastre">Kadastr mavjud</option>
                  <option value="no_cadastre">Kadastr mavjud emas</option>
                  <option value="unknown">Holati noma’lum</option>
                </select>
              </div>

              {!workspaceExpanded && (
                <button
                  type="button"
                  onClick={() => {
                    setHouseFormError(null);
                    setHouseFormSuccess(null);
                    setWorkspaceExpanded(true);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap min-h-[40px]"
                >
                  <Plus className="h-4 w-4" />
                  <span>Yangi uy kiritish</span>
                </button>
              )}
            </div>

            {/* Houses Data Grid */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>
                  Topilgan uylar:{' '}
                  <strong className="font-mono text-slate-900 tabular-nums">
                    {filteredAdminHouses.length}
                  </strong>{' '}
                  ta
                </span>
                {totalHousePages > 1 && (
                  <div className="flex items-center gap-2 tabular-nums">
                    <button
                      type="button"
                      disabled={housesPage <= 1}
                      onClick={() => setHousesPage((p) => Math.max(1, p - 1))}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    >
                      Oldingi
                    </button>
                    <span>
                      {housesPage} / {totalHousePages}
                    </span>
                    <button
                      type="button"
                      disabled={housesPage >= totalHousePages}
                      onClick={() => setHousesPage((p) => Math.min(totalHousePages, p + 1))}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    >
                      Keyingi
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Uy ID</th>
                      <th className="py-3 px-4">Qishloq / Manzil</th>
                      <th className="py-3 px-4">Koordinatalar</th>
                      <th className="py-3 px-4">Kadastr holati</th>
                      <th className="py-3 px-4">Oxirgi tekshiruv</th>
                      <th className="py-3 px-4 text-right">Amallar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {paginatedAdminHouses.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          Mos uy yozuvlari topilmadi. Yuqoridagi oynadan yangi uy kiriting.
                        </td>
                      </tr>
                    ) : (
                      paginatedAdminHouses.map((h) => (
                        <tr key={h.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap tabular-nums">
                            {h.houseUid}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{h.streetAddress}</div>
                            <div className="text-xs text-slate-500">
                              {h.region} · {h.district}
                              {h.mahalla ? ` · ${h.mahalla}` : ''}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap tabular-nums">
                            {h.lat.toFixed(5)}, {h.lng.toFixed(5)}
                          </td>
                          <td className="py-3 px-4 text-xs whitespace-nowrap">
                            {h.cadastralStatus === 'has_cadastre' && (
                              <span className="inline-flex items-center gap-1.5 font-semibold text-green-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>{getStatusLabel(h.cadastralStatus)}</span>
                              </span>
                            )}
                            {h.cadastralStatus === 'no_cadastre' && (
                              <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span>{getStatusLabel(h.cadastralStatus)}</span>
                              </span>
                            )}
                            {h.cadastralStatus === 'unknown' && (
                              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
                                <HelpCircle className="h-3.5 w-3.5" />
                                <span>{getStatusLabel(h.cadastralStatus)}</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap tabular-nums">
                            {h.lastInspectionDate || '—'}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onViewHouseOnMap(h)}
                                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                              >
                                Xaritada
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditHouse(h)}
                                className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                              >
                                Tahrirlash
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================= */}
        {/* TAB 2: EXCEL / CSV IMPORT                 */}
        {/* ========================================= */}
        {activeTab === 'import' && (
          <div className="space-y-5">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Qishloq va mahalla uylarini Excel (.xlsx) yoki CSV fayli orqali yuklash
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1">
                    Yuklangan barcha qatorlar bazaga saqlanishidan oldin koordinata to‘g‘riligi,
                    takroriy yozuvlar va kadastr asosi bo‘yicha tekshiriladi. Holati ko‘rsatilmagan
                    uylar avtomatik ravishda «Holati noma’lum» deb olinadi.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => downloadSampleImportTemplate('xlsx')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Namuna Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadSampleImportTemplate('csv')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Namuna CSV</span>
                  </button>
                </div>
              </div>

              {importError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {importError}
                </div>
              )}

              {importSuccess && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                  {importSuccess}
                </div>
              )}

              <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 cursor-pointer hover:border-slate-500 hover:bg-slate-50 transition-colors">
                <Upload className="h-7 w-7 text-slate-500 mb-2" />
                <span className="text-sm font-semibold text-slate-900">
                  {validatingFile
                    ? 'Fayl tahlil qilinmoqda va tekshirilmoqda...'
                    : 'Excel (.xlsx, .xls) yoki .csv faylni tanlash uchun bosing'}
                </span>
                <span className="text-xs text-slate-500 mt-1">
                  Ustunlar: Viloyat, Tuman, Mahalla, Ko‘cha va uy raqami, Kenglik, Uzunlik, Kadastr
                  holati, Tasdiqlash asosi
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  disabled={validatingFile}
                  className="hidden"
                />
              </label>
            </div>

            {importValidation && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      Tekshiruv natijasi: {selectedFileName}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 mt-1 tabular-nums">
                      <span>Jami qatorlar: {importValidation.totalRows}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-green-700">
                        Tasdiqlashga tayyor: {importValidation.validCount}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-amber-700">
                        Takroriy yozuvlar: {importValidation.duplicateCount}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-red-700">
                        Xatoliklar: {importValidation.errorCount}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={importValidation.validCount === 0 || committingImport}
                    onClick={handleCommitImport}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    <span>
                      {committingImport
                        ? 'Saqlanmoqda...'
                        : `Tasdiqlangan ma’lumotlarni saqlash (${importValidation.validCount})`}
                    </span>
                  </button>
                </div>

                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Qator</th>
                        <th className="py-2.5 px-3">Tekshiruv holati</th>
                        <th className="py-2.5 px-3">Manzil</th>
                        <th className="py-2.5 px-3">Koordinatalar</th>
                        <th className="py-2.5 px-3">Kadastr holati / Izoh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {importValidation.rows.map((r) => (
                        <tr key={r.rowNumber}>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                            #{r.rowNumber}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap font-semibold">
                            {r.status === 'valid' && (
                              <span className="text-green-700">Tayyor</span>
                            )}
                            {r.status === 'duplicate_db' && (
                              <span className="text-amber-700">Takroriy (Bazada bor)</span>
                            )}
                            {r.status === 'duplicate_file' && (
                              <span className="text-amber-700">Takroriy (Fayl ichida)</span>
                            )}
                            {r.status === 'error' && <span className="text-red-700">Xato</span>}
                          </td>
                          <td className="py-2.5 px-3 text-slate-800">
                            {r.normalized
                              ? `${r.normalized.region}, ${r.normalized.district}, ${r.normalized.streetAddress}`
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                            {r.normalized
                              ? `${r.normalized.lat.toFixed(5)}, ${r.normalized.lng.toFixed(5)}`
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3">
                            {r.errors.length > 0 ? (
                              <span className="text-red-700">{r.errors.join('; ')}</span>
                            ) : r.normalized ? (
                              <span className="text-slate-700">
                                {getStatusLabel(r.normalized.cadastralStatus)}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================= */}
        {/* TAB 3: EMPLOYEES MANAGEMENT               */}
        {/* ========================================= */}
        {activeTab === 'employees' && (
          <div className="space-y-5">
            {userActionError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {userActionError}
              </div>
            )}

            {issuedActivationInfo && (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-emerald-950">
                    Bir martalik xavfsiz faollashtirish kodi tayyorlandi
                  </div>
                  <p className="text-xs text-emerald-900 mt-1">
                    Xodim ({issuedActivationInfo.fullName} ·{' '}
                    <span className="font-mono font-semibold">{issuedActivationInfo.serviceId}</span>
                    ) tizimga birinchi marta kirishda ushbu maxfiy kodni kiritib o‘z shaxsiy parolini
                    yaratadi. Kod faqat bir marta ko‘rsatiladi:
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <code className="rounded-lg bg-white border border-emerald-300 px-3.5 py-2 text-sm font-mono font-bold text-slate-900 tabular-nums">
                    {issuedActivationInfo.code}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        `Xizmat ID: ${issuedActivationInfo.serviceId} | Faollashtirish kodi: ${issuedActivationInfo.code}`
                      );
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                  >
                    {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span>{copiedCode ? 'Nusxalandi' : 'Nusxalash'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIssuedActivationInfo(null)}
                    className="px-2.5 py-2 text-xs font-medium text-emerald-900 hover:underline"
                  >
                    Yopish
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-600">
                Jami ro‘yxatga olingan xodimlar:{' '}
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {users.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAddUser((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                <span>{showAddUser ? 'Formani yopish' : 'Yangi xodim qo‘shish'}</span>
              </button>
            </div>

            {showAddUser && (
              <form
                onSubmit={handleCreateUser}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <h2 className="text-base font-bold text-slate-900">
                  Yangi xodimni oldindan ro‘yxatga olish
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Xizmat ID raqami
                    </label>
                    <input
                      type="text"
                      placeholder="Masalan: IIV-304"
                      value={newUserServiceId}
                      onChange={(e) => setNewUserServiceId(e.target.value.toUpperCase())}
                      required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      F.I.Sh.
                    </label>
                    <input
                      type="text"
                      placeholder="Familiya Ism Sharif"
                      value={newUserFullName}
                      onChange={(e) => setNewUserFullName(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Bo‘lim va lavozim
                    </label>
                    <input
                      type="text"
                      placeholder="Profilaktika inspektori"
                      value={newUserDept}
                      onChange={(e) => setNewUserDept(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tasdiqlovchi guvohnoma raqami
                    </label>
                    <input
                      type="text"
                      placeholder="Masalan: GUV-045120"
                      value={newUserBadge}
                      onChange={(e) => setNewUserBadge(e.target.value.toUpperCase())}
                      required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Foydalanuvchi roli
                    </label>
                    <select
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      <option value="officer">Oddiy xodim</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Ruxsat etilgan hudud
                    </label>
                    <SearchableGeoSelect
                      ariaLabel="Xodim uchun ruxsat etilgan viloyat"
                      value={newUserRole === 'admin' ? 'ALL' : newUserRegion}
                      options={adminRegionOptions}
                      placeholder="Viloyatni yozing yoki tanlang..."
                      allOptionLabel="Barcha viloyatlar"
                      includeAllOption={true}
                      disabled={newUserRole === 'admin'}
                      onChange={(val) => setNewUserRegion(val)}
                    />
                  </div>

                  {newUserRole === 'officer' && (
                    <div className="flex flex-col justify-center gap-2 pt-1">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={newPermInspect}
                          onChange={(e) => setNewPermInspect(e.target.checked)}
                          className="rounded border-slate-300 text-slate-900"
                        />
                        <span>Tekshiruv natijasini kiritish huquqi</span>
                      </label>
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={newPermResidents}
                          onChange={(e) => setNewPermResidents(e.target.checked)}
                          className="rounded border-slate-300 text-slate-900"
                        />
                        <span>Yashovchilar sonini ko‘rish huquqi</span>
                      </label>
                      <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={newPermContact}
                          onChange={(e) => setNewPermContact(e.target.checked)}
                          className="rounded border-slate-300 text-slate-900"
                        />
                        <span>Aloqa ma’lumotlarini ko‘rish huquqi</span>
                      </label>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddUser(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Bekor qilish
                  </button>
                  <button
                    type="submit"
                    disabled={savingUser}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {savingUser ? 'Saqlanmoqda...' : 'Xodimni qo‘shish va kod olish'}
                  </button>
                </div>
              </form>
            )}

            {/* Users Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Xizmat ID</th>
                      <th className="py-3 px-4">Xodim va bo‘lim</th>
                      <th className="py-3 px-4">Rol / Hudud</th>
                      <th className="py-3 px-4">Foydalanuvchi huquqlari</th>
                      <th className="py-3 px-4">Hisob holati</th>
                      <th className="py-3 px-4 text-right">Boshqarish</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {loadingUsers ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          Yuklanmoqda...
                        </td>
                      </tr>
                    ) : (
                      users.map((u) => {
                        const isSelf = u.id === currentUser.id;
                        return (
                          <tr key={u.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap tabular-nums">
                              {u.serviceId}
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-900">{u.fullName}</div>
                              <div className="text-xs text-slate-500">
                                {u.department} · Guvohnoma: {u.badgeDoc}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-700">
                              <div className="font-semibold text-slate-900">
                                {u.role === 'admin' ? 'Administrator' : 'Oddiy xodim'}
                              </div>
                              {u.role === 'officer' ? (
                                <select
                                  value={u.permissions.assignedRegion}
                                  onChange={(e) =>
                                    handlePermissionToggle(u, { assignedRegion: e.target.value })
                                  }
                                  className="mt-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                >
                                  <option value="ALL">Barcha hududlar</option>
                                  {UZBEKISTAN_REGIONS.map((r) => (
                                    <option key={r.code} value={r.name}>
                                      {r.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="text-slate-500 mt-0.5">To‘liq vakolat</div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-xs">
                              {u.role === 'admin' ? (
                                <span className="text-slate-500">Barcha ma’lumotlar va tahrirlash</span>
                              ) : (
                                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                                  <label className="inline-flex items-center gap-1.5 text-slate-700">
                                    <input
                                      type="checkbox"
                                      checked={u.permissions.canInspect}
                                      onChange={(e) =>
                                        handlePermissionToggle(u, { canInspect: e.target.checked })
                                      }
                                      className="rounded border-slate-300"
                                    />
                                    <span>Tekshiruv</span>
                                  </label>
                                  <label className="inline-flex items-center gap-1.5 text-slate-700">
                                    <input
                                      type="checkbox"
                                      checked={u.permissions.canViewResidents}
                                      onChange={(e) =>
                                        handlePermissionToggle(u, {
                                          canViewResidents: e.target.checked,
                                        })
                                      }
                                      className="rounded border-slate-300"
                                    />
                                    <span>Yashovchilar</span>
                                  </label>
                                  <label className="inline-flex items-center gap-1.5 text-slate-700">
                                    <input
                                      type="checkbox"
                                      checked={u.permissions.canViewContact}
                                      onChange={(e) =>
                                        handlePermissionToggle(u, {
                                          canViewContact: e.target.checked,
                                        })
                                      }
                                      className="rounded border-slate-300"
                                    />
                                    <span>Aloqa</span>
                                  </label>
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-xs whitespace-nowrap">
                              {u.status === 'active' && (
                                <span className="font-semibold text-green-700">Faol</span>
                              )}
                              {u.status === 'pending_activation' && (
                                <span className="font-semibold text-amber-700">
                                  Faollashtirish kutilmoqda
                                </span>
                              )}
                              {u.status === 'blocked' && (
                                <span className="font-semibold text-red-700">Bloklangan</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              {!isSelf ? (
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleRegenerateCode(u)}
                                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                  >
                                    Yangi kod
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleUserBlock(u)}
                                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                                      u.status === 'blocked'
                                        ? 'bg-green-700 text-white hover:bg-green-800'
                                        : 'border border-red-200 text-red-700 hover:bg-red-50'
                                    }`}
                                  >
                                    {u.status === 'blocked' ? 'Faollashtirish' : 'Bloklash'}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">Joriy hisob</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================= */}
        {/* TAB 4: AUDIT LOG & DATABASE BACKUPS       */}
        {/* ========================================= */}
        {activeTab === 'audit' && (
          <div className="space-y-5">
            {auditNotice && (
              <div className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800">
                {auditNotice}
              </div>
            )}

            {/* Database Backups Card */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Database className="h-4 w-4 text-slate-700" />
                  <span>Ma’lumotlar bazasining zaxira nusxalari</span>
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Markazlashgan ma’lumotlar bazasidan istalgan vaqtda to‘liq zaxira nusxasini
                  yaratish va yuklab olish mumkin.
                </p>
                {backups.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {backups.slice(0, 3).map((b) => (
                      <button
                        key={b.filename}
                        type="button"
                        onClick={() => api.downloadBackupFile(b.filename)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-mono text-slate-700 hover:bg-slate-100 tabular-nums"
                      >
                        <Download className="h-3 w-3" />
                        <span>
                          {b.filename} ({Math.max(1, Math.round(b.sizeBytes / 1024))} KB)
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={loadAuditAndBackups}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Yangilash</span>
                </button>
                <button
                  type="button"
                  disabled={creatingBackup}
                  onClick={handleCreateBackup}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
                >
                  <Database className="h-4 w-4" />
                  <span>{creatingBackup ? 'Yaratilmoqda...' : 'Zaxira nusxa yaratish'}</span>
                </button>
              </div>
            </div>

            {/* Search Audit Logs */}
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Xodim ID, ism yoki obyekt bo‘yicha tarixdan qidirish..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            {/* Audit History Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Sana va vaqt</th>
                      <th className="py-3 px-4">Kim amalga oshirgan</th>
                      <th className="py-3 px-4">Obyekt</th>
                      <th className="py-3 px-4">O‘zgarish mazmuni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {loadingAudit ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500">
                          Yuklanmoqda...
                        </td>
                      </tr>
                    ) : filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500">
                          O‘zgarishlar qaydnomasi topilmadi.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap tabular-nums">
                            {new Date(log.createdAt).toLocaleString('uz-UZ', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-semibold text-slate-900 text-xs sm:text-sm">
                              {log.actorName}
                            </div>
                            <div className="font-mono text-xs text-slate-500">
                              {log.actorServiceId}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                            {log.targetId}
                          </td>
                          <td className="py-3 px-4 text-xs sm:text-sm text-slate-800">
                            {log.summary}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
