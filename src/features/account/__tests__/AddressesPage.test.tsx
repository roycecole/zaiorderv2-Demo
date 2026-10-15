// PG-12 地址簿 CRUD：清單、新增 / 編輯（Sheet）、設為預設、刪除（需確認）、行政區連動郵遞區號
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address } from '@/domain/types';
import { useSessionStore } from '@/features/auth/sessionStore';
import { createFakeApi } from '@/test/fakeApi';
import { renderWithProviders } from '@/test/renderWithProviders';
import { AddressesPage } from '../AddressesPage';
import { address, profile, tokens, zones } from './fixtures';

beforeEach(() => {
  useSessionStore.getState().setSession(tokens, profile);
});

/** 以簡單的記憶體清單模擬 me.addresses，讓 CRUD 後的重新載入有意義 */
function addressApi(initial: Address[]) {
  let items = [...initial];
  let seq = 100;
  const create = vi.fn(async (input: Omit<Address, 'id'>) => {
    const row: Address = { ...input, id: `adr_${(seq += 1)}` };
    if (row.isDefault) items = items.map((a) => ({ ...a, isDefault: false }));
    items = [...items, row];
    return row;
  });
  const update = vi.fn(async (id: string, patch: Partial<Omit<Address, 'id'>>) => {
    if (patch.isDefault === true) items = items.map((a) => ({ ...a, isDefault: false }));
    items = items.map((a) => (a.id === id ? { ...a, ...patch } : a));
    return items.find((a) => a.id === id) as Address;
  });
  const remove = vi.fn(async (id: string) => {
    items = items.filter((a) => a.id !== id);
  });
  const api = createFakeApi({
    me: { addresses: { list: async () => ({ items }), create, update, remove } },
    store: { getDeliveryZones: async () => ({ items: zones }) },
  });
  return { api, create, update, remove };
}

