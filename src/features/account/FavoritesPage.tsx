// src/features/account/FavoritesPage.tsx —— PG-13 我的最愛
//
// `me.favorites`（只有商品 ID）搭配菜單的品名 / 價格 / 圖片顯示；可直接加入購物車或取消收藏。
// 售完者以灰階標示並停用加入；已下架（不在菜單內）者只提供取消收藏。含必選選項的商品改為前往商品面板選擇。
import { Heart, ShoppingBag } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { ROUTES } from '@/app/routes';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ImageOrPlaceholder,
  LinkButton,
  Price,
  SkeletonCard,
  buttonClassName,
  useToast,
} from '@/components';
import { MAX_QTY_PER_LINE } from '@/domain/cart';
import type { ID, ProductSummary } from '@/domain/types';
import { useAnnounce } from '@/features/a11y';
import { useCartStore } from '@/features/cart/cartStore';
import { useMenu } from '@/features/store/queries';
import { errorMessageOf } from '@/i18n/strings/errors';
import { t } from '@/i18n/zh-TW';
import { account as tAccount } from '@/i18n/strings/account';
import { useFavorites } from './useFavorites';

const s = tAccount.favorites;

interface MenuEntry {
  product: ProductSummary;
  icon: string | undefined;
}

function FavoriteCard({
  productId,
  entry,
  onAdd,
  onRemove,
}: {
  productId: ID;
  entry: MenuEntry | undefined;
  onAdd: (product: ProductSummary) => void;
  onRemove: (productId: ID, name: string) => void;
}) {
  const product = entry?.product;
  const name = product?.name ?? s.unlisted;
  const unavailable = product === undefined || product.isSoldOut;
  const titleId = `favorite-${productId}`;

  return (
    <Card
      as="article"
      aria-labelledby={titleId}
      tone={unavailable ? 'subtle' : 'default'}
      className="flex items-start gap-3"
    >
      {product !== undefined ? (
        <ImageOrPlaceholder
          media={product.imageUrl !== undefined ? 'THUMB' : 'NONE'}
          imageUrl={product.imageUrl}
          name={product.name}
          icon={entry?.icon}
          alt=""
          className={product.isSoldOut ? 'grayscale' : undefined}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <h2
            id={titleId}
            className={
              unavailable
                ? 'text-base leading-6 font-bold text-text-muted [overflow-wrap:anywhere]'
                : 'text-base leading-6 font-bold text-text [overflow-wrap:anywhere]'
            }
          >
            {name}
          </h2>
          {product?.description !== undefined && product.description !== '' ? (
            <p className="line-clamp-2 text-sm leading-5 text-text-sub">{product.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {product !== undefined ? (
            <Price
              amount={product.displayPrice}
              from={product.isPriceFrom}
              tone={product.isSoldOut ? 'muted' : 'default'}
            />
          ) : null}
          {product === undefined ? <Badge tone="neutral">{s.unlisted}</Badge> : null}
          {product?.isSoldOut === true ? <Badge tone="inverse">{s.soldOut}</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {product !== undefined && !product.isSoldOut ? (
            product.hasRequiredOptions ? (
              <Link
                to={`${ROUTES.home}?product=${encodeURIComponent(product.id)}`}
                aria-label={s.chooseOptionsLabel(product.name)}
                className={buttonClassName({ variant: 'primary' })}
              >
                <ShoppingBag aria-hidden="true" className="size-4" />
                {s.chooseOptions}
              </Link>
            ) : (
              <Button
                aria-label={s.addToCartLabel(product.name)}
                leadingIcon={<ShoppingBag aria-hidden="true" className="size-4" />}
                onClick={() => onAdd(product)}
              >
                {s.addToCart}
              </Button>
            )
          ) : null}
          <Button
            variant="ghost"
            aria-label={s.removeLabel(name)}
            leadingIcon={<Heart aria-hidden="true" className="size-4 fill-current" />}
            onClick={() => onRemove(productId, name)}
          >
            {s.remove}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function FavoritesPage() {
  const favorites = useFavorites();
  const menu = useMenu();
  const { toast } = useToast();
  const announce = useAnnounce();
  usePageTitle(s.pageTitle);

  const entries = useMemo(() => {
    const map = new Map<ID, MenuEntry>();
    for (const c of menu.data?.categories ?? []) {
      for (const p of c.products) map.set(p.id, { product: p, icon: c.icon });
    }
    return map;
  }, [menu.data]);

  const addToCart = (product: ProductSummary): void => {
    const cart = useCartStore.getState();
    const room = cart.maxAddableFor(product.id, product.remainingToday);
    if (room < 1) {
      const message =
        typeof product.remainingToday === 'number'
          ? t.common.maxReachedToday(product.remainingToday)
          : t.common.maxQuantityReached(MAX_QTY_PER_LINE);
      toast({ message, tone: 'warning' });
      return;
    }
    const ok = cart.addLine({
      productId: product.id,
      quantity: 1,
      optionIds: [],
      snapshot: {
        name: product.name,
        unitPrice: product.basePrice,
        optionLabels: [],
        ...(product.imageUrl !== undefined ? { imageUrl: product.imageUrl } : {}),
      },
    });
    if (!ok) {
      toast({ message: s.cartLimit, tone: 'warning' });
      return;
    }
    toast({ message: s.added(product.name), tone: 'success' });
    announce(s.added(product.name));
  };

  const removeFavorite = async (productId: ID, name: string): Promise<void> => {
    await favorites.toggle(productId);
    announce(s.removed(name));
  };

  const loading = favorites.isLoading || (menu.isPending && favorites.productIds.size > 0);
  const failed = favorites.isError || (menu.isError && menu.data === undefined);
  const ids = [...favorites.productIds];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-4 md:py-6">
      <h1 className="text-h1 font-bold text-text">{s.pageTitle}</h1>

      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span role="status" className="sr-only">
            {t.common.loading}
          </span>
          <SkeletonCard variant="list" />
          <SkeletonCard variant="list" />
        </div>
      ) : failed ? (
        <ErrorState
          title={s.loadFailed}
          message={errorMessageOf(favorites.isError ? undefined : menu.error)}
          onRetry={() => {
            void favorites.refetch();
            void menu.refetch();
          }}
        />
      ) : ids.length === 0 ? (
        <EmptyState
          icon="♡"
          title={s.emptyTitle}
          description={s.emptyBody}
          action={
            <LinkButton as={Link} to={ROUTES.home}>
              {s.emptyAction}
            </LinkButton>
          }
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {ids.map((id) => (
            <li key={id}>
              <FavoriteCard
                productId={id}
                entry={entries.get(id)}
                onAdd={addToCart}
                onRemove={(pid, name) => void removeFavorite(pid, name)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
