// src/features/static/LegalDocument.tsx —— 隱私權政策 / 服務條款共用版型（PG-16）
// 長文行寬 ≤ 65ch（03 §5.3）；每頁一個 h1、章節為 h2；Demo 內容明確標示為示範用。
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { InlineAlert } from '@/components';
import { ROUTES } from '@/app/routes';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { t } from '@/i18n/zh-TW';
import type { LegalSection } from '@/i18n/strings/legal';

export interface LegalDocumentProps {
  title: string;
  intro: string;
  sections: readonly LegalSection[];
}

export function LegalDocument({ title, intro, sections }: LegalDocumentProps) {
  usePageTitle(title);
  const s = t.static.common;
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <Link
        to={ROUTES.home}
        className="hit-area inline-flex min-h-(--hit-size) items-center gap-2 text-base font-semibold text-brand-text underline underline-offset-4"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
        {s.backToMenu}
      </Link>

      <h1 id="legal-title" tabIndex={-1} className="mt-2 text-h1 font-bold text-text">
        {title}
      </h1>
      <p className="mt-2 max-w-[65ch] text-base leading-6 text-text-sub">{intro}</p>

      <InlineAlert tone="warning" title={s.demoNoticeTitle} className="mt-4 max-w-[65ch]">
        {s.demoNotice}
      </InlineAlert>

      <nav aria-label={s.sections} className="mt-6 max-w-[65ch]">
        <ul className="m-0 list-none space-y-1 p-0 text-sm leading-5">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#legal-${section.id}`}
                onClick={(event) => {
                  // 不改變網址 hash：HashRouter 會把它當成路由
                  event.preventDefault();
                  const target = document.getElementById(`legal-${section.id}`);
                  target?.focus();
                  if (typeof target?.scrollIntoView === 'function') {
                    target.scrollIntoView({ block: 'start' });
                  }
                }}
                className="inline-flex min-h-(--hit-size) items-center text-brand-text underline underline-offset-4"
              >
                {section.heading}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 max-w-[65ch] space-y-6">
        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`legal-${section.id}`}>
            <h2
              id={`legal-${section.id}`}
              tabIndex={-1}
              className="mb-2 text-h2 font-bold text-text"
            >
              {section.heading}
            </h2>
            {section.paragraphs?.map((p) => (
              <p key={p} className="mb-2 text-base leading-7 text-text">
                {p}
              </p>
            ))}
            {section.items !== undefined ? (
              <ul className="m-0 list-disc space-y-1 pl-6 text-base leading-7 text-text">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}
