import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AccountStatus,
  AuditLogEntry,
  BackupFileInfo,
  CadastralStatus,
  HouseRecord,
  UserProfile,
  UserRole,
} from '../shared/types.ts';
import { UZBEKISTAN_REGIONS, getRegionCode } from '../shared/uzbekistanRegions.ts';
import { hashSecret } from './auth.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = path.join(DATA_DIR, 'kadastr.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    department TEXT NOT NULL,
    badge_doc TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'officer')),
    status TEXT NOT NULL CHECK(status IN ('pending_activation', 'active', 'blocked')),
    password_hash TEXT,
    activation_code_hash TEXT,
    can_view_residents INTEGER NOT NULL DEFAULT 0,
    can_view_contact INTEGER NOT NULL DEFAULT 0,
    can_inspect INTEGER NOT NULL DEFAULT 1,
    assigned_region TEXT NOT NULL DEFAULT 'ALL',
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS houses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_uid TEXT NOT NULL UNIQUE,
    cadastre_number TEXT,
    region TEXT NOT NULL,
    district TEXT NOT NULL,
    mahalla TEXT,
    street_address TEXT NOT NULL,
    normalized_address_key TEXT NOT NULL UNIQUE,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    cadastral_status TEXT NOT NULL CHECK(cadastral_status IN ('has_cadastre', 'no_cadastre', 'unknown')),
    verification_basis TEXT,
    residents_count INTEGER,
    contact_info TEXT,
    inspection_note TEXT,
    last_inspection_date TEXT,
    created_by_service_id TEXT NOT NULL,
    updated_by_service_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_houses_region ON houses(region);
  CREATE INDEX IF NOT EXISTS idx_houses_district ON houses(district);
  CREATE INDEX IF NOT EXISTS idx_houses_status ON houses(cadastral_status);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_service_id TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    details_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
`);

export function normalizeText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/['`´ʻʼ]/g, '‘');
}

export function buildNormalizedAddressKey(
  region: string,
  district: string,
  streetAddress: string
): string {
  return [region, district, streetAddress]
    .map((part) => normalizeText(part).toLowerCase())
    .join('|');
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function generateNextHouseUid(regionName: string): string {
  const code = getRegionCode(regionName);
  const row = db
    .prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM houses`)
    .get() as { next_id: number };
  const padded = String(row.next_id).padStart(6, '0');
  return `UY-${code}-${padded}`;
}

export interface DbUserRow {
  id: number;
  service_id: string;
  full_name: string;
  department: string;
  badge_doc: string;
  role: UserRole;
  status: AccountStatus;
  password_hash: string | null;
  activation_code_hash: string | null;
  can_view_residents: number;
  can_view_contact: number;
  can_inspect: number;
  assigned_region: string;
  failed_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbHouseRow {
  id: number;
  house_uid: string;
  cadastre_number: string | null;
  region: string;
  district: string;
  mahalla: string | null;
  street_address: string;
  normalized_address_key: string;
  lat: number;
  lng: number;
  cadastral_status: CadastralStatus;
  verification_basis: string | null;
  residents_count: number | null;
  contact_info: string | null;
  inspection_note: string | null;
  last_inspection_date: string | null;
  created_by_service_id: string;
  updated_by_service_id: string;
  created_at: string;
  updated_at: string;
}

export function mapUserRowToProfile(row: DbUserRow): UserProfile {
  const isAdmin = row.role === 'admin';
  return {
    id: row.id,
    serviceId: row.service_id,
    fullName: row.full_name,
    department: row.department,
    badgeDoc: row.badge_doc,
    role: row.role,
    status: row.status,
    permissions: {
      canViewResidents: isAdmin || Boolean(row.can_view_residents),
      canViewContact: isAdmin || Boolean(row.can_view_contact),
      canInspect: isAdmin || Boolean(row.can_inspect),
      assignedRegion: isAdmin ? 'ALL' : row.assigned_region,
    },
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapHouseRowForUser(row: DbHouseRow, user: UserProfile): HouseRecord {
  const allowResidents = user.role === 'admin' || user.permissions.canViewResidents;
  const allowContact = user.role === 'admin' || user.permissions.canViewContact;

  return {
    id: row.id,
    houseUid: row.house_uid,
    cadastreNumber: row.cadastre_number,
    region: row.region,
    district: row.district,
    mahalla: row.mahalla,
    streetAddress: row.street_address,
    lat: row.lat,
    lng: row.lng,
    cadastralStatus: row.cadastral_status,
    verificationBasis: row.verification_basis,
    residentsCount: allowResidents ? row.residents_count : null,
    residentsRestricted: !allowResidents && row.residents_count !== null,
    contactInfo: allowContact ? row.contact_info : null,
    contactRestricted: !allowContact && Boolean(row.contact_info),
    inspectionNote: row.inspection_note,
    lastInspectionDate: row.last_inspection_date,
    createdByServiceId: row.created_by_service_id,
    updatedByServiceId: row.updated_by_service_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function writeAuditLog(params: {
  actorServiceId: string;
  actorName: string;
  actionType: string;
  targetType: 'house' | 'user' | 'import' | 'security' | 'backup';
  targetId: string;
  summary: string;
  details?: Record<string, unknown> | null;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_logs (
      actor_service_id, actor_name, action_type, target_type, target_id, summary, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.actorServiceId,
    params.actorName,
    params.actionType,
    params.targetType,
    params.targetId,
    params.summary,
    params.details ? JSON.stringify(params.details) : null,
    now
  );
}

export function getAuditLogs(limit = 150): AuditLogEntry[] {
  const rows = db
    .prepare(
      `SELECT id, actor_service_id, actor_name, action_type, target_type, target_id, summary, details_json, created_at
       FROM audit_logs
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    id: number;
    actor_service_id: string;
    actor_name: string;
    action_type: string;
    target_type: 'house' | 'user' | 'import' | 'security' | 'backup';
    target_id: string;
    summary: string;
    details_json: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    actorServiceId: r.actor_service_id,
    actorName: r.actor_name,
    actionType: r.action_type,
    targetType: r.target_type,
    targetId: r.target_id,
    summary: r.summary,
    details: r.details_json ? (JSON.parse(r.details_json) as Record<string, unknown>) : null,
    createdAt: r.created_at,
  }));
}

