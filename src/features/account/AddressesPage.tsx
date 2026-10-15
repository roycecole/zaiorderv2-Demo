// src/features/account/AddressesPage.tsx —— PG-12 地址簿：清單、新增 / 編輯（Sheet）、設為預設、刪除（需確認）
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { usePageTitle } from '@/app/layouts/pageTitle';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  SkeletonCard,
  useToast,
} from '@/components';
import { Sheet } from '@/components/overlay';
import { formatPhone } from '@/domain/format';
import type { Address } from '@/domain/types';
import { useAnnounce } from '@/features/a11y';
import { readApiError } from '@/features/auth/errorInfo';
import { useApi } from '@/hooks/useApi';
import { errorMessageOf } from '@/i18n/strings/errors';
import { t } from '@/i18n/zh-TW';
import { account as tAccount } from '@/i18n/strings/account';
import { qk } from '@/services/api/queryKeys';
import { AddressForm } from './AddressForm';
import type { AddressFormValues } from './AddressForm';

const s = tAccount.addresses;
const FORM_ID = 'address-form';

const addressFieldKeys: Record<keyof AddressFormValues, true> = {
  label: true,
  recipientName: true,
  recipientPhone: true,
  city: true,
  district: true,
  zipCode: true,
  line: true,
  note: true,
  isDefault: true,
};

type EditorState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; address: Address };

