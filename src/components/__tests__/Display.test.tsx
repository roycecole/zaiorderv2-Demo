import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge, ProductTagBadge } from '../Badge';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { Divider } from '../Divider';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { IconButton } from '../IconButton';
import { InlineAlert } from '../InlineAlert';
import { KeyHintBadge } from '../KeyHintBadge';
import { Price, formatPriceDelta } from '../Price';
import { Skeleton } from '../Skeleton';
import { SkeletonCard } from '../SkeletonCard';
import { Spinner } from '../Spinner';

describe('Price', () => {
  it('格式為 NT$ 與千分位；負數為 −NT$', () => {
    const { rerender } = render(<Price amount={1250} />);
    expect(screen.getByText('NT$ 1,250')).toBeInTheDocument();
    rerender(<Price amount={-40} />);
    expect(screen.getByText('−NT$ 40')).toBeInTheDocument();
  });

  it('「起」與舊價（刪除線，附給輔助科技的「原價」）', () => {
    const { container } = render(<Price amount={35} from originalAmount={45} />);
    expect(screen.getByText('起')).toBeInTheDocument();
    expect(container.querySelector('del')).toHaveTextContent('原價 NT$ 45');
    expect(container).toHaveTextContent('現價');
  });

  it('舊價不大於現價時不顯示', () => {
    const { container } = render(<Price amount={35} originalAmount={35} />);
    expect(container.querySelector('del')).toBeNull();
  });

  it('formatPriceDelta：> 0 +、< 0 −、0 不顯示', () => {
    expect(formatPriceDelta(12)).toBe('+NT$ 12');
    expect(formatPriceDelta(-5)).toBe('−NT$ 5');
    expect(formatPriceDelta(0)).toBeNull();
    expect(formatPriceDelta(undefined)).toBeNull();
  });
});

describe('Badge / Chip', () => {
  it('ProductTagBadge 依 ProductTag 顯示中文標籤與色調', () => {
    render(
      <>
        <ProductTagBadge tag="HOT" />
        <ProductTagBadge tag="VEGETARIAN" />
      </>,
    );
    expect(screen.getByText('熱銷').className).toContain('bg-brand');
    expect(screen.getByText('素食').className).toContain('text-success');
  });

  it('Badge 自訂內容與色調', () => {
    render(<Badge tone="inverse">今日售完</Badge>);
    expect(screen.getByText('今日售完').className).toContain('bg-text');
  });

  it('Chip：toggle 以 aria-pressed、current 以 aria-current', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <Chip selected onClick={onClick}>
        飯類
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: '飯類' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Chip selected semantic="current">
        飯類
      </Chip>,
    );
    const current = screen.getByRole('button', { name: '飯類' });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current).not.toHaveAttribute('aria-pressed');
  });
});

describe('InlineAlert', () => {
  it('error 預設為 role=alert；success 為 status；info / warning 不通報', () => {
    const { rerender } = render(<InlineAlert tone="error">付款未完成</InlineAlert>);
    expect(screen.getByRole('alert')).toHaveTextContent('付款未完成');
    rerender(<InlineAlert tone="success">已儲存</InlineAlert>);
    expect(screen.getByRole('status')).toHaveTextContent('已儲存');
    rerender(<InlineAlert tone="warning">限量</InlineAlert>);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('role="none" 可關閉預設通報；標題、動作與關閉鈕', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <InlineAlert
        tone="error"
        role="none"
        title="無法送出"
        action={<button type="button">再試一次</button>}
        onDismiss={onDismiss}
      >
        請稍後再試
      </InlineAlert>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('無法送出')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再試一次' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '關閉' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState / ErrorState', () => {
  it('EmptyState：標題、說明、動作；插圖為裝飾性', () => {
    render(
      <EmptyState
        icon="🛒"
        title="購物車還是空的"
        description="來點好吃的吧！"
        action={<button type="button">回菜單</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: '購物車還是空的' })).toBeInTheDocument();
    expect(screen.getByText('來點好吃的吧！')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回菜單' })).toBeInTheDocument();
    expect(screen.getByText('🛒')).toHaveAttribute('aria-hidden', 'true');
  });

  it('ErrorState：role=alert、重試、參考編號', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ErrorState message="網路好像不太穩，請稍後再試" onRetry={onRetry} requestId="req_123" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('發生了一點問題');
    expect(screen.getByRole('alert')).toHaveTextContent('req_123');
    await user.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState 沒有 onRetry 時不顯示重試鈕', () => {
    render(<ErrorState message="找不到訂單" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('以 label 作為 aria-label；點擊觸發', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="開啟購物車" icon={<svg />} badge={3} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: '開啟購物車' });
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('tooltip：hover 顯示、Esc 可關閉、可由鍵盤焦點顯示', async () => {
    const user = userEvent.setup();
    render(<IconButton label="鍵盤快速鍵與偏好" icon={<svg />} tooltip />);
    const btn = screen.getByRole('button', { name: '鍵盤快速鍵與偏好' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(btn);
    expect(screen.getByRole('tooltip')).toHaveTextContent('鍵盤快速鍵與偏好');
    btn.focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('loading：aria-busy 並忽略點擊', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<IconButton label="重新整理" icon={<svg />} loading onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: '重新整理' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('KeyHintBadge', () => {
  it('visible=false 時不輸出任何東西（預設關閉）', () => {
    const { container } = render(<KeyHintBadge keys="c" visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('visible=true：aria-hidden、不攔截指標；組合鍵以 + 連接', () => {
    const { container } = render(
      <KeyHintBadge keys={['Ctrl', 'Enter']} visible placement="inline" />,
    );
    const badge = container.firstElementChild as HTMLElement;
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge.className).toContain('pointer-events-none');
    expect(badge).toHaveTextContent('Ctrl+Enter');
  });

  it('corner 為絕對定位（不影響版面）', () => {
    const { container } = render(<KeyHintBadge keys="c" visible />);
    expect((container.firstElementChild as HTMLElement).className).toContain('absolute');
  });
});

describe('Spinner / Skeleton / Card / Divider', () => {
  it('Spinner：預設有「載入中…」狀態文字；decorative 無', () => {
    const { rerender } = render(<Spinner />);
    expect(screen.getByRole('status')).toHaveTextContent('載入中…');
    rerender(<Spinner decorative />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('Skeleton / SkeletonCard 為裝飾性（aria-hidden）', () => {
    const { container } = render(
      <>
        <Skeleton width={120} height={16} />
        <SkeletonCard variant="grid" />
        <SkeletonCard variant="list" />
        <SkeletonCard variant="bare" />
      </>,
    );
    for (const el of Array.from(container.children)) {
      expect(el).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('Card 可指定元素；Divider 為裝飾性', () => {
    const { container } = render(
      <>
        <Card as="article" tone="dashed">
          內容
        </Card>
        <Divider />
      </>,
    );
    expect(screen.getByRole('article')).toHaveTextContent('內容');
    expect(container.lastElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
