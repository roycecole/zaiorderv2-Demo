// src/features/demo/sections/StockSection.tsx —— 庫存與時段情境（FR-DM-12；觸控面板模式不顯示）
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Select, Switch, TextField, useToast } from '@/components';
import type { ID, ISODateTime } from '@/domain/types';
import { formatTime } from '@/domain/format';
import { useMenu } from '@/features/store/queries';
import { useApi } from '@/hooks/useApi';
import { demo as tDemo } from '@/i18n/strings/demo';
import { errorMessageOf } from '@/i18n/strings/errors';
import { qk } from '@/services/api/queryKeys';
import type { RaceOnNextCreate, StockSnapshot } from '@/services/api/mock/demoControl';
import { DEFAULT_STOCK_PRODUCT_ID } from '../constants';
import { useDemoContext } from '../DemoContext';
import { ChoiceGroup, parseIntInRange, SubGroup } from '../parts';

interface ProductOption {
  id: ID;
  name: string;
  category: string;
}

type RaceKind = 'SOLD_OUT' | 'BUY' | 'SLOT_FULL';

const RACE_CHOICES: ReadonlyArray<{ value: RaceKind; label: string }> = [
  { value: 'SOLD_OUT', label: tDemo.stock.raceSoldOut },
  { value: 'BUY', label: tDemo.stock.raceBuy },
  { value: 'SLOT_FULL', label: tDemo.stock.raceSlotFull },
];

const INJECT_CHOICES = [
  { value: 'ACCEPTED', label: tDemo.stock.injectAccepted },
  { value: 'PENDING_PAYMENT', label: tDemo.stock.injectPending },
] as const;

