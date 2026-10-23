# ติดตั้ง KrunameClass เป็นแอปบนมือถือ (PWA)

KrunameClass ติดตั้งลงหน้าจอโฮมของโทรศัพท์ได้ เปิดจากไอคอนแล้วใช้งานเต็มจอเหมือนแอปทั่วไป
ไม่ต้องดาวน์โหลดจาก Play Store หรือ App Store และใช้บัญชีเดิมได้ทั้งครูและนักเรียน

## Android (Chrome)

1. เปิด **Chrome** แล้วไปที่ `https://krunameclass.com`
2. เข้าสู่ระบบตามปกติ (หรือติดตั้งก่อนเข้าสู่ระบบก็ได้)
3. แตะเมนู **⋮** มุมขวาบน → เลือก **ติดตั้งแอป** (บางเครื่องเขียนว่า **เพิ่มลงในหน้าจอหลัก**)
   - ถ้ามีแถบ "ติดตั้ง KrunameClass" ขึ้นด้านล่างหน้าจอ แตะ **ติดตั้ง** ได้เลย
4. แตะ **ติดตั้ง** อีกครั้งเพื่อยืนยัน ไอคอน KrunameClass (หมวกบัณฑิตบนพื้นสีฟ้า) จะอยู่บนหน้าจอโฮม

## iPhone / iPad (Safari)

1. เปิด **Safari** แล้วไปที่ `https://krunameclass.com`
   (ต้องใช้ Safari — Chrome บน iPhone รุ่นเก่าบางเวอร์ชันไม่มีเมนูนี้)
