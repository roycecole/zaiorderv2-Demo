// src/features/demo/sections/AccountSection.tsx —— 快速登入示範會員（FR-DM-08）與重置 Demo 資料（FR-DM-02）
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ConfirmDialog, useToast } from '@/components';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useApi } from '@/hooks/useApi';
import { demo as tDemo } from '@/i18n/strings/demo';
import { errorMessageOf } from '@/i18n/strings/errors';
import { quickLoginDemoUser, resetDemoData } from '../accountActions';
import { useDemoContext } from '../DemoContext';
import { invalidateAccountQueries } from '../invalidate';
import { SubGroup } from '../parts';

export function AccountSection() {
  const { demo } = useDemoContext();
  const api = useApi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const user = useSessionStore((s) => s.user);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const login = async (): Promise<void> => {
    try {
      await quickLoginDemoUser(api, demo);
      toast({ message: tDemo.account.loginDone, tone: 'success' });
    } catch (error) {
      toast({ message: errorMessageOf(error, tDemo.account.loginFailed), tone: 'error' });
    } finally {
      await invalidateAccountQueries(queryClient);
    }
  };

  return (
    <>
      <SubGroup legend={tDemo.account.legend}>
        <p className="text-sm leading-5 text-text-sub" aria-live="polite">
          {user !== null
            ? tDemo.account.loggedIn(user.name ?? user.phone)
            : tDemo.account.loggedOut}
        </p>
        <Button variant="secondary" onClick={login}>
          {tDemo.account.login}
        </Button>
      </SubGroup>
      <SubGroup legend={tDemo.account.resetLegend}>
        <p className="text-sm leading-5 text-text-muted">{tDemo.account.resetHint}</p>
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          {tDemo.account.reset}
        </Button>
      </SubGroup>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title={tDemo.account.resetTitle}
        description={tDemo.account.resetDescription}
        confirmLabel={tDemo.account.resetConfirm}
        cancelLabel={tDemo.account.resetCancel}
        onConfirm={() => resetDemoData(demo)}
      />
    </>
  );
}
