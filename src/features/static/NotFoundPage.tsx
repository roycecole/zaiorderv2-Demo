// src/features/static/NotFoundPage.tsx —— 404（PG-17）：插圖 + 「找不到這個頁面」+「回到菜單」
import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { LinkButton } from '@/components';
import { ROUTES } from '@/app/routes';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { t } from '@/i18n/zh-TW';

export function NotFoundPage() {
  const s = t.static.notFound;
  usePageTitle(s.pageTitle);
  return (
    <section className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 px-6 py-16 text-center">
      <div
        aria-hidden="true"
        className="grid size-20 place-items-center rounded-full bg-bg-muted text-text-muted"
      >
        <SearchX className="size-10" />
      </div>
      <h1 id="not-found-title" tabIndex={-1} className="text-h1 font-bold text-text">
        {s.title}
      </h1>
      <p className="max-w-prose text-base leading-6 text-text-sub">{s.message}</p>
      <LinkButton as={Link} to={ROUTES.home} variant="primary" size="lg" className="mt-3">
        {s.backToMenu}
      </LinkButton>
    </section>
  );
}
