// src/features/static/TermsPage.tsx —— 服務條款（PG-16；Demo 範例文字）
import { termsSections } from '@/i18n/strings/legal';
import { t } from '@/i18n/zh-TW';
import { LegalDocument } from './LegalDocument';

export function TermsPage() {
  const page = t.static.terms;
  return <LegalDocument title={page.title} intro={page.intro} sections={termsSections} />;
}
