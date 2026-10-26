import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import {
  clearIpFailures,
  generateOneTimeActivationCode,
  hashSecret,
  isIpRateLimited,
  recordIpFailure,
  signSessionToken,
  verifySecret,
  verifySessionToken,
} from './src/server/auth.ts';
import {
  BACKUPS_DIR,
  buildNormalizedAddressKey,
  createDatabaseBackup,
  db,
  generateNextHouseUid,
  getAuditLogs,
  haversineMeters,
  listDatabaseBackups,
  mapHouseRowForUser,
  mapUserRowToProfile,
  normalizeText,
  writeAuditLog,
} from './src/server/db.ts';
import type { DbHouseRow, DbUserRow } from './src/server/db.ts';
import type {
  CadastralStatus,
  ImportValidationResponse,
  UserProfile,
  UserRole,
  ValidatedImportRow,
} from './src/shared/types.ts';
import {
  UZBEKISTAN_BOUNDS,
  UZBEKISTAN_REGIONS,
  findNearestAdminArea,
} from './src/shared/uzbekistanRegions.ts';

interface AuthenticatedRequest extends Request {
  currentUser?: UserProfile;
}

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Avtorizatsiya talab qilinadi. Tizimga qayta kiring.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sessiya muddati tugagan yoki yaroqsiz. Qayta kiring.' });
    return;
  }

  const row = db
    .prepare(`SELECT * FROM users WHERE id = ?`)
    .get(payload.uid) as DbUserRow | undefined;

  if (!row) {
    res.status(401).json({ error: 'Foydalanuvchi hisobi topilmadi.' });
    return;
  }

  if (row.status === 'blocked') {
    res.status(403).json({ error: 'Hisobingiz administrator tomonidan bloklangan.' });
    return;
  }

  if (row.status !== 'active') {
    res.status(403).json({ error: 'Hisob faol holatda emas.' });
    return;
  }

  req.currentUser = mapUserRowToProfile(row);
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    res.status(403).json({ error: 'Ushbu bo‘limga faqat administrator kirishi mumkin.' });
    return;
  }
  next();
}

function parseCadastralStatusFromInput(raw: unknown): {
  status: CadastralStatus;
  invalid: boolean;
} {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    // TZ Golden Rule: Unrecorded / blank status MUST be 'unknown', NEVER 'no_cadastre'
    return { status: 'unknown', invalid: false };
  }
  const val = normalizeText(String(raw)).toLowerCase();
  if (
    val === 'has_cadastre' ||
    val === 'kadastr mavjud' ||
    val === 'mavjud' ||
    val === 'bor' ||
    val === 'yashil' ||
    val === 'tasdiqlangan'
  ) {
    return { status: 'has_cadastre', invalid: false };
  }
  if (
    val === 'no_cadastre' ||
    val === 'kadastr mavjud emas' ||
    val === 'mavjud emas' ||
    val === 'kadastrsiz' ||
    val === 'yo‘q' ||
    val === 'yoq' ||
    val === 'qizil'
  ) {
    return { status: 'no_cadastre', invalid: false };
  }
  if (
    val === 'unknown' ||
    val === 'holati noma’lum' ||
    val === 'noma’lum' ||
    val === 'nomalum' ||
    val === 'tekshirilmagan' ||
    val === 'sariq'
  ) {
    return { status: 'unknown', invalid: false };
  }
  return { status: 'unknown', invalid: true };
}

