// 浮層的延後載入（NFR-03）：關閉且從未開啟時不載入實作；需要時才載入，載入後常駐；失敗後可重試
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LazyOverlay, createOverlayLoader } from '../lazyOverlay';

interface DemoProps {
  label: string;
}
const Demo = ({ label }: DemoProps) => <p>實作：{label}</p>;

/** 可手動放行的 importer，用來觀察「載入前 / 載入後」 */
function deferredImporter() {
  let release: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const importer = vi.fn(
    () =>
      new Promise<typeof Demo>((resolve, reject) => {
        release = () => resolve(Demo);
        fail = reject;
      }),
  );
  return { importer, release: () => release(), fail: (e: Error) => fail(e) };
}

describe('createOverlayLoader', () => {
  it('尚未載入為 null；多次 load 共用同一次匯入，完成後通知訂閱者', async () => {
    const { importer, release } = deferredImporter();
    const loader = createOverlayLoader<DemoProps>(importer);
    const listener = vi.fn();
    loader.subscribe(listener);

    expect(loader.current()).toBeNull();
    const first = loader.load();
    const second = loader.load();
    expect(importer).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(loader.current()).toBe(Demo);
    expect(listener).toHaveBeenCalledTimes(1);

    // 已載入：不再匯入
    await loader.load();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('載入失敗：丟出錯誤並清除進行中的 Promise，下次可重試', async () => {
    const { importer, fail } = deferredImporter();
    const loader = createOverlayLoader<DemoProps>(importer);
    const attempt = loader.load();
    fail(new Error('chunk 載入失敗'));
    await expect(attempt).rejects.toThrow('chunk 載入失敗');
    expect(loader.current()).toBeNull();

    void loader.load().catch(() => undefined);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});

describe('LazyOverlay', () => {
  it('active 為 false 且從未載入：不匯入、不輸出任何內容', () => {
    const { importer } = deferredImporter();
    const loader = createOverlayLoader<DemoProps>(importer);
    const { container } = render(
      <LazyOverlay loader={loader} active={false} props={{ label: 'A' }} />,
    );
    expect(importer).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('active 變為 true 才載入；載入完成後渲染，之後即使 active 回到 false 也維持掛載', async () => {
    const { importer, release } = deferredImporter();
    const loader = createOverlayLoader<DemoProps>(importer);
    const { rerender } = render(
      <LazyOverlay loader={loader} active={false} props={{ label: 'A' }} />,
    );
    expect(importer).not.toHaveBeenCalled();

    rerender(<LazyOverlay loader={loader} active props={{ label: 'A' }} />);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('實作：A')).toBeNull();

    await act(async () => {
      release();
      await loader.load();
    });
    expect(await screen.findByText('實作：A')).toBeInTheDocument();

    rerender(<LazyOverlay loader={loader} active={false} props={{ label: 'B' }} />);
    await waitFor(() => expect(screen.getByText('實作：B')).toBeInTheDocument());
  });

  it('實作已載入：下一次掛載同步渲染（不經過等待狀態）', async () => {
    const loader = createOverlayLoader<DemoProps>(async () => Demo);
    await loader.load();
    render(<LazyOverlay loader={loader} active={false} props={{ label: 'C' }} />);
    expect(screen.getByText('實作：C')).toBeInTheDocument();
  });
});
