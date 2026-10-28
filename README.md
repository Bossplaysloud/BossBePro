# BePro

弦樂器練習與譜本 PWA。規格見上層的 `開發計畫.md`。

## 開發

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 單元測試（備份/還原、提醒、資料操作）
npm run build      # 產出 dist/（含 Service Worker，可部署到任何靜態網站主機）
```

## 結構

- `src/db/` — IndexedDB（Dexie）資料表、資料操作、備份/還原
- `src/music/` — 樂器與 tuning 定義（音高以 MIDI 編號表示，弦 1 = 最高音弦）
- `src/i18n/` — 繁中 / 英文語系檔（新增介面文字時兩個檔都要加）
- `src/components/`、`src/pages/` — 介面
- `src/lib/` — 主題、裝置偏好設定、備份提醒判斷
