// src/features/static/PrivacyPage.tsx —— 隱私權政策（PG-16；Demo 範例文字）
import { privacySections } from '@/i18n/strings/legal';
import { t } from '@/i18n/zh-TW';
import { LegalDocument } from './LegalDocument';

export function PrivacyPage() {
  const page = t.static.privacy;
  return <LegalDocument title={page.title} intro={page.intro} sections={privacySections} />;
}