export function StockSection() {
  const { demo, state, revision, patchState, afterWrite } = useDemoContext();
  const api = useApi();
  const { toast } = useToast();
  const menu = useMenu();

  const products = useMemo<ProductOption[]>(
    () =>
      menu.data?.categories.flatMap((c) =>
        c.products.map((p) => ({ id: p.id, name: p.name, category: c.name })),
      ) ?? [],
    [menu.data],
  );
  const [pickedProduct, setPickedProduct] = useState('');
  const productId =
    products.find((p) => p.id === pickedProduct)?.id ??
    products.find((p) => p.id === DEFAULT_STOCK_PRODUCT_ID)?.id ??
    products[0]?.id ??
    '';
  const nameOf = (id: ID): string => products.find((p) => p.id === id)?.name ?? id;

  // 庫存讀數：DemoControl 沒有訂閱機制，依面板輪詢版號重讀（revision 變化即重新計算）
  const stock = useMemo<StockSnapshot | null>(() => {
    if (productId === '') return null;
    try {
      return demo.getStock(productId);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision 與 state 只用來觸發重讀
  }, [demo, productId, revision, state]);

  const fail = (error: unknown): void => {
    toast({ message: errorMessageOf(error, tDemo.stock.failed), tone: 'error' });
  };

  // ── 預約時段（供「時段額滿」預備與「讓此時段額滿」共用）──
  const slots = useQuery({
    queryKey: qk.store.pickupSlots('PICKUP'),
    queryFn: () => api.store.getPickupSlots({ orderType: 'PICKUP' }),
    staleTime: 30_000,
  });
  const days = slots.data?.days ?? [];
  const [pickedDay, setPickedDay] = useState('');
  const [pickedSlot, setPickedSlot] = useState('');
  const day = days.find((d) => d.date === pickedDay) ?? days[0];
  const slot =
    day?.slots.find((s) => s.startAt === pickedSlot) ??
    day?.slots.find((s) => s.status === 'AVAILABLE') ??
    day?.slots[0];

  return (
    <>
      <Select
        label={tDemo.stock.product}
        value={productId}
        onChange={(e) => setPickedProduct(e.target.value)}
        disabled={products.length === 0}
      >
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <p className="text-sm leading-5 font-semibold text-text" aria-live="polite">
        {stock === null
          ? tDemo.stock.readingUnavailable
          : stock.dailyLimit === null
            ? tDemo.stock.readingNoLimit(stock.sold, stock.held)
            : tDemo.stock.reading(stock.dailyLimit, stock.sold, stock.held, stock.remaining ?? 0)}
      </p>

      {productId !== '' ? (
        <>
          <LimitControls
            key={`limit-${productId}`}
            productId={productId}
            current={stock?.dailyLimit ?? null}
            onSetRemaining={(n) => {
              demo.setRemaining(productId, n);
              afterWrite();
            }}
            onSetLimit={(limit) => {
              demo.setLimit(productId, limit);
              afterWrite();
            }}
            onRestore={() => {
              const rest = { ...state.limitOverrides };
              delete rest[productId];
              patchState({ limitOverrides: rest });
            }}
          />
          <ManualControls
            key={`manual-${productId}`}
            soldOut={state.soldOutProductIds.includes(productId)}
            price={state.priceOverrides[productId]}
            onSoldOut={(on) =>
              patchState({
                soldOutProductIds: on
                  ? [...state.soldOutProductIds, productId]
                  : state.soldOutProductIds.filter((id) => id !== productId),
              })
            }
            onPrice={(price) => {
              const next = { ...state.priceOverrides };
              if (price === null) delete next[productId];
              else next[productId] = price;
              patchState({ priceOverrides: next });
            }}
          />
          <SubGroup legend={tDemo.stock.injectLegend}>
            <InjectControls
              onInject={async (quantity, status) => {
                try {
                  const { added } = await demo.injectOtherOrder({ productId, quantity, status });
                  toast({
                    message:
                      added === 0
                        ? tDemo.stock.injectNone
                        : added < quantity
                          ? tDemo.stock.injectClamped(added, quantity)
                          : tDemo.stock.injectDone(added),
                    tone: added === 0 ? 'warning' : 'success',
                  });
                } catch (error) {
                  fail(error);
                } finally {
                  afterWrite();
                }
              }}
            />
          </SubGroup>
          <SubGroup legend={tDemo.stock.raceLegend}>
            <RaceControls
              productId={productId}
              slotStartAt={slot?.startAt ?? null}
              race={state.raceOnNextCreate}
              nameOf={nameOf}
              onArm={(next) => {
                demo.armRace(next);
                afterWrite();
              }}
              onDisarm={() => {
                demo.disarmRace();
                afterWrite();
              }}
            />
          </SubGroup>
        </>
      ) : null}

      <SubGroup legend={tDemo.stock.slotLegend}>
        {days.length === 0 ? (
          <p className="text-sm leading-5 text-text-muted">{tDemo.stock.slotNone}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Select
                label={tDemo.stock.slotDay}
                value={day?.date ?? ''}
                onChange={(e) => {
                  setPickedDay(e.target.value);
                  setPickedSlot('');
                }}
                options={days.map((d) => ({ value: d.date, label: d.label }))}
              />
              <Select
                label={tDemo.stock.slotTime}
                value={slot?.startAt ?? ''}
                onChange={(e) => setPickedSlot(e.target.value)}
                options={(day?.slots ?? []).map((s) => ({
                  value: s.startAt,
                  label: `${formatTime(s.startAt)}${s.status === 'FULL' ? `（${tDemo.stock.slotFull}）` : ''}`,
                }))}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {([0, 1] as const).map((leave) => (
                <Button
                  key={leave}
                  variant="secondary"
                  aria-disabled={slot === undefined}
                  onClick={async () => {
                    if (slot === undefined) return;
                    try {
                      const { added } = await demo.fillSlot(slot.startAt, leave);
                      toast({
                        message:
                          added > 0 ? tDemo.stock.slotDone(added) : tDemo.stock.slotAlready,
                        tone: added > 0 ? 'success' : 'info',
                      });
                    } catch (error) {
                      fail(error);
                    } finally {
                      afterWrite();
                    }
                  }}
                >
                  {leave === 0 ? tDemo.stock.slotFillFull : tDemo.stock.slotLeaveOne}
                </Button>
              ))}
            </div>
          </>
        )}
        <div>
          <Button
            variant="ghost"
            onClick={() => {
              try {
                const n = demo.clearOtherOrders();
                toast({ message: tDemo.stock.clearedOthers(n), tone: n > 0 ? 'success' : 'info' });
              } catch (error) {
                fail(error);
              } finally {
                afterWrite();
              }
            }}
          >
            {tDemo.stock.clearOthers}
          </Button>
        </div>
      </SubGroup>
    </>
  );
}

// ── 每日限量 ──────────────────────────────────────────────────────

interface LimitControlsProps {
  productId: ID;
  current: number | null;
  onSetRemaining(n: number): void;
  onSetLimit(limit: number | null): void;
  onRestore(): void;
}

function LimitControls({ current, onSetRemaining, onSetLimit, onRestore }: LimitControlsProps) {
  const [input, setInput] = useState(current === null ? '' : String(current));
  const [error, setError] = useState<string | null>(null);

  const apply = (): void => {
    const text = input.trim();
    if (text === '') {
      setError(null);
      onSetLimit(null);
      return;
    }
    const n = parseIntInRange(text, 0, 999);
    if (n === null) {
      setError(tDemo.stock.limitError);
      return;
    }
    setError(null);
    onSetLimit(n);
  };

  return (
    <SubGroup legend={tDemo.stock.limitLegend}>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onSetRemaining(1)}>
          {tDemo.stock.remaining1}
        </Button>
        <Button variant="secondary" onClick={() => onSetRemaining(2)}>
          {tDemo.stock.remaining2}
        </Button>
        <Button variant="secondary" onClick={() => onSetRemaining(0)}>
          {tDemo.stock.soldOutLimit}
        </Button>
        <Button variant="ghost" onClick={onRestore}>
          {tDemo.stock.restore}
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <TextField
          containerClassName="flex-1"
          label={tDemo.stock.limitInput}
          hint={tDemo.stock.limitHint}
          inputMode="numeric"
          value={input}
          error={error}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
        />
        <Button variant="secondary" className="mt-7" onClick={apply}>
          {tDemo.stock.limitApply}
        </Button>
      </div>
    </SubGroup>
  );
}

