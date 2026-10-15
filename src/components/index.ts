// src/components/index.ts —— 通用 UI 元件統一匯出（features 只能由此引用，不得深入 components 內部檔案）
export { Badge, ProductTagBadge } from './Badge';
export type { BadgeProps, BadgeTone, ProductTagBadgeProps } from './Badge';

export { Button, LinkButton, buttonClassName } from './Button';
export type {
  ButtonProps,
  ButtonSize,
  ButtonStyleOptions,
  ButtonVariant,
  LinkButtonProps,
} from './Button';

export { Card } from './Card';
export type { CardProps } from './Card';

export { Checkbox, Switch } from './Checkbox';
export type { CheckboxProps, SwitchProps } from './Checkbox';

export { CheckboxCard, CheckboxGroup } from './CheckboxGroup';
export type { CheckboxCardProps, CheckboxGroupProps } from './CheckboxGroup';

export { Chip } from './Chip';
export type { ChipProps } from './Chip';

export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';

export { Dialog, preloadDialog } from './Dialog';
export type { DialogProps } from './Dialog';
// Sheet、DialogTitle / DialogDescription 等浮層內容元件改由 '@/components/overlay' 匯出（見該檔說明）

export { Divider } from './Divider';
export type { DividerProps } from './Divider';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { ErrorState } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';

export { IconButton, iconButtonClassName } from './IconButton';
export type { IconButtonProps, IconButtonStyleOptions } from './IconButton';

export { ImageOrPlaceholder } from './ImageOrPlaceholder';
export type { ImageOrPlaceholderProps } from './ImageOrPlaceholder';

export { InlineAlert } from './InlineAlert';
export type { InlineAlertProps, InlineAlertTone } from './InlineAlert';

export { LazyOverlay, createOverlayLoader } from './lazyOverlay';
export type { LazyOverlayProps, OverlayLoader } from './lazyOverlay';

export { Kbd } from './Kbd';
export type { KbdProps } from './Kbd';

export { KeyHintBadge } from './KeyHintBadge';
export type { KeyHintBadgeProps } from './KeyHintBadge';

export { Price, formatPriceDelta } from './Price';
export type { PriceProps } from './Price';

export { RadioCard, RadioGroup } from './RadioGroup';
export type { RadioCardProps, RadioGroupProps } from './RadioGroup';

export { Select } from './Select';
export type { SelectOption, SelectProps } from './Select';

export { Skeleton } from './Skeleton';
export type { SkeletonProps } from './Skeleton';

export { SkeletonCard } from './SkeletonCard';
export type { SkeletonCardProps } from './SkeletonCard';

export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';

export { Stepper } from './Stepper';
export type { StepperProps } from './Stepper';

export { TextArea } from './TextArea';
export type { TextAreaProps } from './TextArea';

export { TextField } from './TextField';
export type { TextFieldProps } from './TextField';

export { ToastProvider, useToast, useToastVisible } from './Toast';
export type { ToastAction, ToastApi, ToastOptions, ToastProviderProps, ToastTone } from './Toast';

export { VisuallyHidden } from './VisuallyHidden';
export type { VisuallyHiddenProps } from './VisuallyHidden';
