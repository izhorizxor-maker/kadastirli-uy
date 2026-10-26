import React, { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Home,
} from 'lucide-react';
import { api, ApiError, setAuthToken } from '../lib/api.ts';
import type { UserProfile } from '../shared/types.ts';

interface LoginViewProps {
  onAuthenticated: (user: UserProfile, initialView?: 'map' | 'admin') => void;
  initialMode?: 'login' | 'admin_login' | 'activate';
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'U',
  Х: 'X',
};

function sanitizeServiceId(raw: string): string {
  return raw
    .replace(/[\s·`"'‘’\u200B-\u200D\uFEFF]+/g, '')
    .toUpperCase()
    .replace(/[АВЕКМНОРСТУХ]/g, (ch) => CYRILLIC_TO_LATIN[ch] || ch);
}

function sanitizePassword(raw: string): string {
  return raw.replace(
    /^[\s\u00A0\u200B-\u200D\uFEFF`·]+|[\s\u00A0\u200B-\u200D\uFEFF`]+$/g,
    ''
  );
}

export function LoginView({ onAuthenticated, initialMode = 'login' }: LoginViewProps) {
  const [mode, setMode] = useState<'login' | 'admin_login' | 'activate'>(initialMode);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Login state
  const [serviceId, setServiceId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  // First-time activation state
  const [actServiceId, setActServiceId] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDemoAccounts, setShowDemoAccounts] = useState(true);

  const executeLogin = async (
    rawSid: string,
    rawPwd: string,
    targetView: 'map' | 'admin'
  ) => {
    setErrorMsg(null);
    const cleanedId = sanitizeServiceId(rawSid);
    const cleanedPwd = sanitizePassword(rawPwd);

    if (!cleanedId || !cleanedPwd) {
      setErrorMsg('Xizmat ID raqami va parolni kiriting.');
      return;
    }

    setLoading(true);
    try {
      const result = await api.login(cleanedId, cleanedPwd);
      if (targetView === 'admin' && result.user.role !== 'admin') {
        setErrorMsg(
          'Kiritilgan hisob administrator vakolatiga ega emas. Admin panel uchun administrator ID raqamini kiriting.'
        );
        return;
      }
      setAuthToken(result.token);
      onAuthenticated(result.user, targetView);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NEEDS_ACTIVATION') {
        setActServiceId(cleanedId);
        setMode('activate');
        setErrorMsg(err.message);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Tizimga kirishda xatolik yuz berdi.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeLogin(serviceId, password, mode === 'admin_login' ? 'admin' : 'map');
  };

  const handleActivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedId = sanitizeServiceId(actServiceId);
    const trimmedCode = sanitizeServiceId(activationCode);
    const cleanedNewPwd = sanitizePassword(newPassword);
    const cleanedConfirmPwd = sanitizePassword(confirmPassword);

    if (!trimmedId || !trimmedCode || !cleanedNewPwd) {
      setErrorMsg('Barcha maydonlarni to‘ldiring.');
      return;
    }
    if (cleanedNewPwd.length < 8) {
      setErrorMsg('Shaxsiy parol kamida 8 ta belgidan iborat bo‘lishi lozim.');
      return;
    }
    if (cleanedNewPwd !== cleanedConfirmPwd) {
      setErrorMsg('Kiritilgan parollar o‘zaro mos kelmadi.');
      return;
    }

    setLoading(true);
    try {
      const result = await api.activateAccount(trimmedId, trimmedCode, cleanedNewPwd);
      setAuthToken(result.token);
      onAuthenticated(result.user, 'map');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Hisobni faollashtirishda xatolik yuz berdi.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoAction = async (
    type: 'admin_map' | 'admin_panel' | 'officer' | 'pending'
  ) => {
    setErrorMsg(null);
    if (type === 'admin_panel') {
      setMode('admin_login');
      setServiceId('AE7130358');
      setPassword('Admin@2026!');
      await executeLogin('AE7130358', 'Admin@2026!', 'admin');
    } else if (type === 'admin_map') {
      setMode('login');
      setServiceId('AE7130358');
      setPassword('Admin@2026!');
      await executeLogin('AE7130358', 'Admin@2026!', 'map');
    } else if (type === 'officer') {
      setMode('login');
      setServiceId('IIV-101');
      setPassword('Xodim@2026!');
      await executeLogin('IIV-101', 'Xodim@2026!', 'map');
    } else {
      setMode('activate');
      setActServiceId('IIV-202');
      setActivationCode('FAOL-8842');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const checkCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="text-center mb-6">
          <div className="mx-auto h-12 w-12 rounded-xl bg-slate-900 text-white flex items-center justify-center mb-3.5">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Kadastrli uy</h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-sm mx-auto">
            O‘zbekiston hududidagi turar joylar kadastr holatini aniqlash va kiritish yagona tizimi
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-7 shadow-xs">
          {/* Prominent 3-way entry selector at the start of the site */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg mb-5">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
              }}
              className={`py-2 px-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap truncate ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Xaritaga kirish
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('admin_login');
                setErrorMsg(null);
              }}
              className={`py-2 px-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap truncate ${
                mode === 'admin_login'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Admin panel
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('activate');
                setErrorMsg(null);
              }}
              className={`py-2 px-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap truncate ${
                mode === 'activate'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Faollashtirish
            </button>
          </div>

          {mode === 'admin_login' && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 leading-relaxed">
              <span className="font-semibold text-slate-900">Admin panel bo‘limi:</span> Qishloq va
              mahallalardagi barcha uylarning kadastr holatini ketma-ket tekshirib bazaga kiritish
              va xodimlar vakolatini boshqarish.
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {errorMsg}
            </div>
          )}

          {mode === 'login' || mode === 'admin_login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="service-id"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Xizmat ID raqami
                </label>
                <input
                  id="service-id"
                  type="text"
                  autoComplete="username"
                  placeholder="Masalan: AE7130358"
                  value={serviceId}
                  onChange={(e) => setServiceId(sanitizeServiceId(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-slate-800">
                    Parol
                  </label>
                  {capsLockOn && (
                    <span className="text-xs font-medium text-amber-700">Caps Lock yoqilgan</span>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Shaxsiy parolingizni kiriting"
                    value={password}
                    onKeyUp={checkCapsLock}
                    onKeyDown={checkCapsLock}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Parolni yashirish' : 'Parolni ko‘rsatish'}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60 transition-colors min-h-[44px]"
              >
                {mode === 'admin_login' ? (
                  <Home className="h-4 w-4" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                <span>
                  {loading
                    ? 'Tekshirilmoqda...'
                    : mode === 'admin_login'
                      ? 'Admin panelga kirish'
                      : 'Kirish'}
                </span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleActivateSubmit} className="space-y-4">
              <p className="text-xs leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
                Administrator tomonidan tizimga kiritilgan xodimlar bir martalik maxfiy kod orqali
                hisobini faollashtiradi va o‘z shaxsiy parolini yaratadi.
              </p>

              <div>
                <label
                  htmlFor="act-service-id"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Xizmat ID raqami
                </label>
                <input
                  id="act-service-id"
                  type="text"
                  placeholder="Masalan: IIV-202"
                  value={actServiceId}
                  onChange={(e) => setActServiceId(sanitizeServiceId(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="act-code"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Maxfiy faollashtirish kodi
                </label>
                <input
                  id="act-code"
                  type="text"
                  placeholder="Masalan: FAOL-8842"
                  value={activationCode}
                  onChange={(e) => setActivationCode(sanitizeServiceId(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="new-password"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Shaxsiy parol yarating
                </label>
                <div className="relative">
                  <input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="Kamida 8 ta belgi"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label="Parolni ko‘rsatish"
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800"
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirm-password"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Parolni tasdiqlang
                </label>
                <input
                  id="confirm-password"
                  type={showNewPassword ? 'text' : 'password'}
                  placeholder="Yangi parolni qayta kiriting"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60 transition-colors min-h-[44px]"
              >
                <KeyRound className="h-4 w-4" />
                <span>{loading ? 'Faollashtirilmoqda...' : 'Faollashtirish va kirish'}</span>
              </button>
            </form>
          )}
        </div>

        {/* Unobtrusive testing credentials helper */}
        <div className="mt-4 border border-slate-200 bg-white rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowDemoAccounts((prev) => !prev)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <span>Vakolatli hisoblar orqali tezkor kirish</span>
            {showDemoAccounts ? (
              <ChevronUp className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0" />
            )}
          </button>

          {showDemoAccounts && (
            <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-2.5 text-xs">
              <div className="py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900">
                    Administrator (Qishloq uylari va kadastr kiritish)
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-slate-600">
                  <span>ID:</span>
                  <code className="select-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">
                    AE7130358
                  </code>
                  <span>Parol:</span>
                  <code className="select-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">
                    Admin@2026!
                  </code>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleQuickDemoAction('admin_panel')}
                    className="flex-1 py-1.5 px-3 rounded-md bg-slate-900 text-white font-semibold hover:bg-slate-800 whitespace-nowrap"
                  >
                    Admin panelni ochish
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleQuickDemoAction('admin_map')}
                    className="py-1.5 px-3 rounded-md border border-slate-300 text-slate-800 font-medium hover:bg-slate-50 whitespace-nowrap"
                  >
                    Xaritani ochish
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 py-1.5 border-t border-slate-100">
                <div>
                  <div className="font-semibold text-slate-900">Oddiy xodim (Inspektor)</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-slate-600">
                    <span>ID:</span>
                    <code className="select-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">
                      IIV-101
                    </code>
                    <span>Parol:</span>
                    <code className="select-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">
                      Xodim@2026!
                    </code>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleQuickDemoAction('officer')}
                  className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-800 font-medium hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Tez kirish
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 py-1.5 border-t border-slate-100">
                <div>
                  <div className="font-semibold text-slate-900">
                    Birinchi marta kiruvchi yangi xodim
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-slate-600">
                    <span>ID:</span>
                    <code className="select-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">
                      IIV-202
                    </code>
                    <span>Kod:</span>
                    <code className="select-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">
                      FAOL-8842
                    </code>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleQuickDemoAction('pending')}
                  className="px-3 py-1.5 rounded-md border border-slate-300 text-slate-800 font-medium hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Faollashtirish
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-slate-500">
          Faqat vakolati tasdiqlangan xodimlar foydalanishi uchun mo‘ljallangan. Barcha amallar
          qayd etiladi.
        </p>
      </div>
    </div>
  );
}
