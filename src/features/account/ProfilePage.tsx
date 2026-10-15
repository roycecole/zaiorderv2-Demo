// src/features/account/ProfilePage.tsx —— PG-11 個人資料：姓名（VR-02）、Email、行銷同意；手機為唯讀（需客服變更）
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { usePageTitle } from '@/app/layouts/pageTitle';
import { Button, Checkbox, ErrorState, Skeleton, TextField, useToast } from '@/components';
import { formatPhone } from '@/domain/format';
import type { UserProfile } from '@/domain/types';
import { useAnnounce } from '@/features/a11y';
import { readApiError } from '@/features/auth/errorInfo';
import { useSessionStore } from '@/features/auth/sessionStore';
import { useApi } from '@/hooks/useApi';
import { errorMessageOf } from '@/i18n/strings/errors';
import { account as tAccount } from '@/i18n/strings/account';
import { qk } from '@/services/api/queryKeys';

const s = tAccount.profile;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 20;

const profileSchema = z.object({
  /** 空字串 = 未設定姓名；有值時 VR-02：1～20 字（去除前後空白） */
  name: z.string().trim().max(NAME_MAX, s.nameInvalid),
  email: z
    .string()
    .trim()
    .max(100, s.emailInvalid)
    .refine((v) => v === '' || EMAIL_RE.test(v), s.emailInvalid),
  marketingOptIn: z.boolean(),
});

type ProfileValues = z.infer<typeof profileSchema>;

function ProfileForm({ profile }: { profile: UserProfile }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const announce = useAnnounce();

  const {
    register,
    handleSubmit,
    setError,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: profile.name ?? '',
      email: profile.email ?? '',
      marketingOptIn: profile.marketingOptIn,
    },
    mode: 'onBlur',
  });
  const nameLength = useWatch({ control, name: 'name' }).trim().length;

  const onSubmit = async (values: ProfileValues): Promise<void> => {
    const hadName = profile.name !== undefined && profile.name !== '';
    if (hadName && values.name === '') {
      setError('name', { message: s.nameInvalid });
      return;
    }

    const patch: Partial<Pick<UserProfile, 'name' | 'email' | 'marketingOptIn'>> = {};
    if (values.name !== (profile.name ?? '')) patch.name = values.name;
    if (values.email !== (profile.email ?? '')) patch.email = values.email; // 空字串 = 清除
    if (values.marketingOptIn !== profile.marketingOptIn) patch.marketingOptIn = values.marketingOptIn;

    try {
      const updated =
        Object.keys(patch).length === 0 ? profile : await api.me.update(patch);
      useSessionStore.getState().setUser(updated);
      queryClient.setQueryData(qk.me.profile(), updated);
      reset({
        name: updated.name ?? '',
        email: updated.email ?? '',
        marketingOptIn: updated.marketingOptIn,
      });
      toast({ message: s.saved, tone: 'success' });
      announce(s.saved);
    } catch (e) {
      const info = readApiError(e);
      let handled = false;
      for (const d of info.details) {
        if (d.field === 'name' || d.field === 'email') {
          setError(d.field, { message: d.message });
          handled = true;
        }
      }
      if (!handled) toast({ message: errorMessageOf(e, s.saveFailed), tone: 'error' });
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      noValidate
      className="flex flex-col gap-5"
    >
      <TextField
        label={s.phoneLabel}
        hint={s.phoneHint}
        type="tel"
        readOnly
        value={formatPhone(profile.phone)}
        autoComplete="tel"
      />
      <TextField
        label={s.nameLabel}
        autoComplete="name"
        enterKeyHint="next"
        counter={{ current: nameLength, max: NAME_MAX }}
        error={errors.name?.message}
        {...register('name')}
      />
      <TextField
        label={s.emailLabel}
        hint={s.emailHint}
        optional
        type="email"
        inputMode="email"
        autoComplete="email"
        enterKeyHint="done"
        error={errors.email?.message}
        {...register('email')}
      />
      <Checkbox label={s.marketing} {...register('marketingOptIn')} />
      <Button type="submit" size="lg" fullWidth loading={isSubmitting} loadingLabel={s.saving}>
        {s.save}
      </Button>
    </form>
  );
}

export function ProfilePage() {
  const api = useApi();
  usePageTitle(s.pageTitle);
  const sessionUser = useSessionStore((st) => st.user);
  const query = useQuery({
    queryKey: qk.me.profile(),
    queryFn: () => api.me.get(),
    enabled: sessionUser !== null,
    staleTime: 30_000,
    retry: false,
  });
  const profile = query.data ?? sessionUser;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-4 md:py-6">
      <h1 className="text-h1 font-bold text-text">{s.pageTitle}</h1>
      {profile !== null ? (
        <ProfileForm key={profile.id} profile={profile} />
      ) : query.isError ? (
        <ErrorState
          title={s.loadFailed}
          message={errorMessageOf(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      )}
    </div>
  );
}
