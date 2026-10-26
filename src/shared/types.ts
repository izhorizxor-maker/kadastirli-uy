export type CadastralStatus = 'has_cadastre' | 'no_cadastre' | 'unknown';

export type UserRole = 'admin' | 'officer';

export type AccountStatus = 'pending_activation' | 'active' | 'blocked';

export interface UserPermissions {
  canViewResidents: boolean;
  canViewContact: boolean;
  canInspect: boolean;
  assignedRegion: string; // 'ALL' or exact region name
}

export interface UserProfile {
  id: number;
  serviceId: string;
  fullName: string;
  department: string;
  badgeDoc: string;
  role: UserRole;
  status: AccountStatus;
  permissions: UserPermissions;
  failedAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HouseRecord {
  id: number;
  houseUid: string;
  cadastreNumber: string | null;
  region: string;
  district: string;
  mahalla: string | null;
  streetAddress: string;
  lat: number;
  lng: number;
  cadastralStatus: CadastralStatus;
  verificationBasis: string | null;
  residentsCount: number | null;
  residentsRestricted?: boolean;
  contactInfo: string | null;
  contactRestricted?: boolean;
  inspectionNote: string | null;
  lastInspectionDate: string | null;
  createdByServiceId: string;
  updatedByServiceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: number;
  actorServiceId: string;
  actorName: string;
  actionType: string;
  targetType: 'house' | 'user' | 'import' | 'security' | 'backup';
  targetId: string;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface RawImportRow {
  rowNumber: number;
  region: string;
  district: string;
  mahalla?: string;
  streetAddress: string;
  lat: number | string;
  lng: number | string;
  cadastralStatus?: string;
  cadastreNumber?: string;
  verificationBasis?: string;
  residentsCount?: number | string | null;
  contactInfo?: string;
  lastInspectionDate?: string;
}

export interface ValidatedImportRow {
  rowNumber: number;
  status: 'valid' | 'duplicate_db' | 'duplicate_file' | 'error';
  errors: string[];
  normalized?: {
    region: string;
    district: string;
    mahalla: string | null;
    streetAddress: string;
    lat: number;
    lng: number;
    cadastralStatus: CadastralStatus;
    cadastreNumber: string | null;
    verificationBasis: string | null;
    residentsCount: number | null;
    contactInfo: string | null;
    lastInspectionDate: string | null;
  };
}

export interface ImportValidationResponse {
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: ValidatedImportRow[];
}

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ResolveBuildingPayload {
  osmId?: number | string;
  region: string;
  district: string;
  mahalla?: string;
  streetAddress: string;
  lat: number;
  lng: number;
  cadastralStatus: CadastralStatus;
  cadastreNumber?: string | null;
  verificationBasis?: string | null;
}