export function createDatabaseBackup(): BackupFileInfo {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `kadastr-backup-${stamp}.sqlite`;
  const fullPath = path.join(BACKUPS_DIR, filename);
  const escapedPath = fullPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedPath}'`);
  const stat = fs.statSync(fullPath);
  return {
    filename,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
  };
}

export function listDatabaseBackups(): BackupFileInfo[] {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.sqlite'))
    .map((filename) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, filename));
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function seedInitialDataIfEmpty(): void {
  const userCount = (db.prepare(`SELECT COUNT(*) AS cnt FROM users`).get() as { cnt: number }).cnt;
  if (userCount > 0) {
    return;
  }

  const now = '2026-10-25T09:00:00.000Z';

  const insertUser = db.prepare(`
    INSERT INTO users (
      service_id, full_name, department, badge_doc, role, status,
      password_hash, activation_code_hash,
      can_view_residents, can_view_contact, can_inspect, assigned_region,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1. System Administrator
  insertUser.run(
    'AE7130358',
    'Ilhomjonov Izhoriddin',
    'Axborot texnologiyalari va kadastr monitoringi boshqarmasi',
    'GUV-000184',
    'admin',
    'active',
    hashSecret('Admin@2026!'),
    null,
    1,
    1,
    1,
    'ALL',
    now,
    now
  );

  // 2. Active Field Inspector (has residents view & inspect rights, contact info restricted to demonstrate RBAC)
  insertUser.run(
    'IIV-101',
    'Karimov Sardorbek Rustamovich',
    'Huquqbuzarliklar profilaktikasi xizmati (Katta inspektor)',
    'GUV-014920',
    'officer',
    'active',
    hashSecret('Xodim@2026!'),
    null,
    1,
    0,
    1,
    'ALL',
    now,
    now
  );

  // 3. Pre-registered Officer awaiting first-time secure activation
  insertUser.run(
    'IIV-202',
    'Tursunov Bekzod Alisherovich',
    'Toshkent shahar profilaktika inspektorlari bo‘limi',
    'GUV-022510',
    'officer',
    'pending_activation',
    null,
    hashSecret('FAOL-8842'),
    1,
    1,
    1,
    'Toshkent shahri',
    now,
    now
  );

  const seedHouses: Array<{
    region: string;
    district: string;
    mahalla: string;
    streetAddress: string;
    lat: number;
    lng: number;
    status: CadastralStatus;
    cadastreNumber: string | null;
    basis: string | null;
    residents: number | null;
    contact: string | null;
    note: string | null;
    inspectedAt: string | null;
  }> = [
    // Toshkent shahri — dense cluster across districts
    {
      region: 'Toshkent shahri',
      district: 'Chilonzor tumani',
      mahalla: 'Qatortol MFY',
      streetAddress: 'Qatortol ko‘chasi, 14-uy',
      lat: 41.2764,
      lng: 69.2068,
      status: 'has_cadastre',
      cadastreNumber: '10:05:02:04:01:0014',
      basis: 'Davlat kadastrlar palatasi reestri ma’lumoti',
      residents: 5,
      contact: '+998 90 912-44-18 (Mulkdor vakili)',
      note: 'Hujjatlar amaldagi kadastr reestri bilan to‘liq mos keladi.',
      inspectedAt: '2026-10-18',
    },
    {
      region: 'Toshkent shahri',
      district: 'Chilonzor tumani',
      mahalla: 'Qatortol MFY',
      streetAddress: 'Qatortol ko‘chasi, 18A-uy',
      lat: 41.2749,
      lng: 69.2089,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Vakolatli profilaktika tekshiruvi dalolatnomasi №142/26',
      residents: 4,
      contact: '+998 93 540-19-02',
      note: 'Qo‘shimcha qurilgan turar joy binosi uchun kadastr hujjati rasmiylashtirilmagan.',
      inspectedAt: '2026-10-21',
    },
    {
      region: 'Toshkent shahri',
      district: 'Chilonzor tumani',
      mahalla: 'Novza MFY',
      streetAddress: 'Muqimiy ko‘chasi, 41-uy',
      lat: 41.2898,
      lng: 69.2215,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: null,
      contact: null,
      note: 'Kadastr ma’lumotnomasi hali taqdim etilmagan, tekshiruv rejalashtirilgan.',
      inspectedAt: null,
    },
    {
      region: 'Toshkent shahri',
      district: 'Yunusobod tumani',
      mahalla: 'Bodomzor MFY',
      streetAddress: 'Amir Temur shoh ko‘chasi, 109-uy',
      lat: 41.3452,
      lng: 69.2867,
      status: 'has_cadastre',
      cadastreNumber: '10:08:01:02:05:0109',
      basis: 'Davlat kadastrlar palatasi reestri ma’lumoti',
      residents: 6,
      contact: '+998 97 701-88-30',
      note: 'Turar joy davlat ro‘yxatidan o‘tkazilgan.',
      inspectedAt: '2026-10-12',
    },
    {
      region: 'Toshkent shahri',
      district: 'Yunusobod tumani',
      mahalla: 'Otchopar MFY',
      streetAddress: 'Chinobod ko‘chasi, 27-uy',
      lat: 41.3638,
      lng: 69.2981,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Joyiga chiqib o‘tkazilgan tekshiruv dalolatnomasi №208/26',
      residents: 7,
      contact: '+998 99 815-63-11',
      note: 'Davlat ro‘yxatidan o‘tmagan yakka tartibdagi uy-joy aniqlandi.',
      inspectedAt: '2026-10-22',
    },
    {
      region: 'Toshkent shahri',
      district: 'Mirzo Ulug‘bek tumani',
      mahalla: 'Darxon MFY',
      streetAddress: 'Mustaqillik ko‘chasi, 12-uy',
      lat: 41.3208,
      lng: 69.3045,
      status: 'has_cadastre',
      cadastreNumber: '10:03:06:01:02:0012',
      basis: 'Davlat kadastrlar palatasi reestri ma’lumoti',
      residents: 3,
      contact: '+998 90 177-22-94',
      note: 'Kadastr pasporti mavjud.',
      inspectedAt: '2026-10-10',
    },
    {
      region: 'Toshkent shahri',
      district: 'Shayxontohur tumani',
      mahalla: 'Ko‘kcha MFY',
      streetAddress: 'Uyg‘ur ko‘chasi, 63-uy',
      lat: 41.3239,
      lng: 69.2184,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: 5,
      contact: null,
      note: 'Meros bo‘yicha qayta rasmiylashtirish jarayonida, holati aniqlashtirilmoqda.',
      inspectedAt: null,
    },
    {
      region: 'Toshkent shahri',
      district: 'Sergeli tumani',
      mahalla: 'Qipchoq MFY',
      streetAddress: 'Yangi Sergeli ko‘chasi, 85-uy',
      lat: 41.2194,
      lng: 69.2198,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Tuman IIO FMB va kadastr qo‘shma xati №89-k',
      residents: 6,
      contact: '+998 94 612-07-55',
      note: 'Kadastr raqami biriktirilmagan xonadon.',
      inspectedAt: '2026-10-19',
    },
    {
      region: 'Toshkent shahri',
      district: 'Olmazor tumani',
      mahalla: 'Sebzor MFY',
      streetAddress: 'Sag‘bon ko‘chasi, 32-uy',
      lat: 41.3478,
      lng: 69.2341,
      status: 'has_cadastre',
      cadastreNumber: '10:04:03:02:01:0032',
      basis: 'Davlat kadastrlar palatasi reestri ma’lumoti',
      residents: 8,
      contact: '+998 90 325-40-10',
      note: 'Mulk huquqi davlat reestrida tasdiqlangan.',
      inspectedAt: '2026-10-15',
    },
    {
      region: 'Toshkent shahri',
      district: 'Yashnobod tumani',
      mahalla: 'Tuzel MFY',
      streetAddress: 'Parkent yo‘li ko‘chasi, 54-uy',
      lat: 41.3012,
      lng: 69.3492,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: null,
      contact: null,
      note: 'Birlamchi manzil ro‘yxatga olindi, tekshiruv kutilmoqda.',
      inspectedAt: null,
    },

    // Toshkent viloyati
    {
      region: 'Toshkent viloyati',
      district: 'Chirchiq shahri',
      mahalla: 'Navbahor MFY',
      streetAddress: 'Amir Temur ko‘chasi, 45-uy',
      lat: 41.4712,
      lng: 69.5861,
      status: 'has_cadastre',
      cadastreNumber: '11:18:01:03:02:0045',
      basis: 'Kadastr reestri ko‘chirmasi',
      residents: 4,
      contact: '+998 99 402-11-76',
      note: 'Kadastr hujjati tasdiqlangan.',
      inspectedAt: '2026-10-14',
    },
    {
      region: 'Toshkent viloyati',
      district: 'Zangiota tumani',
      mahalla: 'Eshonguzar MFY',
      streetAddress: 'Bog‘ishamol ko‘chasi, 19-uy',
      lat: 41.2044,
      lng: 69.1562,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Joyiga chiqib o‘rganish dalolatnomasi №54/26',
      residents: 6,
      contact: '+998 93 390-81-24',
      note: 'Hovli-joy bo‘yicha davlat ro‘yxatidan o‘tkazilganlik hujjati mavjud emas.',
      inspectedAt: '2026-10-20',
    },
    {
      region: 'Toshkent viloyati',
      district: 'Qibray tumani',
      mahalla: 'Baytqo‘rg‘on MFY',
      streetAddress: 'Universitet ko‘chasi, 7-uy',
      lat: 41.3915,
      lng: 69.4682,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: null,
      contact: null,
      note: 'Ma’lumot kadastr organi so‘rovi orqali tekshirilmoqda.',
      inspectedAt: null,
    },

    // Samarqand viloyati (includes disambiguation example "Mustaqillik ko‘chasi, 12-uy")
    {
      region: 'Samarqand viloyati',
      district: 'Samarqand shahri',
      mahalla: 'Registon MFY',
      streetAddress: 'Mustaqillik ko‘chasi, 12-uy',
      lat: 39.6561,
      lng: 66.9685,
      status: 'has_cadastre',
      cadastreNumber: '18:01:02:01:04:0012',
      basis: 'Davlat kadastrlar palatasi reestri ma’lumoti',
      residents: 5,
      contact: '+998 91 532-60-14',
      note: 'Hujjatlari to‘liq joyida.',
      inspectedAt: '2026-10-16',
    },
    {
      region: 'Samarqand viloyati',
      district: 'Samarqand shahri',
      mahalla: 'Siyob MFY',
      streetAddress: 'Toshkent yo‘li ko‘chasi, 77-uy',
      lat: 39.6692,
      lng: 66.9814,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Vakolatli tekshiruv dalolatnomasi №78/SAM',
      residents: 7,
      contact: '+998 91 548-09-33',
      note: 'Kadastr raqami mavjud emasligi joyida tasdiqlandi.',
      inspectedAt: '2026-10-23',
    },
    {
      region: 'Samarqand viloyati',
      district: 'Urgut tumani',
      mahalla: 'Mergancha MFY',
      streetAddress: 'Navoiy shoh ko‘chasi, 34-uy',
      lat: 39.4054,
      lng: 67.2468,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: 6,
      contact: null,
      note: 'Tekshiruv navbatiga kiritilgan.',
      inspectedAt: null,
    },

    // Farg‘ona viloyati
    {
      region: 'Farg‘ona viloyati',
      district: 'Farg‘ona shahri',
      mahalla: 'Al-Farg‘oniy MFY',
      streetAddress: 'Al-Farg‘oniy ko‘chasi, 23-uy',
      lat: 40.3869,
      lng: 71.7876,
      status: 'has_cadastre',
      cadastreNumber: '15:01:03:02:01:0023',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 4,
      contact: '+998 90 560-42-19',
      note: 'Mulk huquqi tasdiqlangan.',
      inspectedAt: '2026-10-11',
    },
    {
      region: 'Farg‘ona viloyati',
      district: 'Marg‘ilon shahri',
      mahalla: 'Hunarmandlar MFY',
      streetAddress: 'Mustaqillik ko‘chasi, 88-uy',
      lat: 40.4738,
      lng: 71.7219,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Profilaktika inspektori tekshiruv dalolatnomasi №31/FAR',
      residents: 5,
      contact: '+998 91 664-12-80',
      note: 'Yangi qurilgan uy-joyga kadastr pasporti olinmagan.',
      inspectedAt: '2026-10-20',
    },
    {
      region: 'Farg‘ona viloyati',
      district: 'Qo‘qon shahri',
      mahalla: 'O‘rda MFY',
      streetAddress: 'Istiqlol ko‘chasi, 15-uy',
      lat: 40.5311,
      lng: 70.9462,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: null,
      contact: null,
      note: 'Kadastr holati bo‘yicha ma’lumot aniqlanmoqda.',
      inspectedAt: null,
    },

    // Andijon viloyati
    {
      region: 'Andijon viloyati',
      district: 'Andijon shahri',
      mahalla: 'Boburshoh MFY',
      streetAddress: 'Bobur shoh ko‘chasi, 52-uy',
      lat: 40.7849,
      lng: 72.3491,
      status: 'has_cadastre',
      cadastreNumber: '17:01:01:04:02:0052',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 5,
      contact: '+998 97 992-31-05',
      note: 'Davlat reestrida mavjud.',
      inspectedAt: '2026-10-13',
    },
    {
      region: 'Andijon viloyati',
      district: 'Asaka tumani',
      mahalla: 'Navro‘z MFY',
      streetAddress: 'Imom Buxoriy ko‘chasi, 9-uy',
      lat: 40.6442,
      lng: 72.2412,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Tuman ishchi guruhi dalolatnomasi №19/AND',
      residents: 6,
      contact: null,
      note: 'Kadastr hujjati yo‘qligi tasdiqlandi.',
      inspectedAt: '2026-10-22',
    },

    // Namangan viloyati
    {
      region: 'Namangan viloyati',
      district: 'Namangan shahri',
      mahalla: 'Gulshan MFY',
      streetAddress: 'Navoiy ko‘chasi, 31-uy',
      lat: 41.0012,
      lng: 71.6764,
      status: 'has_cadastre',
      cadastreNumber: '16:01:02:03:01:0031',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 4,
      contact: '+998 93 491-77-12',
      note: 'Hujjatlar joyida.',
      inspectedAt: '2026-10-17',
    },
    {
      region: 'Namangan viloyati',
      district: 'Chust tumani',
      mahalla: 'Do‘stlik MFY',
      streetAddress: 'Bog‘bonlar ko‘chasi, 17-uy',
      lat: 41.0061,
      lng: 71.2411,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: null,
      contact: null,
      note: 'Tekshiruv o‘tkazilmagan.',
      inspectedAt: null,
    },

    // Buxoro viloyati
    {
      region: 'Buxoro viloyati',
      district: 'Buxoro shahri',
      mahalla: 'Labihovuz MFY',
      streetAddress: 'Bahouddin Naqshband ko‘chasi, 64-uy',
      lat: 39.7731,
      lng: 64.4215,
      status: 'has_cadastre',
      cadastreNumber: '20:01:04:01:02:0064',
      basis: 'Davlat kadastrlar palatasi ma’lumoti',
      residents: 5,
      contact: '+998 91 404-28-90',
      note: 'Kadastr raqami tasdiqlangan.',
      inspectedAt: '2026-10-14',
    },
    {
      region: 'Buxoro viloyati',
      district: 'G‘ijduvon tumani',
      mahalla: 'Ulug‘bek MFY',
      streetAddress: 'Sharq ko‘chasi, 29-uy',
      lat: 40.1032,
      lng: 64.6845,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Vakolatli tekshiruv dalolatnomasi №44/BUX',
      residents: 5,
      contact: '+998 90 711-53-68',
      note: 'Uy-joy kadastr ro‘yxatidan o‘tmagan.',
      inspectedAt: '2026-10-21',
    },

    // Navoiy viloyati
    {
      region: 'Navoiy viloyati',
      district: 'Navoiy shahri',
      mahalla: 'Yoshlik MFY',
      streetAddress: 'G‘alaba shoh ko‘chasi, 16-uy',
      lat: 40.0872,
      lng: 65.3834,
      status: 'has_cadastre',
      cadastreNumber: '21:01:01:02:03:0016',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 3,
      contact: '+998 93 317-90-45',
      note: 'Tasdiqlangan kadastr hujjati mavjud.',
      inspectedAt: '2026-10-09',
    },
    {
      region: 'Navoiy viloyati',
      district: 'Karmana tumani',
      mahalla: 'Qosim Shayx MFY',
      streetAddress: 'Mirzo Ulug‘bek ko‘chasi, 8-uy',
      lat: 40.1445,
      lng: 65.3688,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: null,
      contact: null,
      note: 'Ma’lumot yetarli emas, o‘rganish belgilangan.',
      inspectedAt: null,
    },

    // Qashqadaryo viloyati
    {
      region: 'Qashqadaryo viloyati',
      district: 'Qarshi shahri',
      mahalla: 'Nasaf MFY',
      streetAddress: 'O‘zbekiston ovozi ko‘chasi, 40-uy',
      lat: 38.8634,
      lng: 65.7932,
      status: 'has_cadastre',
      cadastreNumber: '18:10:02:01:01:0040',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 6,
      contact: '+998 90 668-14-72',
      note: 'Ro‘yxatdan o‘tgan.',
      inspectedAt: '2026-10-15',
    },
    {
      region: 'Qashqadaryo viloyati',
      district: 'Shahrisabz shahri',
      mahalla: 'Oqsaroy MFY',
      streetAddress: 'Ipak yo‘li ko‘chasi, 21-uy',
      lat: 39.0604,
      lng: 66.8371,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Joyiga chiqib o‘rganish dalolatnomasi №62/QAS',
      residents: 7,
      contact: null,
      note: 'Kadastr hujjati rasmiylashtirilmagan.',
      inspectedAt: '2026-10-24',
    },

    // Surxondaryo viloyati
    {
      region: 'Surxondaryo viloyati',
      district: 'Termiz shahri',
      mahalla: 'Surxon MFY',
      streetAddress: 'At-Termiziy ko‘chasi, 11-uy',
      lat: 37.2271,
      lng: 67.2819,
      status: 'has_cadastre',
      cadastreNumber: '19:01:03:01:02:0011',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 5,
      contact: '+998 91 904-55-21',
      note: 'Tasdiqlangan.',
      inspectedAt: '2026-10-13',
    },
    {
      region: 'Surxondaryo viloyati',
      district: 'Denov tumani',
      mahalla: 'Lochin MFY',
      streetAddress: 'Sharof Rashidov ko‘chasi, 47-uy',
      lat: 38.2701,
      lng: 67.9022,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: null,
      contact: null,
      note: 'Kadastr holati hali tekshirilmagan.',
      inspectedAt: null,
    },

    // Jizzax viloyati
    {
      region: 'Jizzax viloyati',
      district: 'Jizzax shahri',
      mahalla: 'Zilol MFY',
      streetAddress: 'Sharof Rashidov shoh ko‘chasi, 28-uy',
      lat: 40.1189,
      lng: 67.8456,
      status: 'has_cadastre',
      cadastreNumber: '13:01:01:02:04:0028',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 4,
      contact: '+998 94 342-18-66',
      note: 'Davlat reestrida mavjud.',
      inspectedAt: '2026-10-16',
    },
    {
      region: 'Jizzax viloyati',
      district: 'Zomin tumani',
      mahalla: 'Archazor MFY',
      streetAddress: 'Mustaqillik ko‘chasi, 5-uy',
      lat: 39.9631,
      lng: 68.3987,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Vakolatli tekshiruv dalolatnomasi №17/JIZ',
      residents: 5,
      contact: null,
      note: 'Kadastr hujjati mavjud emasligi tasdiqlandi.',
      inspectedAt: '2026-10-22',
    },

    // Sirdaryo viloyati
    {
      region: 'Sirdaryo viloyati',
      district: 'Guliston shahri',
      mahalla: 'Bahor MFY',
      streetAddress: 'O‘zbekiston shoh ko‘chasi, 36-uy',
      lat: 40.4922,
      lng: 68.7874,
      status: 'has_cadastre',
      cadastreNumber: '12:01:02:01:01:0036',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 4,
      contact: '+998 99 475-30-91',
      note: 'Hujjatlar tasdiqlangan.',
      inspectedAt: '2026-10-12',
    },
    {
      region: 'Sirdaryo viloyati',
      district: 'Yangiyer shahri',
      mahalla: 'Shodlik MFY',
      streetAddress: 'Tinchlik ko‘chasi, 14-uy',
      lat: 40.2774,
      lng: 68.8251,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: null,
      contact: null,
      note: 'Holati o‘rganilmoqda.',
      inspectedAt: null,
    },

    // Xorazm viloyati
    {
      region: 'Xorazm viloyati',
      district: 'Urganch shahri',
      mahalla: 'Al-Xorazmiy MFY',
      streetAddress: 'Al-Xorazmiy ko‘chasi, 19-uy',
      lat: 41.5531,
      lng: 60.6368,
      status: 'has_cadastre',
      cadastreNumber: '22:01:01:03:02:0019',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 5,
      contact: '+998 91 995-40-17',
      note: 'Kadastr pasporti mavjud.',
      inspectedAt: '2026-10-18',
    },
    {
      region: 'Xorazm viloyati',
      district: 'Xiva shahri',
      mahalla: 'Mevaston MFY',
      streetAddress: 'Pahlavon Mahmud ko‘chasi, 42-uy',
      lat: 41.3806,
      lng: 60.3672,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Tekshiruv dalolatnomasi №29/XOR',
      residents: 6,
      contact: null,
      note: 'Qo‘shimcha turar joy binosi kadastrdan o‘tmagan.',
      inspectedAt: '2026-10-23',
    },

    // Qoraqalpog‘iston Respublikasi
    {
      region: 'Qoraqalpog‘iston Respublikasi',
      district: 'Nukus shahri',
      mahalla: 'Dosliq MFY',
      streetAddress: 'Qoraqalpog‘iston ko‘chasi, 25-uy',
      lat: 42.4648,
      lng: 59.6204,
      status: 'has_cadastre',
      cadastreNumber: '23:01:02:02:01:0025',
      basis: 'Kadastr reestri ma’lumoti',
      residents: 5,
      contact: '+998 97 355-62-08',
      note: 'Kadastr reestrida tasdiqlangan.',
      inspectedAt: '2026-10-15',
    },
    {
      region: 'Qoraqalpog‘iston Respublikasi',
      district: 'To‘rtko‘l tumani',
      mahalla: 'Beruniy MFY',
      streetAddress: 'Mustaqillik ko‘chasi, 30-uy',
      lat: 41.5548,
      lng: 61.0046,
      status: 'unknown',
      cadastreNumber: null,
      basis: null,
      residents: null,
      contact: null,
      note: 'Ma’lumot aniqlashtirilmoqda.',
      inspectedAt: null,
    },
    {
      region: 'Qoraqalpog‘iston Respublikasi',
      district: 'Qo‘ng‘irot tumani',
      mahalla: 'Temiryo‘lchi MFY',
      streetAddress: 'Berdax ko‘chasi, 13-uy',
      lat: 43.0449,
      lng: 58.8538,
      status: 'no_cadastre',
      cadastreNumber: null,
      basis: 'Joyiga chiqib o‘rganish dalolatnomasi №11/QOR',
      residents: 4,
      contact: null,
      note: 'Kadastr hujjati yo‘qligi tasdiqlangan.',
      inspectedAt: '2026-10-20',
    },
  ];

  const insertHouse = db.prepare(`
    INSERT INTO houses (
      house_uid, cadastre_number, region, district, mahalla, street_address,
      normalized_address_key, lat, lng, cadastral_status, verification_basis,
      residents_count, contact_info, inspection_note, last_inspection_date,
      created_by_service_id, updated_by_service_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  seedHouses.forEach((h, idx) => {
    const uid = `UY-${getRegionCode(h.region)}-${String(idx + 1).padStart(6, '0')}`;
    const normKey = buildNormalizedAddressKey(h.region, h.district, h.streetAddress);
    insertHouse.run(
      uid,
      h.cadastreNumber,
      normalizeText(h.region),
      normalizeText(h.district),
      h.mahalla ? normalizeText(h.mahalla) : null,
      normalizeText(h.streetAddress),
      normKey,
      h.lat,
      h.lng,
      h.status,
      h.basis,
      h.residents,
      h.contact,
      h.note,
      h.inspectedAt,
      'AE7130358',
      'AE7130358',
      now,
      now
    );
  });

  writeAuditLog({
    actorServiceId: 'AE7130358',
    actorName: 'Ilhomjonov Izhoriddin',
    actionType: 'TIZIM_ISHGA_TUSHIRILDI',
    targetType: 'import',
    targetId: 'BOSHLANGICH_BAZA',
    summary: `Markazlashgan ma’lumotlar bazasi shakllantirildi (${seedHouses.length} ta uy yozuvi kiritildi).`,
    details: { count: seedHouses.length },
  });
}

function migrateAdminServiceId(): void {
  const legacyAdmin = db
    .prepare(`SELECT id FROM users WHERE service_id = 'IIV-ADMIN'`)
    .get() as { id: number } | undefined;
  const targetExists = db
    .prepare(`SELECT id FROM users WHERE service_id = 'AE7130358'`)
    .get() as { id: number } | undefined;

  if (legacyAdmin && !targetExists) {
    db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      db.prepare(`UPDATE users SET service_id = 'AE7130358', updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        legacyAdmin.id
      );
      db.prepare(
        `UPDATE houses SET created_by_service_id = 'AE7130358' WHERE created_by_service_id = 'IIV-ADMIN'`
      ).run();
      db.prepare(
        `UPDATE houses SET updated_by_service_id = 'AE7130358' WHERE updated_by_service_id = 'IIV-ADMIN'`
      ).run();
      db.prepare(
        `UPDATE audit_logs SET actor_service_id = 'AE7130358' WHERE actor_service_id = 'IIV-ADMIN'`
      ).run();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error('Failed to migrate admin service_id:', err);
    }
  }

  // Ensure primary admin account is unlocked and active with known hash if unactivated/locked
  db.prepare(
    `UPDATE users SET failed_attempts = 0, locked_until = NULL, status = 'active' WHERE service_id = 'AE7130358'`
  ).run();
}

function cleanupSyntheticFakeStreetSeeds(): void {
  // Remove untouched auto-generated synthetic rows (timestamp 2026-10-25T10:30:00.000Z)
  // whose arithmetic offsets placed fake street names & house numbers on wrong real-world streets.
  // Any record created or edited by an administrator/officer is preserved.
  try {
    const res = db
      .prepare(
        `DELETE FROM houses
         WHERE created_at = '2026-10-25T10:30:00.000Z'
           AND updated_at = '2026-10-25T10:30:00.000Z'`
      )
      .run();
    if (res.changes > 0) {
      db.prepare(
        `DELETE FROM audit_logs WHERE action_type = 'HUDUDLAR_BAZASI_KENGAYTIRILDI'`
      ).run();
    }
  } catch (err) {
    console.error('Failed to clean up synthetic seed houses:', err);
  }
}

seedInitialDataIfEmpty();
migrateAdminServiceId();
cleanupSyntheticFakeStreetSeeds();
