// src/features/checkout/districts.ts —— 外送地址的縣市 / 行政區選單（VR-05）
// 只收錄 Demo 店家鄰近的縣市；外送範圍一律由 `store.checkDelivery(zipCode)` 判定（BR-10），
// 不在範圍內的行政區（例：板橋區）刻意保留，用來展示「超出外送範圍」與「改為自取」（FR-CK-04、EC-08）。
export interface DistrictOption {
  city: string;
  district: string;
  zipCode: string;
}

export const DISTRICTS: ReadonlyArray<DistrictOption> = [
  { city: '臺北市', district: '中正區', zipCode: '100' },
  { city: '臺北市', district: '大同區', zipCode: '103' },
  { city: '臺北市', district: '中山區', zipCode: '104' },
  { city: '臺北市', district: '松山區', zipCode: '105' },
  { city: '臺北市', district: '大安區', zipCode: '106' },
  { city: '臺北市', district: '萬華區', zipCode: '108' },
  { city: '臺北市', district: '信義區', zipCode: '110' },
  { city: '臺北市', district: '士林區', zipCode: '111' },
  { city: '臺北市', district: '北投區', zipCode: '112' },
  { city: '臺北市', district: '內湖區', zipCode: '114' },
  { city: '臺北市', district: '南港區', zipCode: '115' },
  { city: '臺北市', district: '文山區', zipCode: '116' },
  { city: '新北市', district: '板橋區', zipCode: '220' },
  { city: '新北市', district: '新店區', zipCode: '231' },
  { city: '新北市', district: '永和區', zipCode: '234' },
  { city: '新北市', district: '中和區', zipCode: '235' },
  { city: '新北市', district: '三重區', zipCode: '241' },
  { city: '新北市', district: '新莊區', zipCode: '242' },
];

export const CITIES: ReadonlyArray<string> = Array.from(new Set(DISTRICTS.map((d) => d.city)));

export function districtsOf(city: string): ReadonlyArray<DistrictOption> {
  return DISTRICTS.filter((d) => d.city === city);
}

export function findDistrict(city: string, district: string): DistrictOption | undefined {
  return DISTRICTS.find((d) => d.city === city && d.district === district);
}
