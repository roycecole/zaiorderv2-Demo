// src/i18n/strings/static.ts —— 靜態頁與錯誤頁文案（PG-16、PG-17；繁體中文・台灣用語）
// 隱私權政策與服務條款的內文在 legal.ts（只有該頁面才載入）；這裡只放標題與錯誤頁。

export const staticPages = {
  common: {
    backToMenu: '回菜單',
    demoNoticeTitle: '示範用內容，非正式條款',
    demoNotice: '本頁為範例文字，僅供示範站台使用，不構成法律文件，也不代表任何店家的正式政策。',
    sections: '本頁內容',
  },
  privacy: {
    title: '隱私權政策',
    intro: '我們重視你的隱私。以下說明蒐集哪些資料、為何蒐集，以及你可以怎麼處理。',
  },
  terms: {
    title: '服務條款',
    intro: '使用本服務前，請先閱讀以下條款。',
  },
  notFound: {
    title: '找不到這個頁面',
    pageTitle: '找不到頁面',
    message: '網址可能輸入有誤，或這個頁面已經移動。可以回到菜單繼續點餐。',
    backToMenu: '回到菜單',
  },
  error: {
    title: '發生了一點問題',
    message: '頁面暫時無法顯示。請重新整理再試一次，若持續發生，請稍後再來或直接來電店家。',
    retry: '重新整理',
    home: '回首頁',
    requestId: '參考編號',
  },
} as const;
