// src/features/store/AnnouncementBanner.tsx —— 店家公告橫幅（可關閉並記住；prefs.dismissedAnnouncement）
import { InlineAlert } from '@/components';
import { usePrefsStore } from '@/features/prefs/prefsStore';
import { t } from '@/i18n/zh-TW';
import { useStoreInfo } from './queries';

/** 以公告文字雜湊識別（內容更新後會再次顯示）；djb2，僅用於比對、不含個資 */
export function announcementId(text: string): string {
  let hash = 5381;
  for (const ch of text) hash = ((hash << 5) + hash + (ch.codePointAt(0) ?? 0)) | 0;
  return `a${(hash >>> 0).toString(36)}`;
}

export interface AnnouncementBannerProps {
  className?: string;
}

export function AnnouncementBanner({ className }: AnnouncementBannerProps) {
  const { data } = useStoreInfo();
  const dismissed = usePrefsStore((s) => s.dismissedAnnouncement);
  const patch = usePrefsStore((s) => s.patch);

  const text = data?.announcement?.trim();
  if (text === undefined || text.length === 0) return null;
  const id = announcementId(text);
  if (dismissed === id) return null;

  return (
    <section aria-label={t.store.announcement.region} className={className}>
      <InlineAlert
        tone="info"
        onDismiss={() => patch({ dismissedAnnouncement: id })}
        dismissLabel={t.store.announcement.dismiss}
        className="max-w-[65ch]"
      >
        {text}
      </InlineAlert>
    </section>
  );
}