function findCanonicalRegionName(input: string): string | null {
  const cleaned = normalizeText(input).toLowerCase();
  for (const r of UZBEKISTAN_REGIONS) {
    const rLower = r.name.toLowerCase();
    if (
      rLower === cleaned ||
      rLower.replace(' viloyati', '') === cleaned ||
      rLower.replace(' respublikasi', '') === cleaned ||
      (cleaned === 'toshkent sh.' && r.code === 'TOS') ||
      (cleaned === 'toshkent shahar' && r.code === 'TOS') ||
      (cleaned === 'qoraqalpog‘iston' && r.code === 'QOR')
    ) {
      return r.name;
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '12mb' }));

  const cyrillicToLatinMap: Record<string, string> = {
    А: 'A',
    а: 'a',
    В: 'B',
    Е: 'E',
    е: 'e',
    К: 'K',
    к: 'k',
    М: 'M',
    м: 'm',
    Н: 'H',
    О: 'O',
    о: 'o',
    Р: 'P',
    р: 'p',
    С: 'C',
    с: 'c',
    Т: 'T',
    У: 'U',
    у: 'u',
    Х: 'X',
    х: 'x',
  };

  function normalizeServiceId(raw: unknown): string {
    return String(raw || '')
      .replace(/[\s·`"'‘’\u200B-\u200D\uFEFF]+/g, '')
      .toUpperCase()
      .replace(/[АаВЕеКкМмНОоРрСсТУуХх]/g, (ch) => (cyrillicToLatinMap[ch] || ch).toUpperCase());
  }

  function cleanPasswordInput(raw: unknown): string {
    return String(raw || '').replace(
      /^[\s\u00A0\u200B-\u200D\uFEFF`·]+|[\s\u00A0\u200B-\u200D\uFEFF`]+$/g,
      ''
    );
  }

  function verifyPasswordResilient(rawInput: string, storedHash: string | null): boolean {
    const cleaned = cleanPasswordInput(rawInput);
    if (!cleaned || !storedHash) return false;

    const latinized = cleaned.replace(
      /[АаВЕеКкМмНОоРрСсТУуХх]/g,
      (ch) => cyrillicToLatinMap[ch] || ch
    );

    const baseCandidates = Array.from(new Set([cleaned, latinized]));
    const allCandidates = new Set<string>();

    for (const base of baseCandidates) {
      allCandidates.add(base);
      const swappedCase = base
        .split('')
        .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
        .join('');
      allCandidates.add(swappedCase);

      const lower = base.toLowerCase();
      const titleCased = lower.charAt(0).toUpperCase() + lower.slice(1);
      allCandidates.add(titleCased);
    }

    for (const candidate of Array.from(allCandidates)) {
      if (verifySecret(candidate, storedHash)) return true;
      if (candidate.length >= 8 && !candidate.endsWith('!') && verifySecret(`${candidate}!`, storedHash)) {
        return true;
      }
    }

    return false;
  }

  // ==========================================
  // 1. AUTHENTICATION & SECURE ACTIVATION API
  // ==========================================

  app.post('/api/auth/login', (req: Request, res: Response) => {
    try {
      const ip = getClientIp(req);
      if (isIpRateLimited(ip)) {
        res.status(429).json({
          error:
            'Juda ko‘p noto‘g‘ri kirish urinishlari aniqlandi. Xavfsizlik maqsadida birozdan so‘ng qayta urinib ko‘ring.',
        });
        return;
      }

      const serviceId = normalizeServiceId(req.body?.serviceId);
      const password = cleanPasswordInput(req.body?.password);

      if (!serviceId || !password) {
        res.status(400).json({ error: 'Xizmat ID raqami va parol kiritilishi shart.' });
        return;
      }

      const row = db
        .prepare(`SELECT * FROM users WHERE service_id = ?`)
        .get(serviceId) as DbUserRow | undefined;

      if (!row) {
        recordIpFailure(ip);
        res.status(401).json({ error: 'Xizmat ID raqami yoki parol noto‘g‘ri.' });
        return;
      }

      if (row.status === 'blocked') {
        res.status(403).json({
          error: 'Ushbu xodim hisobi bloklangan. Administratorga murojaat qiling.',
        });
        return;
      }

      if (row.status === 'pending_activation') {
        res.status(403).json({
          code: 'NEEDS_ACTIVATION',
          error:
            'Hisobingiz hali faollashtirilmagan. «Birinchi marta kirish» bo‘limi orqali faollashtirish kodi yordamida shaxsiy parol yarating.',
        });
        return;
      }

      if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
        const remainingMin = Math.max(
          1,
          Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000)
        );
        res.status(429).json({
          error: `Noto‘g‘ri parol urinishlari sababli hisob vaqtincha himoyalangan (${remainingMin} daqiqa qoldi).`,
        });
        return;
      }

      const validPassword = verifyPasswordResilient(password, row.password_hash);
      if (!validPassword) {
        recordIpFailure(ip);
        const attempts = row.failed_attempts + 1;
        let lockedUntil: string | null = null;
        if (attempts >= 10) {
          lockedUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          writeAuditLog({
            actorServiceId: row.service_id,
            actorName: row.full_name,
            actionType: 'XAVFSIZLIK_HIMOYASI',
            targetType: 'security',
            targetId: row.service_id,
            summary: `10 marta noto‘g‘ri parol terilgani sababli hisob 5 daqiqaga vaqtincha himoyalandi.`,
            details: { ip },
          });
        }

        db.prepare(
          `UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?`
        ).run(attempts, lockedUntil, new Date().toISOString(), row.id);

        res.status(401).json({
          error:
            attempts >= 10
              ? 'Ko‘p marta noto‘g‘ri urinish aniqlandi. Hisob 5 daqiqaga himoya rejimiga o‘tkazildi.'
              : 'Xizmat ID raqami yoki parol noto‘g‘ri.',
        });
        return;
      }

      clearIpFailures(ip);
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?`
      ).run(now, now, row.id);

      const updatedRow = db
        .prepare(`SELECT * FROM users WHERE id = ?`)
        .get(row.id) as unknown as DbUserRow;
      const userProfile = mapUserRowToProfile(updatedRow);
      const token = signSessionToken(userProfile.id, userProfile.serviceId, userProfile.role);

      res.json({ token, user: userProfile });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Tizimga kirishda xatolik yuz berdi.' });
    }
  });

  app.post('/api/auth/activate', (req: Request, res: Response) => {
    try {
      const ip = getClientIp(req);
      if (isIpRateLimited(ip)) {
        res.status(429).json({
          error: 'Juda ko‘p noto‘g‘ri urinishlar. Birozdan so‘ng qayta urinib ko‘ring.',
        });
        return;
      }

      const serviceId = normalizeServiceId(req.body?.serviceId);
      const activationCode = normalizeServiceId(req.body?.activationCode);
      const newPassword = cleanPasswordInput(req.body?.newPassword);

      if (!serviceId || !activationCode || !newPassword) {
        res.status(400).json({
          error:
            'Xizmat ID raqami, maxfiy faollashtirish kodi va yangi shaxsiy parol to‘liq kiritilishi shart.',
        });
        return;
      }

      if (newPassword.length < 8) {
        res.status(400).json({
          error: 'Shaxsiy parol kamida 8 ta belgidan iborat bo‘lishi kerak.',
        });
        return;
      }

      const row = db
        .prepare(`SELECT * FROM users WHERE service_id = ?`)
        .get(serviceId) as DbUserRow | undefined;

      // Never reveal whether only the Service ID exists without valid activation code
      if (!row || row.status !== 'pending_activation' || !row.activation_code_hash) {
        recordIpFailure(ip);
        res.status(401).json({
          error:
            'Xizmat ID raqami yoki faollashtirish kodi tasdiqlanmadi, yoxud hisob allaqachon faollashtirilgan.',
        });
        return;
      }

      if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
        res.status(429).json({
          error: 'Ko‘p marta xato kod kiritilgani uchun faollashtirish vaqtincha cheklangan.',
        });
        return;
      }

      const validCode = verifySecret(activationCode, row.activation_code_hash);
      if (!validCode) {
        recordIpFailure(ip);
        const attempts = row.failed_attempts + 1;
        const lockedUntil =
          attempts >= 10 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;
        db.prepare(
          `UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?`
        ).run(attempts, lockedUntil, new Date().toISOString(), row.id);

        res.status(401).json({
          error: 'Xizmat ID raqami yoki faollashtirish kodi tasdiqlanmadi.',
        });
        return;
      }

      clearIpFailures(ip);
      const now = new Date().toISOString();
      const passwordHash = hashSecret(newPassword);

      db.prepare(
        `UPDATE users
         SET status = 'active',
             password_hash = ?,
             activation_code_hash = NULL,
             failed_attempts = 0,
             locked_until = NULL,
             last_login_at = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(passwordHash, now, now, row.id);

      writeAuditLog({
        actorServiceId: row.service_id,
        actorName: row.full_name,
        actionType: 'HISOB_FAOLLASHTIRILDI',
        targetType: 'user',
        targetId: row.service_id,
        summary: `Xodim (${row.service_id}) bir martalik xavfsiz kod orqali o‘z hisobini faollashtirdi va shaxsiy parol o‘rnatdi.`,
      });

      const updatedRow = db
        .prepare(`SELECT * FROM users WHERE id = ?`)
        .get(row.id) as unknown as DbUserRow;
      const userProfile = mapUserRowToProfile(updatedRow);
      const token = signSessionToken(userProfile.id, userProfile.serviceId, userProfile.role);

      res.json({ token, user: userProfile });
    } catch (error) {
      console.error('Activation error:', error);
      res.status(500).json({ error: 'Hisobni faollashtirishda xatolik yuz berdi.' });
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.currentUser });
  });

  // ==========================================
  // 2. HOUSES, SEARCH & FIELD INSPECTION API
  // ==========================================

  app.get('/api/houses', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.currentUser!;
      const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const regionFilter = typeof req.query.region === 'string' ? req.query.region.trim() : '';
      const districtFilter =
        typeof req.query.district === 'string' ? req.query.district.trim() : '';
      const q = typeof req.query.q === 'string' ? normalizeText(req.query.q).toLowerCase() : '';

      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (user.role !== 'admin' && user.permissions.assignedRegion !== 'ALL') {
        conditions.push(`region = ?`);
        params.push(user.permissions.assignedRegion);
      } else if (regionFilter && regionFilter !== 'ALL') {
        conditions.push(`region = ?`);
        params.push(regionFilter);
      }

      if (districtFilter && districtFilter !== 'ALL') {
        conditions.push(`district = ?`);
        params.push(districtFilter);
      }

      if (
        statusFilter === 'has_cadastre' ||
        statusFilter === 'no_cadastre' ||
        statusFilter === 'unknown'
      ) {
        conditions.push(`cadastral_status = ?`);
        params.push(statusFilter);
      }

      if (q) {
        conditions.push(
          `(LOWER(region) LIKE ? OR LOWER(district) LIKE ? OR LOWER(COALESCE(mahalla, '')) LIKE ? OR LOWER(street_address) LIKE ? OR LOWER(house_uid) LIKE ? OR LOWER(COALESCE(cadastre_number, '')) LIKE ?)`
        );
        const likePattern = `%${q}%`;
        params.push(likePattern, likePattern, likePattern, likePattern, likePattern, likePattern);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = db
        .prepare(`SELECT * FROM houses ${whereClause} ORDER BY id DESC`)
        .all(...params) as unknown as DbHouseRow[];

      const houses = rows.map((r) => mapHouseRowForUser(r, user));
      res.json({ houses });
    } catch (error) {
      console.error('Fetch houses error:', error);
      res.status(500).json({ error: 'Uylar ro‘yxatini yuklashda xatolik yuz berdi.' });
    }
  });

  app.post('/api/houses/resolve-building', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.currentUser!;
      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < UZBEKISTAN_BOUNDS.minLat ||
        lat > UZBEKISTAN_BOUNDS.maxLat ||
        lng < UZBEKISTAN_BOUNDS.minLng ||
        lng > UZBEKISTAN_BOUNDS.maxLng
      ) {
        res.status(400).json({ error: 'Koordinatalar O‘zbekiston hududidan tashqarida.' });
        return;
      }

      const rawOsmId = req.body?.osmId ? String(req.body.osmId).replace(/[^0-9A-Za-z_-]/g, '') : '';
      const osmUid = rawOsmId ? `UY-OSM-${rawOsmId}` : '';

      if (osmUid) {
        const byUid = db
          .prepare(`SELECT * FROM houses WHERE house_uid = ?`)
          .get(osmUid) as DbHouseRow | undefined;
        if (byUid) {
          res.json({ house: mapHouseRowForUser(byUid, user), created: false });
          return;
        }
      }

      const requestedStreet = req.body?.streetAddress
        ? normalizeText(String(req.body.streetAddress))
        : '';
      const extractNum = (addr: string) => {
        const m = addr.match(/(?:^|[\s,#№-]+)(\d+[A-Za-zА-Яа-я]?)(?:\s*-?\s*uy\b)?(?:\s*$|,)/i);
        return m ? m[1].toLowerCase() : null;
      };
      const reqHouseNum = extractNum(requestedStreet);

      const nearbyCandidates = db
        .prepare(
          `SELECT * FROM houses WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`
        )
        .all(lat - 0.00025, lat + 0.00025, lng - 0.0003, lng + 0.0003) as unknown as DbHouseRow[];

      let closestMatch: { row: DbHouseRow; dist: number } | null = null;
      for (const cand of nearbyCandidates) {
        const dist = haversineMeters(lat, lng, cand.lat, cand.lng);
        const candHouseNum = extractNum(cand.street_address);
        // Never conflate two neighboring houses that explicitly have different house numbers (e.g. 14-uy vs 16-uy)
        if (reqHouseNum && candHouseNum && reqHouseNum !== candHouseNum) {
          continue;
        }
        const maxDist = reqHouseNum && candHouseNum && reqHouseNum === candHouseNum ? 18 : 7;
        if (dist <= maxDist && (!closestMatch || dist < closestMatch.dist)) {
          closestMatch = { row: cand, dist };
        }
      }

      if (closestMatch) {
        res.json({ house: mapHouseRowForUser(closestMatch.row, user), created: false });
        return;
      }

      const nearest = findNearestAdminArea(lat, lng);
      const canonicalRegion =
        (req.body?.region && findCanonicalRegionName(String(req.body.region))) || nearest.region;
      const district = req.body?.district
        ? normalizeText(String(req.body.district))
        : nearest.district;

      if (
        user.role !== 'admin' &&
        user.permissions.assignedRegion !== 'ALL' &&
        canonicalRegion !== user.permissions.assignedRegion
      ) {
        res.status(403).json({
          error: 'Siz faqat o‘zingizga biriktirilgan viloyatdagi uylar ma’lumotini ko‘ra olasiz.',
        });
        return;
      }

      const mahalla = req.body?.mahalla ? normalizeText(String(req.body.mahalla)) : null;
      const streetAddress = req.body?.streetAddress
        ? normalizeText(String(req.body.streetAddress))
        : `${district}, turar joy (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

      const statusInput = req.body?.cadastralStatus as CadastralStatus;
      const cadastralStatus: CadastralStatus = ['has_cadastre', 'no_cadastre', 'unknown'].includes(
        statusInput
      )
        ? statusInput
        : 'unknown';

      const cadastreNumber =
        cadastralStatus === 'has_cadastre' && req.body?.cadastreNumber
          ? normalizeText(String(req.body.cadastreNumber))
          : null;

      const verificationBasis =
        cadastralStatus === 'has_cadastre'
          ? req.body?.verificationBasis
            ? normalizeText(String(req.body.verificationBasis))
            : 'Davlat kadastrlar palatasi reestri ma’lumoti'
          : cadastralStatus === 'no_cadastre'
            ? req.body?.verificationBasis
              ? normalizeText(String(req.body.verificationBasis))
              : 'Joyiga chiqib o‘rganish tekshiruv dalolatnomasi'
            : null;

      const uid = osmUid || generateNextHouseUid(canonicalRegion);
      const baseNormKey = buildNormalizedAddressKey(canonicalRegion, district, streetAddress);
      const uniqueNormKey = `${baseNormKey}|${lat.toFixed(5)},${lng.toFixed(5)}`;
      const now = new Date().toISOString();

      const inspectionNote =
        cadastralStatus === 'has_cadastre'
          ? 'Xarita binolar qatlamida kadastr raqami tasdiqlangan turar joy.'
          : cadastralStatus === 'no_cadastre'
            ? 'Xarita monitoringida kadastr hujjati mavjud emasligi qayd etilgan.'
            : 'Kadastr holati bo‘yicha tekshiruv kutilmoqda.';

      const result = db
        .prepare(
          `INSERT INTO houses (
            house_uid, cadastre_number, region, district, mahalla, street_address,
            normalized_address_key, lat, lng, cadastral_status, verification_basis,
            residents_count, contact_info, inspection_note, last_inspection_date,
            created_by_service_id, updated_by_service_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          uid,
          cadastreNumber,
          canonicalRegion,
          district,
          mahalla,
          streetAddress,
          uniqueNormKey,
          Number(lat.toFixed(6)),
          Number(lng.toFixed(6)),
          cadastralStatus,
          verificationBasis,
          cadastralStatus === 'unknown' ? null : 4,
          null,
          inspectionNote,
          cadastralStatus === 'unknown' ? null : now.slice(0, 10),
          user.serviceId,
          user.serviceId,
          now,
          now
        );

      const createdRow = db
        .prepare(`SELECT * FROM houses WHERE id = ?`)
        .get(Number(result.lastInsertRowid)) as unknown as DbHouseRow;

      res.json({ house: mapHouseRowForUser(createdRow, user), created: true });
    } catch (error) {
      console.error('Resolve building error:', error);
      res.status(500).json({ error: 'Bino ma’lumotini aniqlashda xatolik yuz berdi.' });
    }
  });

  app.get('/api/houses/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.currentUser!;
      const houseId = Number(req.params.id);
      if (!Number.isInteger(houseId)) {
        res.status(400).json({ error: 'Noto‘g‘ri uy identifikatori.' });
        return;
      }

      const row = db
        .prepare(`SELECT * FROM houses WHERE id = ?`)
        .get(houseId) as DbHouseRow | undefined;

      if (!row) {
        res.status(404).json({ error: 'Uy ma’lumoti topilmadi.' });
        return;
      }

      if (
        user.role !== 'admin' &&
        user.permissions.assignedRegion !== 'ALL' &&
        row.region !== user.permissions.assignedRegion
      ) {
        res.status(403).json({ error: 'Ushbu hudud ma’lumotlarini ko‘rishga ruxsat berilmagan.' });
        return;
      }

      const house = mapHouseRowForUser(row, user);
      const historyRows = db
        .prepare(
          `SELECT id, actor_service_id, actor_name, action_type, summary, created_at
           FROM audit_logs
           WHERE target_type = 'house' AND target_id = ?
           ORDER BY id DESC
           LIMIT 10`
        )
        .all(row.house_uid) as Array<{
        id: number;
        actor_service_id: string;
        actor_name: string;
        action_type: string;
        summary: string;
        created_at: string;
      }>;

      res.json({
        house,
        history: historyRows.map((h) => ({
          id: h.id,
          actorServiceId: h.actor_service_id,
          actorName: h.actor_name,
          actionType: h.action_type,
          summary: h.summary,
          createdAt: h.created_at,
        })),
      });
    } catch (error) {
      console.error('Fetch single house error:', error);
      res.status(500).json({ error: 'Uy ma’lumotini olishda xatolik yuz berdi.' });
    }
  });

  app.post('/api/houses/:id/inspect', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.currentUser!;
      if (user.role !== 'admin' && !user.permissions.canInspect) {
        res.status(403).json({
          error: 'Sizga tekshiruv natijalarini kiritish huquqi berilmagan.',
        });
        return;
      }

      const houseId = Number(req.params.id);
      const existing = db
        .prepare(`SELECT * FROM houses WHERE id = ?`)
        .get(houseId) as DbHouseRow | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Uy yozuvi topilmadi.' });
        return;
      }

      if (
        user.role !== 'admin' &&
        user.permissions.assignedRegion !== 'ALL' &&
        existing.region !== user.permissions.assignedRegion
      ) {
        res.status(403).json({
          error: 'Siz faqat o‘zingizga biriktirilgan hududdagi uylar bo‘yicha tekshiruv kirita olasiz.',
        });
        return;
      }

      const cadastralStatus = req.body?.cadastralStatus as CadastralStatus;
      if (!['has_cadastre', 'no_cadastre', 'unknown'].includes(cadastralStatus)) {
        res.status(400).json({ error: 'Kadastr holati noto‘g‘ri tanlangan.' });
        return;
      }

      const verificationBasis = req.body?.verificationBasis
        ? normalizeText(String(req.body.verificationBasis))
        : null;
      const cadastreNumber = req.body?.cadastreNumber
        ? normalizeText(String(req.body.cadastreNumber))
        : existing.cadastre_number;
      const inspectionNote = req.body?.inspectionNote
        ? normalizeText(String(req.body.inspectionNote))
        : null;
      const lastInspectionDate = req.body?.lastInspectionDate
        ? String(req.body.lastInspectionDate).slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      // TZ Rule: Status can only be set to has_cadastre or no_cadastre based on reliable info / official inspection
      if (
        (cadastralStatus === 'has_cadastre' || cadastralStatus === 'no_cadastre') &&
        (!verificationBasis || verificationBasis.length < 5)
      ) {
        res.status(400).json({
          error:
            'Kadastr holatini tasdiqlash uchun ishonchli manba yoki tekshiruv dalolatnomasi raqamini ko‘rsatish shart.',
        });
        return;
      }

      const updatedStreetAddress =
        req.body?.streetAddress && String(req.body.streetAddress).trim().length >= 2
          ? normalizeText(String(req.body.streetAddress))
          : existing.street_address;
      const updatedMahalla =
        req.body?.mahalla !== undefined
          ? String(req.body.mahalla).trim()
            ? normalizeText(String(req.body.mahalla))
            : null
          : existing.mahalla;

      const baseNormKey = buildNormalizedAddressKey(
        existing.region,
        existing.district,
        updatedStreetAddress
      );
      const updatedNormKey = `${baseNormKey}|${existing.lat.toFixed(5)},${existing.lng.toFixed(5)}`;

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE houses
         SET mahalla = ?,
             street_address = ?,
             normalized_address_key = ?,
             cadastral_status = ?,
             verification_basis = ?,
             cadastre_number = ?,
             inspection_note = ?,
             last_inspection_date = ?,
             updated_by_service_id = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        updatedMahalla,
        updatedStreetAddress,
        updatedNormKey,
        cadastralStatus,
        cadastralStatus === 'unknown' ? verificationBasis : verificationBasis,
        cadastralStatus === 'no_cadastre' ? null : cadastreNumber,
        inspectionNote,
        lastInspectionDate,
        user.serviceId,
        now,
        houseId
      );

      writeAuditLog({
        actorServiceId: user.serviceId,
        actorName: user.fullName,
        actionType: 'TEKSHIRUV_NATIJASI',
        targetType: 'house',
        targetId: existing.house_uid,
        summary: `${existing.house_uid} (${existing.region}, ${existing.district}, ${updatedStreetAddress}) bo‘yicha tekshiruv natijasi kiritildi: ${existing.cadastral_status} → ${cadastralStatus}.`,
        details: {
          previousStatus: existing.cadastral_status,
          newStatus: cadastralStatus,
          verificationBasis,
          lastInspectionDate,
        },
      });

      const updated = db
        .prepare(`SELECT * FROM houses WHERE id = ?`)
        .get(houseId) as unknown as DbHouseRow;
      res.json({ house: mapHouseRowForUser(updated, user) });
    } catch (error) {
      console.error('Inspect house error:', error);
      res.status(500).json({ error: 'Tekshiruv natijasini saqlashda xatolik yuz berdi.' });
    }
  });

  // ==========================================
  // 3. ADMINISTRATOR PANEL API
  // ==========================================

  app.get('/api/admin/users', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    try {
      const rows = db.prepare(`SELECT * FROM users ORDER BY id ASC`).all() as unknown as DbUserRow[];
      res.json({ users: rows.map(mapUserRowToProfile) });
    } catch (error) {
      console.error('List users error:', error);
      res.status(500).json({ error: 'Xodimlar ro‘yxatini olishda xatolik yuz berdi.' });
    }
  });

  app.post('/api/admin/users', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const admin = req.currentUser!;
      const serviceId = String(req.body?.serviceId || '')
        .trim()
        .toUpperCase();
      const fullName = normalizeText(String(req.body?.fullName || ''));
      const department = normalizeText(String(req.body?.department || ''));
      const badgeDoc = normalizeText(String(req.body?.badgeDoc || ''));
      const role: UserRole = req.body?.role === 'admin' ? 'admin' : 'officer';
      const perms = req.body?.permissions || {};

      if (!serviceId || !/^[A-Z0-9-]{4,24}$/.test(serviceId)) {
        res.status(400).json({
          error: 'Xizmat ID raqami 4–24 ta lotin harfi, raqam yoki chiziqchadan iborat bo‘lishi kerak (masalan: IIV-305).',
        });
        return;
      }
      if (!fullName || fullName.length < 5) {
        res.status(400).json({ error: 'Xodimning F.I.Sh. to‘liq kiritilishi shart.' });
        return;
      }
      if (!department) {
        res.status(400).json({ error: 'Bo‘lim yoki lavozim kiritilishi shart.' });
        return;
      }
      if (!badgeDoc) {
        res.status(400).json({
          error: 'Vakolatli tasdiqlovchi hujjat (guvohnoma raqami) ko‘rsatilishi shart.',
        });
        return;
      }

      const existing = db.prepare(`SELECT id FROM users WHERE service_id = ?`).get(serviceId);
      if (existing) {
        res.status(409).json({
          error: `${serviceId} xizmat ID raqamiga ega xodim tizimda allaqachon mavjud.`,
        });
        return;
      }

      const activationCode = generateOneTimeActivationCode();
      const activationHash = hashSecret(activationCode);
      const now = new Date().toISOString();

      const info = db
        .prepare(
          `INSERT INTO users (
            service_id, full_name, department, badge_doc, role, status,
            password_hash, activation_code_hash,
            can_view_residents, can_view_contact, can_inspect, assigned_region,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending_activation', NULL, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          serviceId,
          fullName,
          department,
          badgeDoc,
          role,
          activationHash,
          role === 'admin' || perms.canViewResidents ? 1 : 0,
          role === 'admin' || perms.canViewContact ? 1 : 0,
          role === 'admin' || perms.canInspect !== false ? 1 : 0,
          role === 'admin' ? 'ALL' : String(perms.assignedRegion || 'ALL'),
          now,
          now
        );

      writeAuditLog({
        actorServiceId: admin.serviceId,
        actorName: admin.fullName,
        actionType: 'XODIM_QOSHILDI',
        targetType: 'user',
        targetId: serviceId,
        summary: `Yangi xodim tizimga kiritildi: ${fullName} (${serviceId}, rol: ${role === 'admin' ? 'Administrator' : 'Xodim'}).`,
        details: { badgeDoc, department, role },
      });

      const createdRow = db
        .prepare(`SELECT * FROM users WHERE id = ?`)
        .get(Number(info.lastInsertRowid)) as unknown as DbUserRow;

      res.status(201).json({
        user: mapUserRowToProfile(createdRow),
        activationCode,
      });
    } catch (error) {
      console.error('Create user error:', error);
      res.status(500).json({ error: 'Xodimni qo‘shishda xatolik yuz berdi.' });
    }
  });

  app.put('/api/admin/users/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const admin = req.currentUser!;
      const targetId = Number(req.params.id);
      const existing = db
        .prepare(`SELECT * FROM users WHERE id = ?`)
        .get(targetId) as DbUserRow | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Xodim topilmadi.' });
        return;
      }

      if (existing.id === admin.id && (req.body?.status === 'blocked' || req.body?.role === 'officer')) {
        res.status(400).json({
          error: 'Joriy administrator o‘z hisobini bloklashi yoki administratorlikdan chiqarishi mumkin emas.',
        });
        return;
      }

      const fullName = req.body?.fullName ? normalizeText(String(req.body.fullName)) : existing.full_name;
      const department = req.body?.department
        ? normalizeText(String(req.body.department))
        : existing.department;
      const role: UserRole =
        req.body?.role === 'admin' || req.body?.role === 'officer' ? req.body.role : existing.role;
      const perms = req.body?.permissions;

      const canViewResidents =
        role === 'admin'
          ? 1
          : perms?.canViewResidents !== undefined
            ? perms.canViewResidents
              ? 1
              : 0
            : existing.can_view_residents;
      const canViewContact =
        role === 'admin'
          ? 1
          : perms?.canViewContact !== undefined
            ? perms.canViewContact
              ? 1
              : 0
            : existing.can_view_contact;
      const canInspect =
        role === 'admin'
          ? 1
          : perms?.canInspect !== undefined
            ? perms.canInspect
              ? 1
              : 0
            : existing.can_inspect;
      const assignedRegion =
        role === 'admin'
          ? 'ALL'
          : perms?.assignedRegion !== undefined
            ? String(perms.assignedRegion)
            : existing.assigned_region;

      let nextStatus = existing.status;
      if (req.body?.status === 'blocked') {
        nextStatus = 'blocked';
      } else if (req.body?.status === 'active') {
        nextStatus = existing.password_hash ? 'active' : 'pending_activation';
      }

      let generatedActivationCode: string | null = null;
      let nextActivationHash = existing.activation_code_hash;
      let nextPasswordHash = existing.password_hash;

      if (req.body?.regenerateActivation === true) {
        generatedActivationCode = generateOneTimeActivationCode();
        nextActivationHash = hashSecret(generatedActivationCode);
        nextPasswordHash = null;
        nextStatus = 'pending_activation';
      }

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE users
         SET full_name = ?,
             department = ?,
             role = ?,
             status = ?,
             password_hash = ?,
             activation_code_hash = ?,
             can_view_residents = ?,
             can_view_contact = ?,
             can_inspect = ?,
             assigned_region = ?,
             failed_attempts = 0,
             locked_until = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(
        fullName,
        department,
        role,
        nextStatus,
        nextPasswordHash,
        nextActivationHash,
        canViewResidents,
        canViewContact,
        canInspect,
        assignedRegion,
        now,
        targetId
      );

      writeAuditLog({
        actorServiceId: admin.serviceId,
        actorName: admin.fullName,
        actionType: generatedActivationCode
          ? 'FAOLLASHTIRISH_KODI_YANGILANDI'
          : nextStatus !== existing.status
            ? nextStatus === 'blocked'
              ? 'XODIM_BLOKLANDI'
              : 'XODIM_FAOLLASHTIRILDI'
            : 'XODIM_HUQUQI_YANGILANDI',
        targetType: 'user',
        targetId: existing.service_id,
        summary: `${existing.service_id} (${fullName}) hisobi yangilandi (holat: ${nextStatus}).`,
        details: {
          previousStatus: existing.status,
          newStatus: nextStatus,
          role,
          assignedRegion,
          canViewResidents: Boolean(canViewResidents),
          canViewContact: Boolean(canViewContact),
          canInspect: Boolean(canInspect),
        },
      });

      const updatedRow = db
        .prepare(`SELECT * FROM users WHERE id = ?`)
        .get(targetId) as unknown as DbUserRow;
      res.json({
        user: mapUserRowToProfile(updatedRow),
        activationCode: generatedActivationCode,
      });
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ error: 'Xodim ma’lumotlarini yangilashda xatolik yuz berdi.' });
    }
  });

  app.post('/api/admin/houses', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const admin = req.currentUser!;
      const region = normalizeText(String(req.body?.region || ''));
      const district = normalizeText(String(req.body?.district || ''));
      const mahalla = req.body?.mahalla ? normalizeText(String(req.body.mahalla)) : null;
      const streetAddress = normalizeText(String(req.body?.streetAddress || ''));
      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      const rawStatus = req.body?.cadastralStatus as CadastralStatus | undefined;
      const cadastralStatus: CadastralStatus =
        rawStatus === 'has_cadastre' || rawStatus === 'no_cadastre' ? rawStatus : 'unknown';
      const cadastreNumber = req.body?.cadastreNumber
        ? normalizeText(String(req.body.cadastreNumber))
        : null;
      const verificationBasis = req.body?.verificationBasis
        ? normalizeText(String(req.body.verificationBasis))
        : null;
      const residentsCount =
        req.body?.residentsCount !== null &&
        req.body?.residentsCount !== undefined &&
        String(req.body.residentsCount).trim() !== ''
          ? Number(req.body.residentsCount)
          : null;
      const contactInfo = req.body?.contactInfo
        ? normalizeText(String(req.body.contactInfo))
        : null;
      const inspectionNote = req.body?.inspectionNote
        ? normalizeText(String(req.body.inspectionNote))
        : null;
      const lastInspectionDate = req.body?.lastInspectionDate
        ? String(req.body.lastInspectionDate).slice(0, 10)
        : null;

      if (!region || !district || !streetAddress) {
        res.status(400).json({ error: 'Viloyat, tuman va ko‘cha/uy raqami kiritilishi shart.' });
        return;
      }

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < UZBEKISTAN_BOUNDS.minLat ||
        lat > UZBEKISTAN_BOUNDS.maxLat ||
        lng < UZBEKISTAN_BOUNDS.minLng ||
        lng > UZBEKISTAN_BOUNDS.maxLng
      ) {
        res.status(400).json({
          error: `Koordinatalar O‘zbekiston hududiga mos bo‘lishi kerak (kenglik: ${UZBEKISTAN_BOUNDS.minLat}–${UZBEKISTAN_BOUNDS.maxLat}, uzunlik: ${UZBEKISTAN_BOUNDS.minLng}–${UZBEKISTAN_BOUNDS.maxLng}).`,
        });
        return;
      }

      if (
        (cadastralStatus === 'has_cadastre' || cadastralStatus === 'no_cadastre') &&
        (!verificationBasis || verificationBasis.length < 4)
      ) {
        res.status(400).json({
          error:
            'Kadastr mavjud yoki mavjud emasligini belgilash uchun ishonchli ma’lumot manbasi (tasdiqlash asosi) ko‘rsatilishi shart. Aks holda «Holati noma’lum» tanlanishi lozim.',
        });
        return;
      }

      const normKey = buildNormalizedAddressKey(region, district, streetAddress);
      const duplicateByAddress = db
        .prepare(`SELECT house_uid, street_address FROM houses WHERE normalized_address_key = ?`)
        .get(normKey) as { house_uid: string; street_address: string } | undefined;

      if (duplicateByAddress) {
        res.status(409).json({
          error: `Takroriy yozuv: ushbu manzil tizimda allaqachon mavjud (${duplicateByAddress.house_uid}).`,
        });
        return;
      }

      const districtHouses = db
        .prepare(`SELECT house_uid, lat, lng, street_address FROM houses WHERE region = ? AND district = ?`)
        .all(region, district) as Array<{
        house_uid: string;
        lat: number;
        lng: number;
        street_address: string;
      }>;

      for (const dh of districtHouses) {
        if (haversineMeters(lat, lng, dh.lat, dh.lng) < 6) {
          res.status(409).json({
            error: `Takroriy nuqta: kiritilgan koordinata mavjud uyga (${dh.house_uid} — ${dh.street_address}) juda yaqin (< 6 metr).`,
          });
          return;
        }
      }

      const houseUid = generateNextHouseUid(region);
      const now = new Date().toISOString();

      const info = db
        .prepare(
          `INSERT INTO houses (
            house_uid, cadastre_number, region, district, mahalla, street_address,
            normalized_address_key, lat, lng, cadastral_status, verification_basis,
            residents_count, contact_info, inspection_note, last_inspection_date,
            created_by_service_id, updated_by_service_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          houseUid,
          cadastralStatus === 'no_cadastre' ? null : cadastreNumber,
          region,
          district,
          mahalla,
          streetAddress,
          normKey,
          lat,
          lng,
          cadastralStatus,
          verificationBasis,
          residentsCount !== null && Number.isFinite(residentsCount) ? Math.max(0, Math.round(residentsCount)) : null,
          contactInfo,
          inspectionNote,
          lastInspectionDate,
          admin.serviceId,
          admin.serviceId,
          now,
          now
        );

      writeAuditLog({
        actorServiceId: admin.serviceId,
        actorName: admin.fullName,
        actionType: 'UY_QOSHILDI',
        targetType: 'house',
        targetId: houseUid,
        summary: `Yangi uy kiritildi: ${houseUid} (${region}, ${district}, ${streetAddress}).`,
        details: { cadastralStatus, lat, lng },
      });

      const created = db
        .prepare(`SELECT * FROM houses WHERE id = ?`)
        .get(Number(info.lastInsertRowid)) as unknown as DbHouseRow;

      res.status(201).json({ house: mapHouseRowForUser(created, admin) });
    } catch (error) {
      console.error('Create house error:', error);
      res.status(500).json({ error: 'Yangi uyni bazaga saqlashda xatolik yuz berdi.' });
    }
  });

  app.put('/api/admin/houses/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const admin = req.currentUser!;
      const houseId = Number(req.params.id);
      const existing = db
        .prepare(`SELECT * FROM houses WHERE id = ?`)
        .get(houseId) as DbHouseRow | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Uy yozuvi topilmadi.' });
        return;
      }

      const region = normalizeText(String(req.body?.region || existing.region));
      const district = normalizeText(String(req.body?.district || existing.district));
      const mahalla =
        req.body?.mahalla !== undefined
          ? req.body.mahalla
            ? normalizeText(String(req.body.mahalla))
            : null
          : existing.mahalla;
      const streetAddress = normalizeText(String(req.body?.streetAddress || existing.street_address));
      const lat = req.body?.lat !== undefined ? Number(req.body.lat) : existing.lat;
      const lng = req.body?.lng !== undefined ? Number(req.body.lng) : existing.lng;
      const cadastralStatus: CadastralStatus =
        req.body?.cadastralStatus === 'has_cadastre' ||
        req.body?.cadastralStatus === 'no_cadastre' ||
        req.body?.cadastralStatus === 'unknown'
          ? req.body.cadastralStatus
          : existing.cadastral_status;

      const verificationBasis =
        req.body?.verificationBasis !== undefined
          ? req.body.verificationBasis
            ? normalizeText(String(req.body.verificationBasis))
            : null
          : existing.verification_basis;

      if (
        (cadastralStatus === 'has_cadastre' || cadastralStatus === 'no_cadastre') &&
        (!verificationBasis || verificationBasis.length < 4)
      ) {
        res.status(400).json({
          error: 'Kadastr holatini tasdiqlash uchun ishonchli ma’lumot asosi ko‘rsatilishi zarur.',
        });
        return;
      }

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < UZBEKISTAN_BOUNDS.minLat ||
        lat > UZBEKISTAN_BOUNDS.maxLat ||
        lng < UZBEKISTAN_BOUNDS.minLng ||
        lng > UZBEKISTAN_BOUNDS.maxLng
      ) {
        res.status(400).json({
          error: 'Koordinatalar O‘zbekiston hududi chegarasida bo‘lishi shart.',
        });
        return;
      }

      const normKey = buildNormalizedAddressKey(region, district, streetAddress);
      const duplicate = db
        .prepare(`SELECT house_uid FROM houses WHERE normalized_address_key = ? AND id != ?`)
        .get(normKey, houseId) as { house_uid: string } | undefined;

      if (duplicate) {
        res.status(409).json({
          error: `Ushbu manzil boshqa uy yozuvida (${duplicate.house_uid}) allaqachon mavjud.`,
        });
        return;
      }

      const cadastreNumber =
        cadastralStatus === 'no_cadastre'
          ? null
          : req.body?.cadastreNumber !== undefined
            ? req.body.cadastreNumber
              ? normalizeText(String(req.body.cadastreNumber))
              : null
            : existing.cadastre_number;

      const residentsCount =
        req.body?.residentsCount !== undefined
          ? req.body.residentsCount === null || String(req.body.residentsCount).trim() === ''
            ? null
            : Math.max(0, Math.round(Number(req.body.residentsCount)))
          : existing.residents_count;

      const contactInfo =
        req.body?.contactInfo !== undefined
          ? req.body.contactInfo
            ? normalizeText(String(req.body.contactInfo))
            : null
          : existing.contact_info;

      const inspectionNote =
        req.body?.inspectionNote !== undefined
          ? req.body.inspectionNote
            ? normalizeText(String(req.body.inspectionNote))
            : null
          : existing.inspection_note;

      const lastInspectionDate =
        req.body?.lastInspectionDate !== undefined
          ? req.body.lastInspectionDate
            ? String(req.body.lastInspectionDate).slice(0, 10)
            : null
          : existing.last_inspection_date;

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE houses
         SET cadastre_number = ?,
             region = ?,
             district = ?,
             mahalla = ?,
             street_address = ?,
             normalized_address_key = ?,
             lat = ?,
             lng = ?,
             cadastral_status = ?,
             verification_basis = ?,
             residents_count = ?,
             contact_info = ?,
             inspection_note = ?,
             last_inspection_date = ?,
             updated_by_service_id = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(
        cadastreNumber,
        region,
        district,
        mahalla,
        streetAddress,
        normKey,
        lat,
        lng,
        cadastralStatus,
        verificationBasis,
        residentsCount,
        contactInfo,
        inspectionNote,
        lastInspectionDate,
        admin.serviceId,
        now,
        houseId
      );

      writeAuditLog({
        actorServiceId: admin.serviceId,
        actorName: admin.fullName,
        actionType: 'UY_TAHRIRLANDI',
        targetType: 'house',
        targetId: existing.house_uid,
        summary: `${existing.house_uid} ma’lumotlari tahrirlandi (${region}, ${district}, ${streetAddress}).`,
        details: {
          before: {
            streetAddress: existing.street_address,
            cadastralStatus: existing.cadastral_status,
            lat: existing.lat,
            lng: existing.lng,
          },
          after: {
            streetAddress,
            cadastralStatus,
            lat,
            lng,
          },
        },
      });

      const updated = db
        .prepare(`SELECT * FROM houses WHERE id = ?`)
        .get(houseId) as unknown as DbHouseRow;
      res.json({ house: mapHouseRowForUser(updated, admin) });
    } catch (error) {
      console.error('Update house error:', error);
      res.status(500).json({ error: 'Uy ma’lumotlarini yangilashda xatolik yuz berdi.' });
    }
  });

  // ==========================================
  // 4. EXCEL / CSV VALIDATION & IMPORT API
  // ==========================================

  app.post(
    '/api/admin/import/validate',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const fileBase64 = String(req.body?.fileBase64 || '');
        if (!fileBase64) {
          res.status(400).json({ error: 'Fayl ma’lumotlari yuborilmadi.' });
          return;
        }

        const buffer = Buffer.from(fileBase64, 'base64');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          res.status(400).json({ error: 'Yuklangan faylda jadval sahifasi topilmadi.' });
          return;
        }

        const sheet = workbook.Sheets[firstSheetName];
        const rawJsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: '',
        });

        if (rawJsonRows.length === 0) {
          res.status(400).json({ error: 'Yuklangan fayl bo‘sh yoki yozuvlar mavjud emas.' });
          return;
        }

        if (rawJsonRows.length > 5000) {
          res.status(400).json({
            error: 'Bir martada ko‘pi bilan 5 000 ta qatorni tekshirish va yuklash mumkin.',
          });
          return;
        }

        const existingKeys = new Set<string>(
          (
            db.prepare(`SELECT normalized_address_key FROM houses`).all() as Array<{
              normalized_address_key: string;
            }>
          ).map((r) => r.normalized_address_key)
        );

        const seenInFile = new Set<string>();
        const validatedRows: ValidatedImportRow[] = [];

        const pickField = (obj: Record<string, unknown>, candidates: string[]): unknown => {
          const entries = Object.entries(obj);
          for (const cand of candidates) {
            const cNorm = cand.toLowerCase();
            const match = entries.find(
              ([k]) => normalizeText(k).toLowerCase() === cNorm
            );
            if (match && String(match[1]).trim() !== '') {
              return match[1];
            }
          }
          return '';
        };

        rawJsonRows.forEach((rawObj, index) => {
          const rowNumber = index + 2; // Header is row 1
          const errors: string[] = [];

          const rawRegion = String(
            pickField(rawObj, ['Viloyat', 'Hudud', 'Region', 'viloyat'])
          ).trim();
          const rawDistrict = String(
            pickField(rawObj, ['Tuman', 'Tuman/Shahar', 'Shahar', 'District', 'tuman'])
          ).trim();
          const rawMahalla = String(
            pickField(rawObj, ['Mahalla', 'MFY', 'mahalla'])
          ).trim();
          const rawStreet = String(
            pickField(rawObj, [
              'Ko‘cha va uy raqami',
              'Manzil',
              'Ko‘cha',
              'Street',
              'Address',
              'manzil',
            ])
          ).trim();
          const rawLat = pickField(rawObj, ['Kenglik', 'Lat', 'Latitude', 'kenglik']);
          const rawLng = pickField(rawObj, ['Uzunlik', 'Lng', 'Lon', 'Longitude', 'uzunlik']);
          const rawStatus = pickField(rawObj, [
            'Kadastr holati',
            'Holat',
            'Status',
            'kadastr_holati',
          ]);
          const rawCadNum = String(
            pickField(rawObj, ['Kadastr raqami', 'CadastreNumber', 'kadastr_raqami'])
          ).trim();
          const rawBasis = String(
            pickField(rawObj, ['Tasdiqlash asosi', 'Asos', 'Manba', 'verification_basis'])
          ).trim();
          const rawResidents = pickField(rawObj, [
            'Yashovchilar soni',
            'Yashovchilar',
            'Residents',
          ]);
          const rawContact = String(
            pickField(rawObj, ['Aloqa ma’lumoti', 'Aloqa', 'Telefon', 'Contact'])
          ).trim();
          const rawInspectionDate = String(
            pickField(rawObj, ['Oxirgi tekshiruv sanasi', 'Tekshiruv sanasi', 'InspectionDate'])
          ).trim();

          const canonicalRegion = rawRegion ? findCanonicalRegionName(rawRegion) : null;
          if (!rawRegion) {
            errors.push('Viloyat ko‘rsatilmagan');
          } else if (!canonicalRegion) {
            errors.push(`Noma’lum viloyat nomi: «${rawRegion}»`);
          }

          if (!rawDistrict) {
            errors.push('Tuman yoki shahar ko‘rsatilmagan');
          }

          if (!rawStreet || rawStreet.length < 3) {
            errors.push('Ko‘cha va uy raqami ko‘rsatilmagan');
          }

          const lat = Number(String(rawLat).replace(',', '.'));
          const lng = Number(String(rawLng).replace(',', '.'));
          if (String(rawLat).trim() === '' || !Number.isFinite(lat)) {
            errors.push('Xarita kengligi (lat) son bo‘lishi kerak');
          } else if (lat < UZBEKISTAN_BOUNDS.minLat || lat > UZBEKISTAN_BOUNDS.maxLat) {
            errors.push(`Kenglik (${lat}) O‘zbekiston chegarasidan tashqarida`);
          }

          if (String(rawLng).trim() === '' || !Number.isFinite(lng)) {
            errors.push('Xarita uzunligi (lng) son bo‘lishi kerak');
          } else if (lng < UZBEKISTAN_BOUNDS.minLng || lng > UZBEKISTAN_BOUNDS.maxLng) {
            errors.push(`Uzunlik (${lng}) O‘zbekiston chegarasidan tashqarida`);
          }

          const parsedStatus = parseCadastralStatusFromInput(rawStatus);
          if (parsedStatus.invalid) {
            errors.push(
              `Noto‘g‘ri kadastr holati: «${String(rawStatus)}» (Ruxsat etilgan: Kadastr mavjud / Kadastr mavjud emas / Holati noma’lum)`
            );
          }

          // Enforce reliable basis if status is explicitly confirmed green or red
          let effectiveBasis: string | null = rawBasis ? normalizeText(rawBasis) : null;
          if (
            (parsedStatus.status === 'has_cadastre' || parsedStatus.status === 'no_cadastre') &&
            !effectiveBasis
          ) {
            if (parsedStatus.status === 'has_cadastre' && rawCadNum) {
              effectiveBasis = `Kadastr reestri (${normalizeText(rawCadNum)})`;
            } else {
              errors.push(
                'Kadastr holati tasdiqlangan bo‘lsa, «Tasdiqlash asosi» ustuni to‘ldirilishi shart (aks holda bo‘sh qoldiring — «Holati noma’lum» deb olinadi)'
              );
            }
          }

          let residentsCount: number | null = null;
          if (String(rawResidents).trim() !== '') {
            const parsedRes = Number(rawResidents);
            if (!Number.isFinite(parsedRes) || parsedRes < 0 || parsedRes > 200) {
              errors.push('Yashovchilar soni noto‘g‘ri kiritilgan');
            } else {
              residentsCount = Math.round(parsedRes);
            }
          }

          if (errors.length > 0) {
            validatedRows.push({
              rowNumber,
              status: 'error',
              errors,
            });
            return;
          }

          const finalRegion = canonicalRegion!;
          const finalDistrict = normalizeText(rawDistrict);
          const finalStreet = normalizeText(rawStreet);
          const normKey = buildNormalizedAddressKey(finalRegion, finalDistrict, finalStreet);

          if (seenInFile.has(normKey)) {
            validatedRows.push({
              rowNumber,
              status: 'duplicate_file',
              errors: ['Yuklangan fayl ichida takrorlangan manzil'],
              normalized: {
                region: finalRegion,
                district: finalDistrict,
                mahalla: rawMahalla ? normalizeText(rawMahalla) : null,
                streetAddress: finalStreet,
                lat,
                lng,
                cadastralStatus: parsedStatus.status,
                cadastreNumber: rawCadNum ? normalizeText(rawCadNum) : null,
                verificationBasis: effectiveBasis,
                residentsCount,
                contactInfo: rawContact ? normalizeText(rawContact) : null,
                lastInspectionDate: rawInspectionDate ? rawInspectionDate.slice(0, 10) : null,
              },
            });
            return;
          }

          seenInFile.add(normKey);

          if (existingKeys.has(normKey)) {
            validatedRows.push({
              rowNumber,
              status: 'duplicate_db',
              errors: ['Markaziy ma’lumotlar bazasida allaqachon mavjud'],
              normalized: {
                region: finalRegion,
                district: finalDistrict,
                mahalla: rawMahalla ? normalizeText(rawMahalla) : null,
                streetAddress: finalStreet,
                lat,
                lng,
                cadastralStatus: parsedStatus.status,
                cadastreNumber: rawCadNum ? normalizeText(rawCadNum) : null,
                verificationBasis: effectiveBasis,
                residentsCount,
                contactInfo: rawContact ? normalizeText(rawContact) : null,
                lastInspectionDate: rawInspectionDate ? rawInspectionDate.slice(0, 10) : null,
              },
            });
            return;
          }

          validatedRows.push({
            rowNumber,
            status: 'valid',
            errors: [],
            normalized: {
              region: finalRegion,
              district: finalDistrict,
              mahalla: rawMahalla ? normalizeText(rawMahalla) : null,
              streetAddress: finalStreet,
              lat,
              lng,
              cadastralStatus: parsedStatus.status,
              cadastreNumber:
                parsedStatus.status === 'no_cadastre'
                  ? null
                  : rawCadNum
                    ? normalizeText(rawCadNum)
                    : null,
              verificationBasis: effectiveBasis,
              residentsCount,
              contactInfo: rawContact ? normalizeText(rawContact) : null,
              lastInspectionDate: rawInspectionDate ? rawInspectionDate.slice(0, 10) : null,
            },
          });
        });

        const response: ImportValidationResponse = {
          totalRows: validatedRows.length,
          validCount: validatedRows.filter((r) => r.status === 'valid').length,
          duplicateCount: validatedRows.filter(
            (r) => r.status === 'duplicate_db' || r.status === 'duplicate_file'
          ).length,
          errorCount: validatedRows.filter((r) => r.status === 'error').length,
          rows: validatedRows,
        };

        res.json(response);
      } catch (error) {
        console.error('Import validate error:', error);
        res.status(500).json({
          error: 'Faylni o‘qish va tekshirishda xatolik yuz berdi. Excel (.xlsx) yoki CSV formatini tekshiring.',
        });
      }
    }
  );

  app.post(
    '/api/admin/import/commit',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const admin = req.currentUser!;
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const fileName = normalizeText(String(req.body?.fileName || 'import.xlsx'));

        if (items.length === 0) {
          res.status(400).json({ error: 'Saqlash uchun tasdiqlangan qatorlar mavjud emas.' });
          return;
        }

        const now = new Date().toISOString();
        let insertedCount = 0;
        let skippedDuplicates = 0;

        const insertStmt = db.prepare(`
          INSERT INTO houses (
            house_uid, cadastre_number, region, district, mahalla, street_address,
            normalized_address_key, lat, lng, cadastral_status, verification_basis,
            residents_count, contact_info, inspection_note, last_inspection_date,
            created_by_service_id, updated_by_service_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const checkDupStmt = db.prepare(
          `SELECT id FROM houses WHERE normalized_address_key = ?`
        );

        db.exec('BEGIN IMMEDIATE TRANSACTION');
        try {
          for (const item of items) {
            const normKey = buildNormalizedAddressKey(
              String(item.region),
              String(item.district),
              String(item.streetAddress)
            );
            if (checkDupStmt.get(normKey)) {
              skippedDuplicates += 1;
              continue;
            }
            const uid = generateNextHouseUid(String(item.region));
            insertStmt.run(
              uid,
              item.cadastreNumber || null,
              normalizeText(String(item.region)),
              normalizeText(String(item.district)),
              item.mahalla ? normalizeText(String(item.mahalla)) : null,
              normalizeText(String(item.streetAddress)),
              normKey,
              Number(item.lat),
              Number(item.lng),
              item.cadastralStatus || 'unknown',
              item.verificationBasis || null,
              item.residentsCount !== null && item.residentsCount !== undefined
                ? Number(item.residentsCount)
                : null,
              item.contactInfo || null,
              'Fayl orqali tasdiqlangan import yozuvi',
              item.lastInspectionDate || null,
              admin.serviceId,
              admin.serviceId,
              now,
              now
            );
            insertedCount += 1;
          }
          db.exec('COMMIT');
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }

        writeAuditLog({
          actorServiceId: admin.serviceId,
          actorName: admin.fullName,
          actionType: 'FAYL_IMPORT_SAQLANDI',
          targetType: 'import',
          targetId: fileName,
          summary: `«${fileName}» faylidan ${insertedCount} ta tasdiqlangan uy yozuvi markaziy bazaga saqlandi.`,
          details: { fileName, insertedCount, skippedDuplicates },
        });

        res.json({ insertedCount, skippedDuplicates });
      } catch (error) {
        console.error('Import commit error:', error);
        res.status(500).json({ error: 'Tasdiqlangan ma’lumotlarni saqlashda xatolik yuz berdi.' });
      }
    }
  );

  // ==========================================
  // 5. AUDIT LOGS & DATABASE BACKUPS API
  // ==========================================

  app.get(
    '/api/admin/audit-logs',
    requireAuth,
    requireAdmin,
    (_req: AuthenticatedRequest, res: Response) => {
      try {
        const logs = getAuditLogs(200);
        res.json({ logs });
      } catch (error) {
        console.error('Audit logs error:', error);
        res.status(500).json({ error: 'O‘zgarishlar tarixini olishda xatolik yuz berdi.' });
      }
    }
  );

  app.get(
    '/api/admin/backups',
    requireAuth,
    requireAdmin,
    (_req: AuthenticatedRequest, res: Response) => {
      try {
        res.json({ backups: listDatabaseBackups() });
      } catch (error) {
        console.error('List backups error:', error);
        res.status(500).json({ error: 'Zaxira nusxalar ro‘yxatini olishda xatolik yuz berdi.' });
      }
    }
  );

  app.post(
    '/api/admin/backups',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const admin = req.currentUser!;
        const backup = createDatabaseBackup();
        writeAuditLog({
          actorServiceId: admin.serviceId,
          actorName: admin.fullName,
          actionType: 'ZAXIRA_NUSXA_YARATILDI',
          targetType: 'backup',
          targetId: backup.filename,
          summary: `Ma’lumotlar bazasining zaxira nusxasi yaratildi (${backup.filename}).`,
          details: { sizeBytes: backup.sizeBytes },
        });
        res.status(201).json({ backup, backups: listDatabaseBackups() });
      } catch (error) {
        console.error('Create backup error:', error);
        res.status(500).json({ error: 'Zaxira nusxa yaratishda xatolik yuz berdi.' });
      }
    }
  );

  app.get(
    '/api/admin/backups/:filename',
    requireAuth,
    requireAdmin,
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const rawName = path.basename(String(req.params.filename || ''));
        if (!rawName.endsWith('.sqlite')) {
          res.status(400).json({ error: 'Noto‘g‘ri fayl nomi.' });
          return;
        }
        const fullPath = path.join(BACKUPS_DIR, rawName);
        if (!fs.existsSync(fullPath)) {
          res.status(404).json({ error: 'Zaxira fayli topilmadi.' });
          return;
        }
        res.download(fullPath, rawName);
      } catch (error) {
        console.error('Download backup error:', error);
        res.status(500).json({ error: 'Zaxira faylini yuklab olishda xatolik yuz berdi.' });
      }
    }
  );

  // ==========================================
  // 6. VITE DEV MIDDLEWARE / STATIC SERVING
  // ==========================================

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kadastrli uy server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