function AddressCard({
  address,
  onEdit,
  onSetDefault,
  onRemove,
  busy,
}: {
  address: Address;
  onEdit: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const titleId = `address-${address.id}`;
  return (
    <Card as="article" aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted">
          <MapPin className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="flex flex-wrap items-center gap-2 text-base leading-6 font-bold text-text">
            <span className="[overflow-wrap:anywhere]">{address.label}</span>
            {address.isDefault ? <Badge tone="brand">{s.default}</Badge> : null}
          </h2>
          <p className="text-sm leading-5 text-text-sub">
            {address.recipientName}・{formatPhone(address.recipientPhone)}
          </p>
          <p className="mt-1 text-base leading-6 text-text [overflow-wrap:anywhere]">
            {address.city}
            {address.district}
            {address.line}
          </p>
          {address.note !== undefined && address.note !== '' ? (
            <p className="text-sm leading-5 text-text-sub [overflow-wrap:anywhere]">
              {s.note(address.note)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          aria-label={s.editLabel(address.label)}
          leadingIcon={<Pencil aria-hidden="true" className="size-4" />}
          onClick={onEdit}
        >
          {s.edit}
        </Button>
        {!address.isDefault ? (
          <Button
            variant="ghost"
            aria-label={s.setDefaultLabel(address.label)}
            aria-disabled={busy ? true : undefined}
            onClick={onSetDefault}
          >
            {s.setDefault}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          aria-label={s.removeLabel(address.label)}
          leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
          onClick={onRemove}
        >
          <span className="text-danger">{s.remove}</span>
        </Button>
      </div>
    </Card>
  );
}

export function AddressesPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const announce = useAnnounce();
  usePageTitle(s.pageTitle);

  const [editor, setEditor] = useState<EditorState>({ mode: 'closed' });
  const [removing, setRemoving] = useState<Address | null>(null);
  const [serverErrors, setServerErrors] = useState<
    Partial<Record<keyof AddressFormValues, string>>
  >({});

  const list = useQuery({
    queryKey: qk.me.addresses(),
    queryFn: () => api.me.addresses.list(),
    staleTime: 30_000,
    retry: false,
  });
  const zones = useQuery({
    queryKey: qk.store.deliveryZones(),
    queryFn: () => api.store.getDeliveryZones(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: qk.me.addresses() });

  const save = useMutation({
    mutationFn: async (v: { values: AddressFormValues; id?: string }): Promise<Address> => {
      const { values, id } = v;
      if (id === undefined) {
        return api.me.addresses.create({
          label: values.label,
          recipientName: values.recipientName,
          recipientPhone: values.recipientPhone,
          city: values.city,
          district: values.district,
          zipCode: values.zipCode,
          line: values.line,
          isDefault: values.isDefault,
          ...(values.note !== '' ? { note: values.note } : {}),
        });
      }
      return api.me.addresses.update(id, {
        label: values.label,
        recipientName: values.recipientName,
        recipientPhone: values.recipientPhone,
        city: values.city,
        district: values.district,
        zipCode: values.zipCode,
        line: values.line,
        isDefault: values.isDefault,
        note: values.note, // 空字串 = 清除備註
      });
    },
    onSuccess: async () => {
      await invalidate();
      setEditor({ mode: 'closed' });
      setServerErrors({});
      toast({ message: s.saved, tone: 'success' });
      announce(s.saved);
    },
    onError: (e) => {
      const info = readApiError(e);
      const mapped: Partial<Record<keyof AddressFormValues, string>> = {};
      for (const d of info.details) {
        if (d.field !== undefined && Object.hasOwn(addressFieldKeys, d.field)) {
          mapped[d.field as keyof AddressFormValues] = d.message;
        }
      }
      if (Object.keys(mapped).length > 0) setServerErrors(mapped);
      else toast({ message: errorMessageOf(e, s.saveFailed), tone: 'error' });
    },
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => api.me.addresses.update(id, { isDefault: true }),
    onSuccess: async () => {
      await invalidate();
      toast({ message: s.defaultSet, tone: 'success' });
      announce(s.defaultSet);
    },
    onError: (e) => toast({ message: errorMessageOf(e, s.saveFailed), tone: 'error' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.me.addresses.remove(id),
    onSuccess: async () => {
      await invalidate();
      toast({ message: s.removed, tone: 'success' });
      announce(s.removed);
    },
    onError: (e) => toast({ message: errorMessageOf(e, s.removeFailed), tone: 'error' }),
  });

  const items = list.data?.items ?? [];
  const editing = editor.mode === 'edit' ? editor.address : undefined;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-4 md:py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold text-text">{s.pageTitle}</h1>
        <Button
          leadingIcon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => {
            setServerErrors({});
            setEditor({ mode: 'create' });
          }}
        >
          {s.add}
        </Button>
      </div>
      <p className="text-sm leading-5 text-text-sub">{s.intro}</p>

      {list.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span role="status" className="sr-only">
            {t.common.loading}
          </span>
          <SkeletonCard variant="list" />
          <SkeletonCard variant="list" />
        </div>
      ) : list.isError ? (
        <ErrorState
          title={s.loadFailed}
          message={errorMessageOf(list.error)}
          requestId={readApiError(list.error).requestId}
          onRetry={() => void list.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="📍"
          title={s.emptyTitle}
          description={s.emptyBody}
          action={
            <Button
              onClick={() => {
                setServerErrors({});
                setEditor({ mode: 'create' });
              }}
            >
              {s.add}
            </Button>
          }
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((address) => (
            <li key={address.id}>
              <AddressCard
                address={address}
                busy={setDefault.isPending}
                onEdit={() => {
                  setServerErrors({});
                  setEditor({ mode: 'edit', address });
                }}
                onSetDefault={() => setDefault.mutate(address.id)}
                onRemove={() => setRemoving(address)}
              />
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editor.mode !== 'closed'}
        onOpenChange={(open) => {
          if (!open) setEditor({ mode: 'closed' });
        }}
        placement="center"
        size="md"
        title={editor.mode === 'edit' ? s.form.editTitle : s.form.addTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor({ mode: 'closed' })}>
              {s.form.cancel}
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              fullWidth
              loading={save.isPending}
              loadingLabel={s.form.saving}
            >
              {s.form.save}
            </Button>
          </>
        }
      >
        {editor.mode !== 'closed' ? (
          <div className="mt-4">
            <AddressForm
              // 開啟與切換編輯對象時重新建立表單，確保預設值正確
              key={editing?.id ?? 'new'}
              formId={FORM_ID}
              address={editing}
              zones={zones.data?.items ?? []}
              serverErrors={serverErrors}
              onSubmit={async (values) => {
                setServerErrors({});
                try {
                  await save.mutateAsync(
                    editing !== undefined ? { values, id: editing.id } : { values },
                  );
                } catch {
                  // 錯誤已由 onError 呈現
                }
              }}
            />
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        tone="danger"
        title={s.removeDialog.title}
        description={removing !== null ? s.removeDialog.description(removing.label) : undefined}
        confirmLabel={s.removeDialog.confirm}
        onConfirm={async () => {
          if (removing === null) return;
          try {
            await remove.mutateAsync(removing.id);
          } catch {
            // 錯誤已由 onError 呈現
          }
        }}
      />
    </div>
  );
}
