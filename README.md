# Unknow Web Browser

> **Wings** (bản dùng lõi Gecko của Mozilla) nằm trong [`gecko/`](gecko/README.md): bấm đúp
> `gecko\setup.cmd` để tự tải bộ máy, dựng và chép giao diện, rồi mở `gecko\Wings.exe`.

(Tên và logo tạm thời.)

Trình duyệt nhẹ dựa trên **WebView2 có sẵn trong Windows** (Tauri 2 + Rust), mang các tính năng của TyranWeb nhưng không có nền web động Blue Archive / NIKKE / Azur Lane.

## Vì sao nhẹ hơn TyranWeb

| | TyranWeb (Electron) | Unknow Web Browser (Tauri + WebView2) |
|---|---|---|
| Lõi trình duyệt | Chromium đóng gói kèm (~150 MB) | WebView2 của Windows, dùng chung với hệ thống |
| Tiến trình chính | Node.js + Chromium | Rust, ~20 MB RAM |
| Tab nền | Tab ngủ | Đóng băng (WebView2 `TrySuspend` + giảm bộ nhớ) sau vài phút, rồi cho ngủ hẳn |
| Bộ nhớ đệm | Không giới hạn | Giới hạn (mặc định 200 MB) |

Nhân hiển thị trang vẫn là Blink (cùng nhân với Edge), nên trang web hiển thị giống Chrome/Edge. Phần tiết kiệm đến từ chỗ không phải mang theo một bản Chromium riêng và từ cách xử lý tab nền.

## Task Manager của Windows

Mọi tiến trình `msedgewebview2.exe` đều là tiến trình con của `UnknowWeb.exe`, và ứng dụng có AppUserModelID riêng (`app.unknowweb.browser`), nên Task Manager gom tất cả vào một nhóm **Unknow Web Browser** có tên và biểu tượng riêng. Khi mở rộng nhóm, các dòng con vẫn ghi "Microsoft Edge WebView2", vì tên đó lấy từ file của Microsoft trong Windows.

Trình duyệt cũng có Task Manager riêng (`Shift+Esc`), hiện RAM/CPU của từng tab.

## Tính năng

- Tab ngang/dọc, ghim, tắt tiếng, kéo thả, tab ngủ, khôi phục phiên, cửa sổ InPrivate, chia đôi màn hình, thanh bên (dấu trang, lịch sử, ghi chú, web panel), chế độ tập trung, Lobby (`Ctrl+Shift+L`).
- Thanh địa chỉ có gợi ý (tab đang mở, dấu trang, lịch sử, công cụ tìm kiếm), tự hoàn thành tên miền.
- **Shields** (giống Brave; bấm biểu tượng khiên trên thanh địa chỉ để xem hoặc tắt cho riêng một trang):
  - chặn quảng cáo và trình theo dõi bằng bộ máy của Brave (EasyList, EasyPrivacy, uBlock filters, ABPVN) cùng scriptlet của Brave, chạy trước script của trang (quảng cáo YouTube);
  - ẩn bảng hỏi cookie (EasyList Cookie);
  - chống lấy dấu vân tay: canvas, WebGL, âm thanh, số nhân CPU bị làm nhiễu nhẹ, khác nhau theo từng trang và mỗi lần mở trình duyệt;
  - HTTPS mặc định, tự quay lại HTTP khi trang không hỗ trợ;
  - chặn cookie bên thứ ba (đổi cài đặt này có hiệu lực ở lần mở sau);
  - bỏ tham số theo dõi trong link (fbclid, gclid…) và bỏ qua trang chuyển hướng theo dõi (danh sách của Brave);
  - Do Not Track / GPC, xoá dữ liệu duyệt web.
