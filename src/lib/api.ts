import * as XLSX from 'xlsx';
import type {
  AuditLogEntry,
  BackupFileInfo,
  CadastralStatus,
  HouseRecord,
  ImportValidationResponse,
  ResolveBuildingPayload,
  UserPermissions,
  UserProfile,
  UserRole,
} from '../shared/types.ts';

const TOKEN_STORAGE_KEY = 'kadastr_uy_session_token';

let memoryToken: string | null = null;

export function getAuthToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const saved = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    memoryToken = saved;
    return saved;
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      data.error || 'So‘rovni bajarishda xatolik yuz berdi.',
      res.status,
      data.code
    );
  }
  return data as T;
}

export const api = {
  login(serviceId: string, password: string) {
    return requestJson<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ serviceId, password }),
    });
  },

  activateAccount(serviceId: string, activationCode: string, newPassword: string) {
    return requestJson<{ token: string; user: UserProfile }>('/api/auth/activate', {
      method: 'POST',
      body: JSON.stringify({ serviceId, activationCode, newPassword }),
    });
  },

  getMe() {
    return requestJson<{ user: UserProfile }>('/api/auth/me');
  },

  getHouses(params?: {
    status?: string;
    region?: string;
    district?: string;
    q?: string;
  }) {
    const search = new URLSearchParams();
    if (params?.status && params.status !== 'ALL') search.set('status', params.status);
    if (params?.region && params.region !== 'ALL') search.set('region', params.region);
    if (params?.district && params.district !== 'ALL') search.set('district', params.district);
    if (params?.q) search.set('q', params.q);
    const qs = search.toString();
    return requestJson<{ houses: HouseRecord[] }>(`/api/houses${qs ? `?${qs}` : ''}`);
  },

  getHouseDetail(id: number) {
    return requestJson<{
      house: HouseRecord;
      history: Array<{
        id: number;
        actorServiceId: string;
        actorName: string;
        actionType: string;
        summary: string;
        createdAt: string;
      }>;
    }>(`/api/houses/${id}`);
  },

  submitInspection(
    houseId: number,
    payload: {
      mahalla?: string;
      streetAddress?: string;
      cadastralStatus: CadastralStatus;
      verificationBasis: string;
      cadastreNumber?: string;
      inspectionNote?: string;
      lastInspectionDate?: string;
    }
  ) {
    return requestJson<{ house: HouseRecord }>(`/api/houses/${houseId}/inspect`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  resolveBuilding(payload: ResolveBuildingPayload) {
    return requestJson<{ house: HouseRecord; created: boolean }>('/api/houses/resolve-building', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Admin endpoints
  getUsers() {
    return requestJson<{ users: UserProfile[] }>('/api/admin/users');
  },

  createUser(payload: {
    serviceId: string;
    fullName: string;
    department: string;
    badgeDoc: string;
    role: UserRole;
    permissions: UserPermissions;
  }) {
    return requestJson<{ user: UserProfile; activationCode: string }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateUser(
    id: number,
    payload: {
      fullName?: string;
      department?: string;
      role?: UserRole;
      status?: 'active' | 'blocked';
      permissions?: Partial<UserPermissions>;
      regenerateActivation?: boolean;
    }
  ) {
    return requestJson<{ user: UserProfile; activationCode: string | null }>(
      `/api/admin/users/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  },

  createHouse(payload: {
    region: string;
    district: string;
    mahalla?: string;
    streetAddress: string;
    lat: number;
    lng: number;
    cadastralStatus: CadastralStatus;
    cadastreNumber?: string;
    verificationBasis?: string;
    residentsCount?: number | null;
    contactInfo?: string;
    inspectionNote?: string;
    lastInspectionDate?: string;
  }) {
    return requestJson<{ house: HouseRecord }>('/api/admin/houses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateHouse(
    id: number,
    payload: {
      region: string;
      district: string;
      mahalla?: string | null;
      streetAddress: string;
      lat: number;
      lng: number;
      cadastralStatus: CadastralStatus;
      cadastreNumber?: string | null;
      verificationBasis?: string | null;
      residentsCount?: number | null;
      contactInfo?: string | null;
      inspectionNote?: string | null;
      lastInspectionDate?: string | null;
    }
  ) {
    return requestJson<{ house: HouseRecord }>(`/api/admin/houses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  validateImportFile(fileName: string, fileBase64: string) {
    return requestJson<ImportValidationResponse>('/api/admin/import/validate', {
      method: 'POST',
      body: JSON.stringify({ fileName, fileBase64 }),
    });
  },

  commitImportRows(
    fileName: string,
    items: Array<NonNullable<ImportValidationResponse['rows'][number]['normalized']>>
  ) {
    return requestJson<{ insertedCount: number; skippedDuplicates: number }>(
      '/api/admin/import/commit',
      {
        method: 'POST',
        body: JSON.stringify({ fileName, items }),
      }
    );
  },

  getAuditLogs() {
    return requestJson<{ logs: AuditLogEntry[] }>('/api/admin/audit-logs');
  },

  getBackups() {
    return requestJson<{ backups: BackupFileInfo[] }>('/api/admin/backups');
  },

  createBackup() {
    return requestJson<{ backup: BackupFileInfo; backups: BackupFileInfo[] }>(
      '/api/admin/backups',
      { method: 'POST' }
    );
  },

  async downloadBackupFile(filename: string): Promise<void> {
    const token = getAuthToken();
    const res = await fetch(`/api/admin/backups/${encodeURIComponent(filename)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new Error('Zaxira nusxani yuklab olishda xatolik yuz berdi.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

export function downloadSampleImportTemplate(format: 'xlsx' | 'csv'): void {
  const sampleRows = [
    {
      Viloyat: 'Toshkent shahri',
      Tuman: 'Yakkasaroy tumani',
      Mahalla: 'Bobur MFY',
      'Ko‘cha va uy raqami': 'Shota Rustaveli ko‘chasi, 24-uy',
      Kenglik: 41.2842,
      Uzunlik: 69.2568,
      'Kadastr holati': 'Kadastr mavjud',
      'Kadastr raqami': '10:09:01:02:03:0024',
      'Tasdiqlash asosi': 'Davlat kadastrlar palatasi reestri ma’lumoti',
      'Yashovchilar soni': 4,
      'Aloqa ma’lumoti': '+998 90 123-45-67',
      'Oxirgi tekshiruv sanasi': '2026-10-25',
    },
    {
      Viloyat: 'Samarqand viloyati',
      Tuman: 'Toyloq tumani',
      Mahalla: 'Bog‘izag‘on MFY',
      'Ko‘cha va uy raqami': 'Amir Temur ko‘chasi, 15-uy',
      Kenglik: 39.6035,
      Uzunlik: 67.0942,
      'Kadastr holati': 'Kadastr mavjud emas',
      'Kadastr raqami': '',
      'Tasdiqlash asosi': 'Joyiga chiqib o‘tkazilgan vakolatli tekshiruv dalolatnomasi №92',
      'Yashovchilar soni': 6,
      'Aloqa ma’lumoti': '',
      'Oxirgi tekshiruv sanasi': '2026-10-24',
    },
    {
      Viloyat: 'Farg‘ona viloyati',
      Tuman: 'Rishton tumani',
      Mahalla: 'Kulollar MFY',
      'Ko‘cha va uy raqami': 'Sohibkor ko‘chasi, 7-uy',
      Kenglik: 40.3589,
      Uzunlik: 71.2871,
      'Kadastr holati': 'Holati noma’lum',
      'Kadastr raqami': '',
      'Tasdiqlash asosi': '',
      'Yashovchilar soni': '',
      'Aloqa ma’lumoti': '',
      'Oxirgi tekshiruv sanasi': '',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Uylar');

  if (format === 'csv') {
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kadastrli-uy-namuna.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } else {
    XLSX.writeFile(workbook, 'kadastrli-uy-namuna.xlsx');
  }
}