// ── 手動售完與調價 ────────────────────────────────────────────────

interface ManualControlsProps {
  soldOut: boolean;
  price: number | undefined;
  onSoldOut(on: boolean): void;
  onPrice(price: number | null): void;
}

function ManualControls({ soldOut, price, onSoldOut, onPrice }: ManualControlsProps) {
  const [input, setInput] = useState(price === undefined ? '' : String(price));
  const [error, setError] = useState<string | null>(null);

  return (
    <SubGroup legend={tDemo.stock.manualLegend}>
      <Switch label={tDemo.stock.manualSoldOut} checked={soldOut} onCheckedChange={onSoldOut} />
      <div className="flex items-start gap-2">
        <TextField
          containerClassName="flex-1"
          label={tDemo.stock.priceLabel}
          inputMode="numeric"
          value={input}
          error={error}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
        />
        <Button
          variant="secondary"
          className="mt-7"
          onClick={() => {
            const n = parseIntInRange(input, 0, 100_000);
            if (n === null) {
              setError(tDemo.stock.priceError);
              return;
            }
            onPrice(n);
          }}
        >
          {tDemo.stock.priceApply}
        </Button>
      </div>
      {price !== undefined ? (
        <Button
          variant="ghost"
          onClick={() => {
            setInput('');
            setError(null);
            onPrice(null);
          }}
        >
          {tDemo.stock.priceRestore}
        </Button>
      ) : null}
    </SubGroup>
  );
}

// ── 模擬他人下單 ──────────────────────────────────────────────────

