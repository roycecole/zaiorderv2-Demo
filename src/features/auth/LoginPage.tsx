// src/features/auth/LoginPage.tsx —— PG-09 登入（FLOW-08、FLOW-18；BR-33 登入為選用，從不自動彈出）
//
// 三個步驟：① 手機 → ② 6 位數驗證碼（OtpInput，輸入滿自動送出）→ ③ 新會員補姓名（選填，可略過）。
// 登入成功導向 `?redirect=`（僅限站內路徑，07 §11）。Demo 模式提示驗證碼並提供「快速登入示範會員」（FR-DM-08）。
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import { Button, InlineAlert, LinkButton, TextField, useToast } from '@/components';
import { formatPhone } from '@/domain/format';
import { PHONE_RE, normalizePhone } from '@/domain/validation';
import { useAnnounce } from '@/features/a11y';
import { useIsKioskUi } from '@/features/prefs/inputModeStore';
import { useApi } from '@/hooks/useApi';
import { useClockNow } from '@/hooks/useClockNow';
import { useDemoControl } from '@/hooks/useDemoControl';
import { errorMessageOf } from '@/i18n/strings/errors';
import { auth as tAuth } from '@/i18n/strings/auth';
import { getClock } from '@/services/clock';
import { readApiError } from './errorInfo';
import { OtpInput } from './OtpInput';
import { isMemberOnlyPath, safeRedirect } from './safeRedirect';
import { useSessionStore } from './sessionStore';

const OTP_LENGTH = 6;
const NAME_MAX = 20;

type Step = 'phone' | 'otp' | 'profile';
type Busy = 'send' | 'verify' | 'demo' | 'name' | null;

interface Notice {
  text: string;
  /** invalid：驗證碼不正確；locked：驗證鎖定中（另顯示剩餘時間）；limited：發送被限流 */
  kind: 'error' | 'invalid' | 'locked' | 'limited';
}

/** 輸入時即時格式化：只留數字、最多 10 碼，顯示為 0912-345-678（送出時移除連字號） */
export function formatPhoneInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 4) return d;
  if (d.length <= 7) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
}

const nowMs = (): number => getClock().now().getTime();

