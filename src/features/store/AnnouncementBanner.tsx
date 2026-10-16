// src/features/store/AnnouncementBanner.tsx —— 店家公告橫幅（FR-ST-04：可關閉，當日不再顯示、隔日再次出現）
//
// 只放在首頁（店家門面），與整頁內容一起出現（MenuPage 的 settled），不會事後把已顯示的內容往下推（CLS）。
import { InlineAlert } from '@/components';
import { formatDate } from '@/domain/format';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { useClockNow } from '@/hooks/useClockNow';
import { t } from '@/i18n/zh-TW';
import { useStoreInfo } from './queries';

/** 以公告文字雜湊識別（內容更新後會再次顯示）；djb2，僅用於比對、不含個資 */
export function announcementId(text: string): string {
  let hash = 5381;
  for (const ch of text) hash = ((hash << 5) + hash + (ch.codePointAt(0) ?? 0)) | 0;
  return `a${(hash >>> 0).toString(36)}`;
}

/** 關閉紀錄：公告 + 營業日（店家時區）。隔天日期不同，公告會再次出現（FR-ST-04） */
export function announcementDismissKey(text: string, today: string): string {
  return `${announcementId(text)}@${today}`;
}

export interface AnnouncementBannerProps {
  className?: string;
}

export function AnnouncementBanner({ className }: AnnouncementBannerProps) {
  const { data } = useStoreInfo();
  const dismissed = usePrefsStore((s) => s.dismissedAnnouncement);
  const patch = usePrefsStore((s) => s.patch);
  const today = formatDate(useClockNow(60_000));

  const text = data?.announcement?.trim() ?? '';
  const key = text === '' ? null : announcementDismissKey(text, today);
  const visible = key !== null && dismissed !== key;

  if (!visible || key === null) return null;

  return (
    <section aria-label={t.store.announcement.region} className={className}>
      <InlineAlert
        tone="info"
        onDismiss={() => patch({ dismissedAnnouncement: key })}
        dismissLabel={t.store.announcement.dismiss}
        className="max-w-[65ch]"
      >
        {text}
      </InlineAlert>
    </section>
  );
}