describe('AddressesPage', () => {
  it('空狀態：還沒有儲存地址，可新增', async () => {
    const { api } = addressApi([]);
    renderWithProviders(<AddressesPage />, { api });
    expect(await screen.findByText('還沒有儲存地址')).toBeInTheDocument();
    expect(screen.getByText('新增地址，下次外送更快')).toBeInTheDocument();
  });

  it('列出地址卡：預設標籤、收件人與完整地址', async () => {
    const { api } = addressApi([
      address(),
      address({ id: 'adr_2', label: '公司', isDefault: false, district: '中山區', zipCode: '104', line: '南京東路 1 段 8 號' }),
    ]);
    renderWithProviders(<AddressesPage />, { api });
    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText('預設')).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('臺北市大安區示範路 100 號 3 樓')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).queryByText('預設')).not.toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByRole('button', { name: '將「公司」設為預設地址' })).toBeInTheDocument();
  });

  it('新增：縣市 → 行政區連動並自動帶入郵遞區號，送出後重新載入清單', async () => {
    const u = userEvent.setup();
    const { api, create } = addressApi([]);
    renderWithProviders(<AddressesPage />, { api });
    await u.click((await screen.findAllByRole('button', { name: '新增地址' }))[0] as HTMLElement);

    const dialog = await screen.findByRole('dialog', { name: '新增地址' });
    await u.type(within(dialog).getByLabelText(/地址名稱/), '家');
    await u.type(within(dialog).getByLabelText(/收件人姓名/), '王小明');
    await u.type(within(dialog).getByLabelText(/收件人手機/), '0912-345-678');
    await u.selectOptions(within(dialog).getByLabelText(/縣市/), '臺北市');
    // 行政區只列出該縣市的外送區域
    const district = within(dialog).getByLabelText(/行政區/);
    expect(within(district).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '請選擇行政區',
      '大安區',
      '中山區',
    ]);
    await u.selectOptions(district, '中山區');
    expect(within(dialog).getByLabelText(/郵遞區號/)).toHaveValue('104');
    await u.type(within(dialog).getByLabelText(/詳細地址/), '南京東路 1 段 8 號');
    await u.click(within(dialog).getByRole('checkbox', { name: '設為預設地址' }));
    await u.click(within(dialog).getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({
      label: '家',
      recipientName: '王小明',
      recipientPhone: '0912345678',
      city: '臺北市',
      district: '中山區',
      zipCode: '104',
      line: '南京東路 1 段 8 號',
      isDefault: true,
    });
    expect(await screen.findByText('臺北市中山區南京東路 1 段 8 號')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '新增地址' })).not.toBeInTheDocument();
  });

  it('表單驗證：必填欄位與格式錯誤顯示在欄位上，不送出', async () => {
    const u = userEvent.setup();
    const { api, create } = addressApi([]);
    renderWithProviders(<AddressesPage />, { api });
    await u.click((await screen.findAllByRole('button', { name: '新增地址' }))[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: '新增地址' });
    await u.type(within(dialog).getByLabelText(/收件人手機/), '123');
    await u.click(within(dialog).getByRole('button', { name: '儲存' }));
    expect(await within(dialog).findByText('請輸入 1～10 字的地址名稱')).toBeInTheDocument();
    expect(within(dialog).getByText('請輸入正確的手機號碼（09 開頭，共 10 碼）')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/縣市/)).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByLabelText(/行政區/)).toBeDisabled();
    expect(within(dialog).getByText('請輸入詳細地址（5～100 字）')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('編輯：帶入現有值，只更新後呼叫 update', async () => {
    const u = userEvent.setup();
    const { api, update } = addressApi([address()]);
    renderWithProviders(<AddressesPage />, { api });
    await u.click(await screen.findByRole('button', { name: '編輯地址：家' }));
    const dialog = await screen.findByRole('dialog', { name: '編輯地址' });
    expect(within(dialog).getByLabelText(/地址名稱/)).toHaveValue('家');
    expect(within(dialog).getByLabelText(/縣市/)).toHaveValue('臺北市');
    expect(within(dialog).getByLabelText(/行政區/)).toHaveValue('大安區');
    expect(within(dialog).getByLabelText(/郵遞區號/)).toHaveValue('106');
    const label = within(dialog).getByLabelText(/地址名稱/);
    await u.clear(label);
    await u.type(label, '老家');
    await u.click(within(dialog).getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toBe('adr_1');
    expect(update.mock.calls[0]?.[1]).toMatchObject({ label: '老家', city: '臺北市', district: '大安區', zipCode: '106' });
    expect(await screen.findByText('老家')).toBeInTheDocument();
  });

  it('設為預設：呼叫 update(isDefault: true) 並更新標籤', async () => {
    const u = userEvent.setup();
    const { api, update } = addressApi([address(), address({ id: 'adr_2', label: '公司', isDefault: false })]);
    renderWithProviders(<AddressesPage />, { api });
    await u.click(await screen.findByRole('button', { name: '將「公司」設為預設地址' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('adr_2', { isDefault: true }));
    const cards = await screen.findAllByRole('article');
    await waitFor(() => expect(within(cards[1] as HTMLElement).getByText('預設')).toBeInTheDocument());
    expect(within(cards[0] as HTMLElement).queryByText('預設')).not.toBeInTheDocument();
  });

  it('刪除需確認：確認後呼叫 remove 並從清單移除；取消則不刪', async () => {
    const u = userEvent.setup();
    const { api, remove } = addressApi([address(), address({ id: 'adr_2', label: '公司', isDefault: false })]);
    renderWithProviders(<AddressesPage />, { api });

    await u.click(await screen.findByRole('button', { name: '刪除地址：公司' }));
    const confirm = await screen.findByRole('alertdialog', { name: '要刪除這個地址嗎？' });
    await u.click(within(confirm).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(remove).not.toHaveBeenCalled();

    await u.click(screen.getByRole('button', { name: '刪除地址：公司' }));
    const again = await screen.findByRole('alertdialog', { name: '要刪除這個地址嗎？' });
    await u.click(within(again).getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('adr_2'));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
  });

  it('取不到外送區域時改為手動輸入縣市、行政區與郵遞區號', async () => {
    const u = userEvent.setup();
    const create = vi.fn(async (input: Omit<Address, 'id'>) => ({ ...input, id: 'adr_9' }));
    const api = createFakeApi({
      me: { addresses: { list: async () => ({ items: [] }), create } },
      store: { getDeliveryZones: async () => ({ items: [] }) },
    });
    renderWithProviders(<AddressesPage />, { api });
    await u.click((await screen.findAllByRole('button', { name: '新增地址' }))[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: '新增地址' });
    await u.type(within(dialog).getByLabelText(/地址名稱/), '家');
    await u.type(within(dialog).getByLabelText(/收件人姓名/), '王小明');
    await u.type(within(dialog).getByLabelText(/收件人手機/), '0912345678');
    await u.type(within(dialog).getByLabelText(/縣市/), '臺中市');
    await u.type(within(dialog).getByLabelText(/行政區/), '西區');
    await u.type(within(dialog).getByLabelText(/郵遞區號/), '403');
    await u.type(within(dialog).getByLabelText(/詳細地址/), '中港路 1 段 100 號');
    await u.click(within(dialog).getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]?.[0]).toMatchObject({ city: '臺中市', district: '西區', zipCode: '403' });
  });
});
