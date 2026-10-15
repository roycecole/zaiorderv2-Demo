// src/features/orders/SaveOrderPrompt.tsx —— CMP-33 訪客「保存這筆訂單」提示（FR-OD-11、BR-33）
//
// 非阻擋的淡色卡：可略過並記住（`prefs.orderSavePromptDismissed`）；不使用 alertdialog、不攔截焦點。
import { X } from 'lucide-react';
import { Link } from 'react-router';
import { Card, IconButton } from '@/components';
import { buildLoginUrl } from '@/features/auth/safeRedirect';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { ROUTES } from '@/app/routes';
import { orders as tOrders } from '@/i18n/strings/orders';

export function SaveOrderPrompt({ orderId }: { orderId: string }) {
  const dismissed = usePrefsStore((s) => s.orderSavePromptDismissed);
  const patch = usePrefsStore((s) => s.patch);
  if (dismissed) return null;
  const s = tOrders.tracking.savePrompt;
  return (
    <Card as="aside" tone="dashed" aria-labelledby="save-order-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="save-order-title" className="text-base leading-6 font-bold text-text">
            {s.title}
          </h2>
          <p className="text-sm leading-5 text-text-sub">{s.body}</p>
          <Link
            to={buildLoginUrl(ROUTES.order(orderId))}
            className="mt-1 inline-flex min-h-(--hit-size) items-center font-semibold text-brand-text underline underline-offset-2"
          >
            {s.action}
          </Link>
        </div>
        <IconButton
          label={s.dismiss}
          icon={<X />}
          size="sm"
          onClick={() => patch({ orderSavePromptDismissed: true })}
        />
      </div>
    </Card>
  );
}
