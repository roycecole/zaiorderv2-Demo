import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageOrPlaceholder } from '../ImageOrPlaceholder';

describe('ImageOrPlaceholder', () => {
  it('NONE：不渲染任何東西', () => {
    const { container } = render(<ImageOrPlaceholder media="NONE" name="招牌滷肉飯" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('PHOTO 有圖：輸出 img，alt 為品名，lazy、固定尺寸屬性', () => {
    render(
      <ImageOrPlaceholder media="PHOTO" imageUrl="https://example.com/a.jpg" name="招牌滷肉飯" />,
    );
    const img = screen.getByRole('img', { name: '招牌滷肉飯' });
    expect(img).toHaveAttribute('src', 'https://example.com/a.jpg');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('width');
    expect(img).toHaveAttribute('height');
  });

  it('alt 可覆寫；空字串為裝飾性', () => {
    const { container } = render(
      <ImageOrPlaceholder
        media="THUMB"
        imageUrl="https://example.com/a.jpg"
        name="招牌滷肉飯"
        alt=""
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('PHOTO 缺圖：不輸出 img，佔位圖塊為裝飾性，顯示分類圖示', () => {
    const { container } = render(
      <ImageOrPlaceholder media="PHOTO" imageUrl={null} name="招牌滷肉飯" icon="🍚" />,
    );
    expect(container.querySelector('img')).toBeNull();
    const ph = container.querySelector('[data-placeholder]');
    expect(ph).toHaveAttribute('aria-hidden', 'true');
    expect(ph).toHaveTextContent('🍚');
  });

  it('沒有分類圖示時顯示品名首字（含 emoji 等多位元組字元）', () => {
    const { container } = render(<ImageOrPlaceholder media="PLACEHOLDER" name="招牌滷肉飯" />);
    expect(container.querySelector('[data-placeholder]')).toHaveTextContent('招');
    const { container: c2 } = render(<ImageOrPlaceholder media="PLACEHOLDER" name="🍜牛肉麵" />);
    expect(c2.querySelector('[data-placeholder]')).toHaveTextContent('🍜');
  });

  it('PLACEHOLDER 即使給了網址也不輸出 img（版面已判定為缺圖）', () => {
    const { container } = render(
      <ImageOrPlaceholder media="PLACEHOLDER" imageUrl="https://example.com/a.jpg" name="x" />,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('載入失敗：切換為佔位圖塊，不顯示破圖；網址改變後重新嘗試', () => {
    const { container, rerender } = render(
      <ImageOrPlaceholder
        media="THUMB"
        imageUrl="https://example.com/broken.jpg"
        name="愛玉檸檬"
        icon="🧋"
      />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-placeholder]')).toHaveTextContent('🧋');

    rerender(
      <ImageOrPlaceholder
        media="THUMB"
        imageUrl="https://example.com/ok.jpg"
        name="愛玉檸檬"
        icon="🧋"
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/ok.jpg');
  });
});
