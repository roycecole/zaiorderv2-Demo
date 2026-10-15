// src/features/account/AccountPage.tsx —— PG-10 會員中心
//
// 頭像字首、姓名、手機（遮罩）；入口：歷史訂單、個人資料、地址簿、我的最愛、優惠券、隱私權政策；登出與刪除帳號。
// 登出：確認後呼叫 `auth.logout` 並清除 Session 與會員快取（購物車保留）；
// 刪除帳號：兩段確認（說明 → 勾選「我了解」），完成後清除會員資料並登出（FR-AC-07、05 §7.2）。
import { ChevronRight, ClipboardList, Heart, LogOut, MapPin, ShieldCheck, Ticket, Trash2, UserRound } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import { Button, Card, Checkbox, ConfirmDialog, Dialog, useToast } from '@/components';
import { maskPhone } from '@/domain/format';
import { useAnnounce } from '@/features/a11y';
import { useSession } from '@/features/auth/useSession';
import { useApi } from '@/hooks/useApi';
import { errorMessageOf } from '@/i18n/strings/errors';
import { account as tAccount } from '@/i18n/strings/account';

const s = tAccount.home;

interface NavItem {
  to: string;
  title: string;
  hint: string;
  icon: ReactNode;
}

function NavList({ items, label }: { items: NavItem[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-bg p-0">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="flex min-h-(--hit-size-lg) items-center gap-3 px-4 py-3 hover:bg-bg-subtle"
            >
              <span aria-hidden="true" className="shrink-0 text-text-muted [&>svg]:size-6">
                {item.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base leading-6 font-semibold text-text">{item.title}</span>
                <span className="block text-sm leading-5 text-text-muted">{item.hint}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AccountPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { toast } = useToast();
  const announce = useAnnounce();
  const { user, logout, clearLocal } = useSession();

  const [logoutOpen, setLogoutOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'closed' | 'warn' | 'final'>('closed');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  usePageTitle(s.pageTitle);

  if (user === null) return null; // 由 RequireAuth 擋下；僅供型別收斂

  const displayName = user.name !== undefined && user.name !== '' ? user.name : null;
  const initial = displayName !== null ? (Array.from(displayName)[0] ?? s.avatarFallback) : s.avatarFallback;
  const nav = s.nav;

  const mainItems: NavItem[] = [
    { to: ROUTES.orders, ...nav.orders, icon: <ClipboardList /> },
    { to: ROUTES.accountProfile, ...nav.profile, icon: <UserRound /> },
    { to: ROUTES.accountAddresses, ...nav.addresses, icon: <MapPin /> },
    { to: ROUTES.accountFavorites, ...nav.favorites, icon: <Heart /> },
    { to: ROUTES.accountCoupons, ...nav.coupons, icon: <Ticket /> },
  ];
  const otherItems: NavItem[] = [{ to: ROUTES.privacy, ...nav.privacy, icon: <ShieldCheck /> }];

  const doLogout = async (): Promise<void> => {
    await logout();
    toast({ message: s.loggedOut, tone: 'success' });
    announce(s.loggedOut);
    navigate(ROUTES.home, { replace: true });
  };

  const closeDelete = (): void => {
    setDeleteStep('closed');
    setAcknowledged(false);
  };

  const doDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await api.me.remove();
    } catch (e) {
      setDeleting(false);
      toast({ message: errorMessageOf(e, s.deleteFailed), tone: 'error' });
      return;
    }
    // 伺服器已撤銷所有 Session：只需清除本機狀態
    await clearLocal();
    setDeleting(false);
    closeDelete();
    toast({ message: s.deleted, tone: 'success' });
    announce(s.deleted);
    navigate(ROUTES.home, { replace: true });
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-4 md:py-6">
      <h1 className="sr-only">{s.pageTitle}</h1>

      <Card as="section" aria-label={s.pageTitle} className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="grid size-16 shrink-0 place-items-center rounded-full bg-brand-soft text-h1 font-bold text-brand-text"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <p
            className={
              displayName !== null
                ? 'text-h3 font-bold text-text [overflow-wrap:anywhere]'
                : 'text-h3 font-bold text-text-muted'
            }
          >
            {displayName ?? s.noName}
          </p>
          <p className="text-sm leading-5 text-text-sub tabular-nums">
            <span className="sr-only">{tAccount.profile.phoneLabel} </span>
            {maskPhone(user.phone)}
          </p>
        </div>
      </Card>

      <NavList items={mainItems} label={s.sectionShortcuts} />
      <NavList items={otherItems} label={s.sectionOthers} />

      <div className="flex flex-col gap-3">
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          leadingIcon={<LogOut aria-hidden="true" className="size-5" />}
          onClick={() => setLogoutOpen(true)}
        >
          {s.logout}
        </Button>
        <Button
          ref={deleteTriggerRef}
          variant="ghost"
          fullWidth
          leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
          onClick={() => setDeleteStep('warn')}
        >
          <span className="text-danger">{s.deleteAccount}</span>
        </Button>
      </div>

      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title={s.logoutDialog.title}
        description={s.logoutDialog.description}
        confirmLabel={s.logoutDialog.confirm}
        cancelLabel={s.logoutDialog.cancel}
        onConfirm={doLogout}
      />

      {/* 刪除帳號：兩段確認 */}
      <ConfirmDialog
        open={deleteStep === 'warn'}
        onOpenChange={(open) => {
          // 確認後 onConfirm 已把步驟切到 final，隨後的 onOpenChange(false) 不得把它重置
          if (!open) setDeleteStep((cur) => (cur === 'warn' ? 'closed' : cur));
        }}
        tone="danger"
        title={s.deleteDialog.title}
        description={s.deleteDialog.description}
        confirmLabel={s.deleteDialog.confirm}
        cancelLabel={s.deleteDialog.cancel}
        onConfirm={() => {
          // 關閉第一段後直接進入第二段（兩段確認）
          setDeleteStep('final');
        }}
      />
      <Dialog
        open={deleteStep === 'final'}
        onOpenChange={(open) => {
          if (!open && !deleting) closeDelete();
        }}
        role="alertdialog"
        size="sm"
        showClose={false}
        title={s.deleteDialog.finalTitle}
        description={s.deleteDialog.finalDescription}
        initialFocusRef={backRef}
        footer={
          <>
            <Button ref={backRef} variant="secondary" disabled={deleting} onClick={closeDelete}>
              {s.deleteDialog.cancel}
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              aria-disabled={!acknowledged ? true : undefined}
              onClick={() => void doDelete()}
            >
              {s.deleteDialog.finalConfirm}
            </Button>
          </>
        }
      >
        <Checkbox
          label={s.deleteDialog.acknowledge}
          checked={acknowledged}
          onCheckedChange={setAcknowledged}
        />
      </Dialog>
    </div>
  );
}