export function LoginPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const announce = useAnnounce();
  const demo = useDemoControl();
  const kiosk = useIsKioskUi();
  const sessionUserAtMount = useSessionStore((s) => s.user);
  const [wasLoggedIn] = useState(() => sessionUserAtMount !== null);

  const redirect = safeRedirect(params.get('redirect'));
  const guestTarget = isMemberOnlyPath(redirect) ? ROUTES.home : redirect;

  const [step, setStep] = useState<Step>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // 進入補姓名步驟時把焦點移到姓名欄（新畫面的第一個欄位）
  useEffect(() => {
    if (step === 'profile') nameRef.current?.focus();
  }, [step]);

  // 只在有倒數進行時才每秒更新
  const rawNow = nowMs();
  const ticking = (cooldownUntil ?? 0) > rawNow || (lockedUntil ?? 0) > rawNow;
  const now = useClockNow(ticking ? 1000 : null).getTime();
  const secondsLeft = (until: number | null): number =>
    until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  const resendLeft = secondsLeft(cooldownUntil);
  const lockedLeft = secondsLeft(lockedUntil);
  const locked = lockedLeft > 0;

  usePageTitle(step === 'profile' ? tAuth.welcomeTitle : tAuth.pageTitle);

  if (kiosk) return <Navigate to={ROUTES.home} replace />;
  if (wasLoggedIn && step === 'phone') return <Navigate to={redirect} replace />;

  const finish = (isNewUser: boolean): void => {
    toast({ message: isNewUser ? tAuth.welcome : tAuth.loggedIn, tone: 'success' });
    navigate(redirect, { replace: true });
  };

  // ───────── ① 發送驗證碼 ─────────
  const sendOtp = async (target: string, resend: boolean): Promise<void> => {
    setBusy('send');
    setNotice(null);
    try {
      const res = await api.auth.sendOtp(target);
      setPhone(target);
      setCode('');
      setLockedUntil(null);
      setCooldownUntil(nowMs() + res.resendAfterSeconds * 1000);
      setStep('otp');
      setFocusSignal((n) => n + 1);
      announce(
        resend ? tAuth.resent : tAuth.otpSent(formatPhone(target), res.resendAfterSeconds),
      );
    } catch (e) {
      const info = readApiError(e);
      if (info.code === 'OTP_RATE_LIMITED') {
        if (info.retryAfterSeconds !== null) setCooldownUntil(nowMs() + info.retryAfterSeconds * 1000);
        setNotice({ text: tAuth.otpRateLimited, kind: 'limited' });
      } else if (info.code === 'VALIDATION_FAILED' && step === 'phone') {
        setPhoneError(info.details.find((d) => d.field === 'phone')?.message ?? tAuth.phoneInvalid);
      } else {
        setNotice({ text: errorMessageOf(e), kind: 'error' });
      }
    } finally {
      setBusy(null);
    }
  };

  const handlePhoneSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (busy !== null) return;
    const normalized = normalizePhone(phoneInput);
    if (!PHONE_RE.test(normalized)) {
      setPhoneError(tAuth.phoneInvalid);
      return;
    }
    setPhoneError(null);
    void sendOtp(normalized, false);
  };

  // ───────── ② 驗證 ─────────
  const verify = async (value: string): Promise<void> => {
    if (busy !== null || locked) return;
    if (value.length !== OTP_LENGTH) {
      setNotice({ text: tAuth.otpIncomplete, kind: 'error' });
      return;
    }
    setBusy('verify');
    setNotice(null);
    try {
      const res = await api.auth.verifyOtp(phone, value);
      useSessionStore.getState().setSession(res.tokens, res.user);
      if (res.isNewUser) {
        setStep('profile');
      } else {
        finish(false);
      }
    } catch (e) {
      const info = readApiError(e);
      setCode('');
      setFocusSignal((n) => n + 1);
      if (info.code === 'OTP_INVALID') {
        setNotice({
          text:
            info.remainingAttempts !== null
              ? tAuth.otpInvalidRemaining(info.remainingAttempts)
              : tAuth.otpInvalid,
          kind: 'invalid',
        });
      } else if (info.code === 'OTP_LOCKED' || info.code === 'OTP_RATE_LIMITED') {
        if (info.retryAfterSeconds !== null) setLockedUntil(nowMs() + info.retryAfterSeconds * 1000);
        setNotice({ text: tAuth.otpLocked, kind: 'locked' });
      } else {
        setNotice({ text: errorMessageOf(e, tAuth.loginFailed), kind: 'error' });
      }
    } finally {
      setBusy(null);
    }
  };

  // ───────── Demo：快速登入示範會員 ─────────
  const quickLogin = async (): Promise<void> => {
    if (demo === null || busy !== null) return;
    setBusy('demo');
    setNotice(null);
    try {
      await demo.loginAsDemoUser();
      const { tokens } = await api.auth.refresh();
      const user = await api.me.get();
      useSessionStore.getState().setSession(tokens, user);
      finish(false);
    } catch (e) {
      setNotice({ text: errorMessageOf(e, tAuth.loginFailed), kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // ───────── ③ 新會員補姓名（選填） ─────────
  const saveName = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy !== null) return;
    const trimmed = name.trim();
    if (trimmed === '') {
      finish(true);
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setNameError(tAuth.nameInvalid);
      return;
    }
    setNameError(null);
    setBusy('name');
    try {
      const updated = await api.me.update({ name: trimmed });
      useSessionStore.getState().setUser(updated);
    } catch {
      // 補姓名是選填：失敗不阻擋登入，之後可在個人資料修改
    } finally {
      setBusy(null);
    }
    finish(true);
  };

  const phoneDisplay = formatPhone(phone);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-6 md:py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-bold text-text">
          {step === 'profile' ? tAuth.welcomeTitle : tAuth.pageTitle}
        </h1>
        {step === 'profile' ? (
          <p className="text-sm leading-5 text-text-sub">{tAuth.welcomeIntro}</p>
        ) : (
          <p className="text-sm leading-5 text-text-sub">{tAuth.intro}</p>
        )}
      </header>

      {demo !== null && step !== 'profile' ? (
        <InlineAlert tone="info" title={tAuth.demoTitle} role="none">
          <p>{tAuth.demoCode}</p>
          <p className="text-text-sub">{tAuth.demoQuickLoginHint}</p>
          <div className="mt-2">
            <Button
              variant="secondary"
              loading={busy === 'demo'}
              aria-disabled={busy !== null && busy !== 'demo' ? true : undefined}
              onClick={() => void quickLogin()}
            >
              {tAuth.demoQuickLogin}
            </Button>
          </div>
        </InlineAlert>
      ) : null}

      {step === 'phone' ? (
        <form onSubmit={handlePhoneSubmit} noValidate className="flex flex-col gap-4">
          <TextField
            label={tAuth.phoneLabel}
            hint={tAuth.phoneHint}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            enterKeyHint="send"
            placeholder="0912-345-678"
            required
            value={phoneInput}
            error={phoneError}
            onChange={(e) => {
              setPhoneInput(formatPhoneInput(e.target.value));
              if (phoneError !== null) setPhoneError(null);
            }}
          />
          {notice !== null ? (
            <InlineAlert
              tone="error"
              action={
                notice.kind === 'limited' ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const normalized = normalizePhone(phoneInput);
                      if (!PHONE_RE.test(normalized)) return;
                      setPhone(normalized);
                      setCode('');
                      setNotice(null);
                      setStep('otp');
                      setFocusSignal((n) => n + 1);
                    }}
                  >
                    {tAuth.haveCode}
                  </Button>
                ) : undefined
              }
            >
              <p>{notice.text}</p>
              {notice.kind === 'limited' && resendLeft > 0 ? (
                <p role="timer">{tAuth.retryIn(resendLeft)}</p>
              ) : null}
            </InlineAlert>
          ) : null}
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={busy === 'send'}
            loadingLabel={tAuth.sendingOtp}
          >
            {tAuth.sendOtp}
          </Button>
        </form>
      ) : null}

      {step === 'otp' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-h3 font-semibold text-text">{tAuth.otpTitle}</h2>
            <p className="text-sm leading-5 text-text-sub">
              {tAuth.otpSentTo(phoneDisplay)}
              <button
                type="button"
                className="ml-2 min-h-(--hit-size) font-semibold text-brand-text underline underline-offset-2"
                onClick={() => {
                  setStep('phone');
                  setPhoneInput(formatPhoneInput(phone));
                  setCode('');
                  setNotice(null);
                  setLockedUntil(null);
                }}
              >
                {tAuth.changePhone}
              </button>
            </p>
          </div>

          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(v) => void verify(v)}
            label={tAuth.otpLabel}
            cellLabel={tAuth.otpCell}
            length={OTP_LENGTH}
            disabled={busy === 'verify' || locked}
            invalid={notice?.kind === 'invalid'}
            describedBy={notice !== null ? 'login-otp-notice' : undefined}
            initialFocus
            focusSignal={focusSignal}
          />

          {notice !== null ? (
            <div id="login-otp-notice" role="alert" className="text-sm leading-5 text-danger">
              <p className="font-semibold">{notice.text}</p>
              {notice.kind === 'locked' && locked ? (
                <p role="timer" className="mt-0.5 font-normal text-text-sub">
                  {tAuth.retryIn(lockedLeft)}
                </p>
              ) : null}
            </div>
          ) : null}

          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={busy === 'verify'}
            loadingLabel={tAuth.verifying}
            aria-disabled={locked ? true : undefined}
          >
            {tAuth.verify}
          </Button>

          <div className="flex min-h-(--hit-size) items-center justify-center text-sm leading-5 text-text-sub">
            {resendLeft > 0 ? (
              <span role="timer">{tAuth.resendIn(resendLeft)}</span>
            ) : (
              <Button
                variant="ghost"
                loading={busy === 'send'}
                loadingLabel={tAuth.sendingOtp}
                onClick={() => void sendOtp(phone, true)}
              >
                {tAuth.resend}
              </Button>
            )}
          </div>
        </form>
      ) : null}

      {step === 'profile' ? (
        <form onSubmit={(e) => void saveName(e)} noValidate className="flex flex-col gap-4">
          <TextField
            label={tAuth.nameLabel}
            optional
            autoComplete="name"
            enterKeyHint="done"
            ref={nameRef}
            value={name}
            error={nameError}
            counter={{ current: name.trim().length, max: NAME_MAX }}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError !== null) setNameError(null);
            }}
          />
          <div className="flex flex-col gap-3">
            <Button type="submit" size="lg" fullWidth loading={busy === 'name'}>
              {tAuth.saveName}
            </Button>
            <Button variant="ghost" size="lg" fullWidth onClick={() => finish(true)}>
              {tAuth.skip}
            </Button>
          </div>
        </form>
      ) : null}

      {step !== 'profile' ? (
        <div className="flex flex-col gap-3 border-t border-border pt-5">
          <LinkButton as={Link} to={guestTarget} variant="secondary" size="lg" fullWidth>
            {tAuth.guestContinue}
          </LinkButton>
          <p className="text-center text-xs leading-4 text-text-muted">
            {tAuth.privacyNote}
            <Link to={ROUTES.privacy} className="ml-1 underline underline-offset-2">
              {tAuth.privacyLink}
            </Link>
            <span aria-hidden="true"> · </span>
            <Link to={ROUTES.terms} className="underline underline-offset-2">
              {tAuth.termsLink}
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  );
}