2. แตะปุ่ม **แชร์** (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ด้านล่างหรือด้านบนของหน้าจอ
3. เลื่อนลงแล้วแตะ **เพิ่มไปยังหน้าจอโฮม** (Add to Home Screen)
4. ตรวจชื่อว่าเป็น **KrunameClass** แล้วแตะ **เพิ่ม**
5. เปิดแอปจากไอคอนบนหน้าจอโฮม แล้ว **เข้าสู่ระบบอีกครั้งหนึ่งครั้ง**
   — บน iPhone แอปที่เพิ่มลงหน้าจอโฮมเก็บข้อมูลการเข้าสู่ระบบแยกจาก Safari

## การอัปเดต

- เมื่อมีเวอร์ชันใหม่ จะมีกล่องเล็ก ๆ ด้านล่างหน้าจอว่า **"มีเวอร์ชันใหม่ของ KrunameClass"**
- แตะ **อัปเดตตอนนี้** เพื่อโหลดเวอร์ชันใหม่ หรือแตะ **✕** เพื่ออัปเดตภายหลัง
  (กล่องจะขึ้นอีกครั้งเมื่อเปิดแอปครั้งถัดไป)
- แอป **ไม่อัปเดตเองกลางคัน** — ถ้ากำลังบันทึกคะแนน บันทึกการส่งงาน หรืออัปโหลดไฟล์อยู่
  ระบบจะรอให้บันทึกเสร็จก่อน (ขึ้นข้อความ "กำลังบันทึกข้อมูล — จะอัปเดตทันทีที่บันทึกเสร็จ")
- ถ้ามีการเช็คชื่อที่ยังไม่ได้กด **บันทึก** ระบบจะไม่อัปเดต และขึ้นข้อความ
  "มีข้อมูลที่ยังไม่ได้บันทึก — กดบันทึกก่อน แล้วแตะอัปเดตอีกครั้ง"
- การอัปเดตไม่ทำให้ออกจากระบบ และข้อมูลที่บันทึกแล้วไม่หาย ไม่ต้องลบแล้วติดตั้งใหม่
- แอปตรวจหาเวอร์ชันใหม่เองทุกชั่วโมงขณะเปิดอยู่ และทุกครั้งที่กลับมาเปิดแอป

## ต้องใช้อินเทอร์เน็ต

- แอปเปิดหน้าหลักได้แม้ไม่มีอินเทอร์เน็ต แต่ **ข้อมูลทั้งหมดอยู่บนเซิร์ฟเวอร์** ไม่ได้เก็บไว้ในเครื่อง
- การเข้าสู่ระบบ เช็คชื่อ บันทึกคะแนน ส่งงาน อัปโหลดไฟล์ Google Drive และสแกน QR
  **ต้องเชื่อมต่ออินเทอร์เน็ตเสมอ**
- เมื่อไม่มีสัญญาณ จะมีแถบ **"ไม่มีการเชื่อมต่ออินเทอร์เน็ต"** ด้านล่างหน้าจอ
  สิ่งที่กดบันทึกระหว่างนั้น **ยังไม่ถูกบันทึก** — ต่ออินเทอร์เน็ตแล้วทำใหม่อีกครั้ง
- การสแกน QR ด้วยกล้องต้องอนุญาตให้แอปใช้กล้อง (ครั้งแรกระบบจะถาม)

## แก้ปัญหา

| อาการ | วิธีแก้ |
|---|---|
| ไม่มีเมนู "ติดตั้งแอป" บน Android | ใช้ Chrome รุ่นล่าสุด, เปิดผ่าน `https://` (ไม่ใช่หน้าที่บันทึกไว้), ไม่ใช้โหมดไม่ระบุตัวตน, ถ้าติดตั้งไว้แล้วจะขึ้นว่า "เปิดแอป" แทน |
| ไม่มี "เพิ่มไปยังหน้าจอโฮม" บน iPhone | ต้องเปิดใน Safari, ปิดโหมดส่วนตัว (Private), เลื่อนรายการในเมนูแชร์ลงมาให้สุด |
| เปิดแอปแล้วยังเป็นเวอร์ชันเก่า | ปิดแอปให้หมด (ปัดออกจากหน้าสลับแอป) แล้วเปิดใหม่ รอกล่อง "มีเวอร์ชันใหม่" แล้วแตะ **อัปเดตตอนนี้** |
| ยังเก่าอยู่หลังลองแล้ว | Android: Chrome → ⋮ → การตั้งค่า → การตั้งค่าเว็บไซต์ → `krunameclass.com` → ล้างข้อมูล; iPhone: ลบไอคอนออกจากหน้าจอโฮม แล้วเพิ่มใหม่จาก Safari (ต้องเข้าสู่ระบบใหม่) |
| เปิดแอปบน iPhone แล้วต้องเข้าสู่ระบบอีกครั้ง | ปกติสำหรับครั้งแรกหลังเพิ่มลงหน้าจอโฮม |
| ขึ้น "ไม่มีการเชื่อมต่ออินเทอร์เน็ต" ทั้งที่มีสัญญาณ | ปิด–เปิด Wi-Fi/ข้อมูลมือถือ แล้วดึงหน้าลงเพื่อรีเฟรช |
| กล้องสแกน QR ไม่ทำงาน | อนุญาตกล้องให้ krunameclass.com ในการตั้งค่าเบราว์เซอร์/ระบบ หรือใช้โหมด "เครื่องสแกน" / ปุ่ม "บันทึกว่าส่ง" แทน |

---

## Technical notes (for developers)

- `vite-plugin-pwa` 2.0.0 (`generateSW`, `registerType: 'prompt'`), config in `vite.config.ts`.
  The service worker exists only in production builds (`devOptions.enabled: false`).
- **Precache**: the versioned build only — hashed JS/CSS/fonts, icons and the static
  `index.html` shell (no user data). One consistent set per deploy, so an open tab never
  mixes old and new chunks (Vercel serves only the newest deployment's hashed files).
  `cleanupOutdatedCaches` removes the previous set after an update.
- **Runtime cache**: Google Fonts only. **Never cached**: Supabase REST/RPC/Auth/Storage/
  Edge Functions, Google APIs/Drive — all cross-origin, so no service-worker route matches
  them and they always go to the network.
- **Navigation**: SPA routes get the precached shell (`navigateFallback: '/index.html'`);
  paths that look like files (`/x.ext`) are excluded. Query strings and hashes are kept, so
  `/reset-password#…` and OAuth return URLs work in the installed app.
- **Updates**: `src/features/pwa/pwa-update-prompt.tsx` shows the prompt; nothing calls
  `skipWaiting` until the user taps "อัปเดตตอนนี้". Before reloading it waits for in-flight
  Supabase writes counted by `src/lib/pending-writes.ts` (wired into the Supabase client's
  `global.fetch`), and refuses while unsaved edits are open (`src/lib/unsaved-work.ts`, set
  by the attendance `UnsavedChangesGuard` — iOS shows no `beforeunload` prompt).
  Update checks: hourly + on returning to the foreground
  (`src/features/pwa/update-checks.ts`).
- `vercel.json` sends `Cache-Control: no-cache` for `sw.js`, `manifest.webmanifest` and
  `index.html`, so a new deploy is seen on the next check.
- **iOS**: `apple-touch-icon.png` (180, full-bleed), `apple-mobile-web-app-*` meta in
  `index.html`, `viewport-fit=cover` with `env(safe-area-inset-*)` padding on the app shells
  (`.kc-safe-area`), drawers, toasts and the full-screen scanner — `env()` is 0 on desktop.
- Icons: `public/pwa-192x192.png`, `pwa-512x512.png` (purpose any), `pwa-maskable-512x512.png`
  (glyph inside the 80% safe zone), generated from the favicon design (graduation cap on
  `#237fc8`).
