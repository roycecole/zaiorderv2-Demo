// src/features/menu/BannerCarousel.tsx —— 首頁 Banner（FR-ST-07）：手動切換，不自動輪播（WCAG 2.2.2）
// 可連結商品、分類或外部網址；圖片載入失敗時退為純文字卡，不出現破圖。
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components';
import type { Banner } from '@/domain/types';
import { t } from '@/i18n/zh-TW';

export interface BannerCarouselProps {
  banners: ReadonlyArray<Banner>;
  onOpenProduct: (productId: string) => void;
  onSelectCategory: (categoryId: string) => void;
}

function BannerSlide({
  banner,
  onOpenProduct,
  onSelectCategory,
}: { banner: Banner } & Pick<BannerCarouselProps, 'onOpenProduct' | 'onSelectCategory'>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = banner.imageUrl !== '' && failedUrl !== banner.imageUrl;

  // 圖片本身通常已含文案：載入成功時以 alt 提供名稱，不再疊加文字（避免重複）；載入失敗退為純文字卡
  const content = showImage ? (
    <img
      src={banner.imageUrl}
      alt={banner.title}
      decoding="async"
      draggable={false}
      onError={() => setFailedUrl(banner.imageUrl)}
      className="absolute inset-0 size-full object-cover"
    />
  ) : (
    <span className="absolute inset-0 grid place-items-center bg-brand-soft px-4 text-center text-base leading-6 font-semibold text-brand-text">
      {banner.title}
    </span>
  );
  const frame = 'relative block h-28 w-full overflow-hidden rounded-lg bg-bg-muted md:h-36';

  const linkValue = banner.linkValue ?? '';
  if (banner.linkType === 'PRODUCT' && linkValue !== '') {
    return (
      <button
        type="button"
        className={`${frame} text-left`}
        onClick={() => onOpenProduct(linkValue)}
      >
        {content}
      </button>
    );
  }
  if (banner.linkType === 'CATEGORY' && linkValue !== '') {
    return (
      <button
        type="button"
        className={`${frame} text-left`}
        onClick={() => onSelectCategory(linkValue)}
      >
        {content}
      </button>
    );
  }
  if (banner.linkType === 'URL' && /^https?:\/\//i.test(linkValue)) {
    return (
      <a href={linkValue} rel="noopener noreferrer" className={frame}>
        {content}
      </a>
    );
  }
  return <div className={frame}>{content}</div>;
}

export function BannerCarousel({ banners, onOpenProduct, onSelectCategory }: BannerCarouselProps) {
  const [index, setIndex] = useState(0);
  if (banners.length === 0) return null;
  const current = Math.min(index, banners.length - 1);
  const banner = banners[current];
  if (banner === undefined) return null;
  const many = banners.length > 1;

  return (
    <section
      aria-roledescription={t.menu.banner.roleDescription}
      aria-label={t.menu.banner.label}
      className="relative pt-4"
    >
      <BannerSlide
        banner={banner}
        onOpenProduct={onOpenProduct}
        onSelectCategory={onSelectCategory}
      />
      {many ? (
        <div className="mt-2 flex items-center justify-center gap-2">
          <IconButton
            size="sm"
            label={t.menu.banner.previous}
            icon={<ChevronLeft />}
            onClick={() => setIndex((current - 1 + banners.length) % banners.length)}
          />
          <span className="text-sm leading-5 text-text-sub tabular-nums">
            {t.menu.banner.position(current + 1, banners.length)}
          </span>
          <IconButton
            size="sm"
            label={t.menu.banner.next}
            icon={<ChevronRight />}
            onClick={() => setIndex((current + 1) % banners.length)}
          />
        </div>
      ) : null}
    </section>
  );
}