- Hỏi quyền theo kiểu riêng (camera, micro, vị trí, thông báo…), nhớ lựa chọn theo từng trang; xem và đổi trong bảng thông tin trang hoặc Cài đặt → Quyền riêng tư.
- Dọn rác: bộ nhớ đệm, báo cáo lỗi, tệp tải dở, tệp cũ trong thư mục Temp của Windows (đo trước, chỉ xoá khi bấm).
- Đang phát: nút ♫ trên thanh công cụ khi có tab phát âm thanh, dừng/phát, tua, tắt tiếng.
- Thanh bên có bảng Tải xuống; hình nền có thể lấy từ desktop của Windows.
- **Tiện ích mở rộng:** dán link Chrome Web Store vào Cài đặt → Tiện ích mở rộng, hoặc bấm nút ghép hình khi đang ở trang của tiện ích.
- **Tải từ đường dẫn** (`Ctrl+Shift+G`, hoặc nút Video → Tải từ đường dẫn): video của YouTube, X, Facebook, TikTok, Instagram, Reddit, Bilibili… qua yt-dlp, chọn chất lượng (MP4 tới 4K, âm thanh M4A / MP3). yt-dlp được tải về `profile\tools` lần đầu dùng (kiểm tra SHA-256 với bản phát hành chính thức) và tự cập nhật; FFmpeg dùng bản có sẵn trên máy, chưa có thì tải bản ffmpeg-static (kiểm tra SHA-256).
- **Bắt và tải video:** nút Video trên thanh công cụ liệt kê video/âm thanh trang đang phát. Tải được file thường (mp4, webm, mp3…) và luồng HLS `.m3u8` (chất lượng cao nhất, giải mã AES-128, ghép thành `.ts`). Luồng có DRM và YouTube thì không tải được.
- Chuột phải trên trang: **Đặt làm hình nền** (ảnh), tải video/âm thanh, hình trong hình, mở liên kết ở cửa sổ mới hoặc InPrivate.
- Hình trong hình (`Alt+P`), danh sách quay lại/tiến tới (chuột phải vào nút Quay lại).
- **Kho hình nền** (`unk://store`, Menu → Kho hình nền): tìm ảnh trên Wallhaven (chỉ ảnh an toàn, bỏ ảnh AI) và video nền trên MoeWalls, MotionBGs, WallpaperWaifu; xem trước, tải về có tiến độ, quản lý những gì đã tải.
- Trang Tab mới do giao diện tự vẽ: mở tức thì, không tốn RAM cho tới khi bạn vào một trang; lối tắt kéo thả để đổi chỗ, chuột phải để sửa hoặc gỡ.
- Chủ đề, màu, chất liệu kính mờ, hình nền ảnh/video/gradient, trình chiếu; tự lấy màu theo hình nền; ở kiểu "Trong suốt", chữ trên các thanh tự sáng hay tối theo hình nền. Đổi nhanh chủ đề `Ctrl+Shift+Y`, hình nền `Ctrl+Shift+W`.
- Hiệu ứng chuyển động (tắt được trong Cài đặt → Giao diện): tab trượt khi mở, đóng, kéo; menu và thông báo hiện ra rồi mờ dần; hình nền chuyển mờ dần khi đổi.
- Đổi được mọi phím tắt, bảng lệnh `Ctrl+K`, Task Manager riêng `Shift+Esc`.
- Sao lưu/khôi phục (cài đặt, dấu trang, lịch sử, ghi chú), kiểm tra cập nhật qua GitHub.
- Giao diện tiếng Việt và tiếng Anh (Cài đặt → Chung → Ngôn ngữ).

## Chạy và đóng gói

Cần: Node.js, Rust (MSVC), Visual Studio Build Tools (C++), Windows SDK.

```powershell
npm install
npm run dev      # chạy thử
npm run build    # bản release + bộ cài NSIS (src-tauri\target\release\bundle\nsis)
```

Bản chạy ngay không cần cài: `src-tauri\target\release\UnknowWeb.exe`.

**Dữ liệu người dùng** (cài đặt, dấu trang, lịch sử, cookie, bộ nhớ đệm) nằm trong thư mục `profile` cạnh file exe, tức là trên ổ D, không nằm trong `%APPDATA%` ở ổ C. Muốn dùng hồ sơ khác thì đặt biến `UNK_PROFILE=D:\duong\dan`.

## Cấu trúc

- `src-tauri/src/` (Rust)
  - `wv2.rs`: API WebView2 cho từng tab (sự kiện trang, chặn quảng cáo, tải xuống, tìm trong trang, đóng băng tab, chụp ảnh, danh sách tiến trình)
  - `commands.rs`: các lệnh giao diện gọi xuống
  - `windows_mgr.rs`: quản lý cửa sổ
  - `store.rs`: lưu dữ liệu
  - `adblock.rs`: chặn quảng cáo (bộ máy của Brave + EasyList, EasyPrivacy, uBlock filters, ABPVN)
  - `protocol.rs`: giao thức `unk://` cho hình nền và video của người dùng
  - `shields.rs`, `shields-fp.js`: Shields (script chống lấy dấu vân tay, scriptlet theo trang, HTTPS mặc định)
  - `tracking.rs`: bỏ tham số theo dõi, bỏ qua trang chuyển hướng (danh sách của Brave)
  - `perms.rs`: quyền của trang web
  - `cleaner.rs`: dọn rác
  - `grab.rs`: tải từ đường dẫn (yt-dlp, FFmpeg)
  - `walls.rs`: hình nền trong hồ sơ (thông tin, ảnh thu nhỏ), tìm ảnh Wallhaven, tải video từ kho nền
- `ui/`: giao diện (HTML/CSS/JS thuần, không cần bundler)
  - `js/`: shell (tab, thanh địa chỉ, menu, thanh bên…)
  - `js/ntp.js`: trang Tab mới vẽ ngay trong giao diện
  - `pages/`: các trang `unk://` (newtab, settings, history, bookmarks, downloads, taskmgr, store)

Mỗi tab là một WebView2 riêng đặt chồng lên vùng nội dung của shell. Menu hay gợi ý mở đè lên trang thì trang được thay bằng ảnh chụp của chính nó trong lúc menu mở, vì HTML không vẽ được lên trên cửa sổ native.

Phím tắt nội bộ cho người phát triển: `Ctrl+Shift+F12` mở DevTools của giao diện. Chạy với biến `UNK_DEBUG_PORT=9222` thì mọi trang (cả giao diện) mở cổng DevTools tại `127.0.0.1:9222`, để kiểm thử tự động; đừng bật khi dùng hằng ngày.

Script trong `scripts/`: `gen-shortcuts.mjs` sinh lại danh sách Phím tắt từ `ui/js/commands.js`; `missing-en.mjs` liệt kê chữ tiếng Việt chưa có bản dịch trong `ui/shared/en.json`.