function InjectControls({
  onInject,
}: {
  onInject(quantity: number, status: 'ACCEPTED' | 'PENDING_PAYMENT'): Promise<void>;
}) {
  const [qty, setQty] = useState('1');
  const [status, setStatus] = useState<'ACCEPTED' | 'PENDING_PAYMENT'>('ACCEPTED');
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <TextField
        label={tDemo.stock.injectQty}
        inputMode="numeric"
        value={qty}
        error={error}
        onChange={(e) => {
          setQty(e.target.value);
          setError(null);
        }}
      />
      <ChoiceGroup
        legend={tDemo.stock.injectStatus}
        choices={INJECT_CHOICES}
        value={status}
        onChange={setStatus}
      />
      <Button
        variant="secondary"
        onClick={async () => {
          const n = parseIntInRange(qty, 1, 20);
          if (n === null) {
            setError(tDemo.stock.qtyError);
            return;
          }
          await onInject(n, status);
        }}
      >
        {tDemo.stock.injectButton}
      </Button>
    </>
  );
}

// ── 下一次送出前才發生 ────────────────────────────────────────────

interface RaceControlsProps {
  productId: ID;
  slotStartAt: ISODateTime | null;
  race: RaceOnNextCreate | null;
  nameOf(id: ID): string;
  onArm(next: RaceOnNextCreate): void;
  onDisarm(): void;
}

function RaceControls({
  productId,
  slotStartAt,
  race,
  nameOf,
  onArm,
  onDisarm,
}: RaceControlsProps) {
  const [kind, setKind] = useState<RaceKind>('SOLD_OUT');
  const [qty, setQty] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const arm = (): void => {
    const next: RaceOnNextCreate = {
      soldOutProductIds: [...(race?.soldOutProductIds ?? [])],
      buy: [...(race?.buy ?? [])],
      fillSlots: [...(race?.fillSlots ?? [])],
    };
    if (kind === 'SOLD_OUT') {
      if (!next.soldOutProductIds?.includes(productId)) next.soldOutProductIds?.push(productId);
    } else if (kind === 'BUY') {
      const n = parseIntInRange(qty, 1, 20);
      if (n === null) {
        setError(tDemo.stock.qtyError);
        return;
      }
      next.buy = [
        ...(next.buy ?? []).filter((b) => b.productId !== productId),
        { productId, quantity: n },
      ];
    } else {
      if (slotStartAt === null) {
        setError(tDemo.stock.raceNeedSlot);
        return;
      }
      next.fillSlots = [
        ...(next.fillSlots ?? []).filter((s) => s.startAt !== slotStartAt),
        { startAt: slotStartAt, leave: 0 },
      ];
    }
    setError(null);
    onArm(next);
  };

  const armed: string[] = [];
  for (const id of race?.soldOutProductIds ?? [])
    armed.push(tDemo.stock.raceArmedSoldOut(nameOf(id)));
  for (const b of race?.buy ?? [])
    armed.push(tDemo.stock.raceArmedBuy(nameOf(b.productId), b.quantity));
  for (const s of race?.fillSlots ?? []) {
    armed.push(tDemo.stock.raceArmedSlot(formatTime(s.startAt), s.leave));
  }

  return (
    <>
      <ChoiceGroup
        legend={tDemo.stock.raceKind}
        choices={RACE_CHOICES}
        value={kind}
        onChange={(next) => {
          setKind(next);
          setError(null);
        }}
      />
      {kind === 'BUY' ? (
        <TextField
          label={tDemo.stock.raceBuyQty}
          inputMode="numeric"
          value={qty}
          error={error}
          onChange={(e) => {
            setQty(e.target.value);
            setError(null);
          }}
        />
      ) : error !== null ? (
        <p role="alert" className="text-sm leading-5 font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={arm}>
          {tDemo.stock.raceArm}
        </Button>
        {armed.length > 0 ? (
          <Button variant="ghost" onClick={onDisarm}>
            {tDemo.stock.raceDisarm}
          </Button>
        ) : null}
      </div>
      <div aria-live="polite">
        {armed.length === 0 ? (
          <p className="text-sm leading-5 text-text-muted">{tDemo.stock.raceNone}</p>
        ) : (
          <>
            <p className="text-sm leading-5 font-semibold text-text">
              {tDemo.stock.raceArmedTitle}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm leading-5 text-text-sub">
              {armed.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
