import React, { useEffect, useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Copy,
  Check,
  Lock,
  ClipboardCheck,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import type { CadastralStatus, HouseRecord, UserProfile } from '../shared/types.ts';
import { getStatusLabel } from '../shared/uzbekistanRegions.ts';

interface HouseDetailDrawerProps {
  house: HouseRecord | null;
  currentUser: UserProfile;
  onClose: () => void;
  onHouseUpdated: (updated: HouseRecord) => void;
}

export function HouseDetailDrawer({
  house,
  currentUser,
  onClose,
  onHouseUpdated,
}: HouseDetailDrawerProps) {
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [showInspectForm, setShowInspectForm] = useState(false);

  const [inspectMahalla, setInspectMahalla] = useState('');
  const [inspectStreetAddress, setInspectStreetAddress] = useState('');
  const [inspectStatus, setInspectStatus] = useState<CadastralStatus>('unknown');
  const [inspectBasis, setInspectBasis] = useState('');
  const [inspectCadNum, setInspectCadNum] = useState('');
  const [inspectNote, setInspectNote] = useState('');
  const [inspectDate, setInspectDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (house) {
      setInspectMahalla(house.mahalla || '');
      const cleanedAddr = house.streetAddress
        .replace(/\s*\((?:uy\s+)?raqam[ia]?\s+kiritilmagan\)\s*$/i, '')
        .replace(/,\s*turar joy$/i, '')
        .trim();
      setInspectStreetAddress(cleanedAddr || house.streetAddress);
      setInspectStatus(house.cadastralStatus);
      setInspectBasis(house.verificationBasis || '');
      setInspectCadNum(house.cadastreNumber || '');
      setInspectNote(house.inspectionNote || '');
      setInspectDate(house.lastInspectionDate || new Date().toISOString().slice(0, 10));
      setShowInspectForm(false);
      setFormError(null);
      setFormSuccess(null);
    }
  }, [house]);

  if (!house) return null;

  const canSubmitInspection =
    currentUser.role === 'admin' || currentUser.permissions.canInspect;

  const handleCopyCoords = async () => {
    try {
      await navigator.clipboard.writeText(`${house.lat.toFixed(6)}, ${house.lng.toFixed(6)}`);
      setCopiedCoords(true);
      setTimeout(() => setCopiedCoords(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleInspectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (inspectStreetAddress.trim().length < 2) {
      setFormError('Ko‘cha nomi va uy raqamini kiriting (masalan: Navbahor ko‘chasi, 14-uy).');
      return;
    }

    if (
      (inspectStatus === 'has_cadastre' || inspectStatus === 'no_cadastre') &&
      inspectBasis.trim().length < 5
    ) {
      setFormError(
        'Kadastr mavjud yoki mavjud emasligini tasdiqlash uchun ishonchli manba yoxud tekshiruv dalolatnomasi raqamini kiriting.'
      );
      return;
    }

    setSaving(true);
    try {
      const res = await api.submitInspection(house.id, {
        mahalla: inspectMahalla.trim(),
        streetAddress: inspectStreetAddress.trim(),
        cadastralStatus: inspectStatus,
        verificationBasis: inspectBasis.trim(),
        cadastreNumber: inspectStatus === 'no_cadastre' ? '' : inspectCadNum.trim(),
        inspectionNote: inspectNote.trim(),
        lastInspectionDate: inspectDate,
      });
      onHouseUpdated(res.house);
      setShowInspectForm(false);
      setFormSuccess('Uy manzili va tekshiruv ma’lumotlari muvaffaqiyatli saqlandi.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.');
    } finally {
      setSaving(false);
    }
  };

  const statusConfig = {
    has_cadastre: {
      container: 'bg-green-50 border-green-200 text-green-900',
      icon: <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />,
      desc: 'Uy uchun kadastr hujjati mavjudligi ishonchli ma’lumot asosida tasdiqlangan.',
    },
    no_cadastre: {
      container: 'bg-red-50 border-red-200 text-red-900',
      icon: <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />,
      desc: 'Uy uchun kadastr mavjud emasligi vakolatli tekshiruv yoki rasmiy manba asosida tasdiqlangan.',
    },
    unknown: {
      container: 'bg-amber-50 border-amber-200 text-amber-900',
      icon: <HelpCircle className="h-5 w-5 text-amber-600 shrink-0" />,
      desc: 'Uy haqidagi ma’lumot yetarli emas yoki kadastr holati hali tekshirilmagan.',
    },
  }[house.cadastralStatus];

  const formatDateTime = (iso: string | null) => {
    if (!iso) return 'Kiritilmagan';
    if (iso.length === 10) return iso;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('uz-UZ', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <aside
      aria-label="Uy haqidagi ma’lumotlar oynasi"
      className="fixed inset-x-0 bottom-0 z-[550] max-h-[54vh] md:static md:max-h-none md:w-[390px] lg:w-[410px] shrink-0 bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col shadow-xl md:shadow-none rounded-t-2xl md:rounded-none"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div className="min-w-0">
          <div className="text-xs font-mono text-slate-500 tabular-nums">
            ID: {house.houseUid}
            {house.cadastreNumber ? ` · Kadastr: ${house.cadastreNumber}` : ''}
          </div>
          <h2 className="text-base font-bold text-slate-900 mt-0.5 leading-snug">
            {house.streetAddress}
          </h2>
          <div className="text-xs text-slate-500 mt-0.5">
            <span>{house.region}</span>
            <span aria-hidden="true"> · </span>
            <span>{house.district}</span>
            {house.mahalla && (
              <>
                <span aria-hidden="true"> · </span>
                <span>{house.mahalla}</span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Oynani yopish"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {formSuccess && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3.5 py-2.5 text-xs font-medium text-green-800">
            {formSuccess}
          </div>
        )}

        {/* Cadastral Status Box */}
        <div className={`rounded-xl border p-4 ${statusConfig.container}`}>
          <div className="flex items-center gap-2.5">
            {statusConfig.icon}
            <span className="text-sm font-bold">{getStatusLabel(house.cadastralStatus)}</span>
          </div>
          <p className="text-xs mt-1.5 opacity-90 leading-relaxed">{statusConfig.desc}</p>
          {house.verificationBasis && (
            <div className="mt-2.5 pt-2.5 border-t border-current/15 text-xs">
              <span className="font-semibold">Tasdiqlash asosi: </span>
              <span>{house.verificationBasis}</span>
            </div>
          )}
        </div>

        {/* Structured Details List */}
        <dl className="divide-y divide-slate-100 text-sm border-y border-slate-100">
          <div className="py-2.5 flex justify-between gap-4">
            <dt className="text-slate-500">Uy identifikatsiya raqami</dt>
            <dd className="font-mono font-semibold text-slate-900 tabular-nums text-right">
              {house.houseUid}
            </dd>
          </div>

          <div className="py-2.5 flex justify-between gap-4">
            <dt className="text-slate-500">Viloyat</dt>
            <dd className="font-medium text-slate-900 text-right">{house.region}</dd>
          </div>

          <div className="py-2.5 flex justify-between gap-4">
            <dt className="text-slate-500">Tuman / Shahar</dt>
            <dd className="font-medium text-slate-900 text-right">{house.district}</dd>
          </div>

          <div className="py-2.5 flex justify-between gap-4">
            <dt className="text-slate-500">Ko‘cha va uy raqami</dt>
            <dd className="font-medium text-slate-900 text-right">
              {house.mahalla ? `${house.mahalla}, ` : ''}
              {house.streetAddress}
            </dd>
          </div>

          <div className="py-2.5 flex items-center justify-between gap-4">
            <dt className="text-slate-500">Xarita koordinatalari</dt>
            <dd className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-900 tabular-nums">
                {house.lat.toFixed(6)}, {house.lng.toFixed(6)}
              </span>
              <button
                type="button"
                onClick={handleCopyCoords}
                title="Koordinatalarni nusxalash"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                {copiedCoords ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </dd>
          </div>

          <div className="py-2.5 flex justify-between gap-4">
            <dt className="text-slate-500">Uyda yashovchilar soni</dt>
            <dd className="text-right">
              {house.residentsRestricted ? (
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Lock className="h-3.5 w-3.5" />
                  <span>Vakolat doirasida cheklangan</span>
                </span>
              ) : house.residentsCount !== null ? (
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {house.residentsCount} nafar
                </span>
              ) : (
                <span className="text-xs text-slate-400">Ma’lumot kiritilmagan</span>
              )}
            </dd>
          </div>

          <div className="py-2.5 flex justify-between gap-4">
            <dt className="text-slate-500">Aloqa ma’lumoti</dt>
            <dd className="text-right">
              {house.contactRestricted ? (
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Lock className="h-3.5 w-3.5" />
                  <span>Vakolat doirasida cheklangan</span>
                </span>
              ) : house.contactInfo ? (
                <span className="font-medium text-slate-900">{house.contactInfo}</span>
              ) : (
                <span className="text-xs text-slate-400">Ma’lumot kiritilmagan</span>
              )}
            </dd>
          </div>

          <div className="py-2.5 flex justify-between gap-4">
            <dt className="text-slate-500">Oxirgi tekshiruv sanasi</dt>
            <dd className="font-mono text-xs text-slate-900 tabular-nums text-right">
              {house.lastInspectionDate || 'Tekshirilmagan'}
            </dd>
          </div>

          <div className="py-2.5 flex justify-between gap-4">
            <dt className="text-slate-500">Yangilangan sanasi</dt>
            <dd className="font-mono text-xs text-slate-900 tabular-nums text-right">
              {formatDateTime(house.updatedAt)}
            </dd>
          </div>
        </dl>

        {house.inspectionNote && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 leading-relaxed">
            <div className="font-semibold text-slate-900 mb-1">Tekshiruv izohi</div>
            {house.inspectionNote}
          </div>
        )}

        {/* Officer / Admin Address & Inspection Action */}
        {canSubmitInspection && (
          <div className="pt-1">
            {!showInspectForm ? (
              <button
                type="button"
                onClick={() => setShowInspectForm(true)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors min-h-[44px]"
              >
                <ClipboardCheck className="h-4 w-4" />
                <span>Manzil va kadastr holatini tahrirlash</span>
              </button>
            ) : (
              <form
                onSubmit={handleInspectionSubmit}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    Manzil va tekshiruv ma’lumotini kiritish
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowInspectForm(false)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800"
                  >
                    Bekor qilish
                  </button>
                </div>

                {formError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    {formError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Qishloq / Mahalla (MFY)
                  </label>
                  <input
                    type="text"
                    placeholder="Masalan: Bog‘ishamol MFY"
                    value={inspectMahalla}
                    onChange={(e) => setInspectMahalla(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ko‘cha nomi va uy raqami
                  </label>
                  <input
                    type="text"
                    placeholder="Masalan: Navbahor ko‘chasi, 14-uy"
                    value={inspectStreetAddress}
                    onChange={(e) => setInspectStreetAddress(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Aniqlangan kadastr holati
                  </label>
                  <select
                    value={inspectStatus}
                    onChange={(e) => setInspectStatus(e.target.value as CadastralStatus)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  >
                    <option value="has_cadastre">Yashil — Kadastr mavjud</option>
                    <option value="no_cadastre">Qizil — Kadastr mavjud emas</option>
                    <option value="unknown">Sariq — Holati noma’lum</option>
                  </select>
                </div>

                {inspectStatus === 'has_cadastre' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Kadastr raqami (ixtiyoriy)
                    </label>
                    <input
                      type="text"
                      placeholder="Masalan: 10:05:02:04:01:0014"
                      value={inspectCadNum}
                      onChange={(e) => setInspectCadNum(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tasdiqlash asosi (dalolatnoma yoki rasmiy manba)
                  </label>
                  <input
                    type="text"
                    placeholder="Masalan: Tekshiruv dalolatnomasi №145/26"
                    value={inspectBasis}
                    onChange={(e) => setInspectBasis(e.target.value)}
                    required={inspectStatus !== 'unknown'}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tekshiruv sanasi
                  </label>
                  <input
                    type="date"
                    value={inspectDate}
                    onChange={(e) => setInspectDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Qo‘shimcha izoh
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Tekshiruv bo‘yicha qisqacha ma’lumot..."
                    value={inspectNote}
                    onChange={(e) => setInspectNote(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors min-h-[42px]"
                >
                  {saving ? 'Saqlanmoqda...' : 'Natijani saqlash'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
