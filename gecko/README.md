# Wings — bản lõi Gecko

Toàn bộ giao diện và tính năng của Wings (cùng thư mục `ui\` với bản Tauri + WebView2),
chạy trên **lõi Gecko của Mozilla**, không dùng giao diện hay tính năng nào của Firefox. Mọi tiến
trình mang tên và logo "Wings" (`engine\Wings.exe`, `plugin-container.exe`), nên Task Manager chỉ hiện app này.
(Tên bên trong — `unk://`, `chrome://unknowweb`, `unkcore.dll`, thư mục hồ sơ — giữ như cũ để dữ liệu không phải chuyển.)

## Chạy

Mở `Wings.exe`. Nó chạy lõi trong `engine\` với ứng dụng `app\` và hồ sơ `profile\`
ngay bên cạnh, trên ổ D (cả các tệp nhỏ lõi Gecko vốn ghi vào `%APPDATA%` cũng nằm trong
`profile\appdata*`). Đừng mở thẳng `engine\Wings.exe`.

**Thanh tác vụ / menu Start:** mọi cửa sổ của Wings mang tên riêng trên thanh tác vụ (AppUserModelID
`Wings.Browser`, đặt trong `Backend.sys.mjs`), nên chúng gộp chung một nút và không lẫn với Firefox.
`tools\shortcut.ps1` tạo lối tắt `Wings` trong menu Start (trỏ tới `Wings.exe`, cùng icon, cùng tên
`Wings.Browser`); có nó, ghim cửa sổ Wings vào thanh tác vụ sẽ ghim đúng `Wings.exe`. Chạy lại script nếu
chuyển thư mục; `-Remove` để gỡ lối tắt.

## Logo

**Sōyoku Kamon (双羽紋)** — đôi cánh hai tầng thanh thoát xoay đối xứng 180° quanh một khoảng trời tròn theo
tinh thần gia huy Nhật Bản (*kamon*), vừa là đôi cánh đang lướt nhẹ, vừa là ô cửa tròn nhìn ra web; icon app
là đôi cánh trắng `#FFFFFF` & xanh băng ngọc `#E4F1FD` (màu đôi cánh trên hình nền mặc định) trên ô hồng sakura
sáng (`#D43B7E` → `#EE75AA` → `#FBBAD5`), biểu tượng độc lập màu phẳng là đỏ thẫm `#A41154` & hồng trầm
`#D4528A`. Thiết kế theo quy trình của skill `logo-design` (github.com/kaankiziltug/logo-design-skill):
brief, 3 concept vẽ đen trước (`Hane Sweep`, `Sōyoku Kamon`, `Plume W`), kiểm tra 16 px / một màu / đảo màu /
nhòe / kệ trình duyệt, chọn B. Hướng dẫn dùng, bảng màu, khoảng trống, cỡ nhỏ nhất: `branding\GUIDE.md`.
- `branding\make-logo.mjs` (kiểu `soyoku`, mặc định) tạo `branding\wings.svg` (icon app), `wings-small.svg`
  (bản cho 16–32 px: khe gió rộng hơn 15 → 22 đơn vị, khung đầy hơn) và `branding\kit\` (biểu tượng màu, đen,
  đảo màu đã làm mảnh ~3%, cỡ nhỏ); `kit\export\` là các bản xuất bằng `export_variants.py` của skill (đen,
  trắng, một màu, favicon, bộ icon web). Vẫn giữ các kiểu trước đây: `sakura`, `beret`, `m`, `blade`, `feather`,
  `facet`. Concept và bảng kiểm thử: `branding\concepts-wings\`.
- `branding\png\` là các cỡ 16–256 px (16–32 từ bản cỡ nhỏ; vẽ bằng Edge headless, nền trong suốt),
  `branding\wings.ico` gói cả 10 cỡ: gắn vào `Wings.exe`, `engine\Wings.exe`, `engine\plugin-container.exe` bằng
  `tools\rebrand.ps1`, và là icon cửa sổ (`app\chrome\icons\default\default.ico`). Giao diện dùng
  `ui\shared\logo.svg` (trang Giới thiệu) và `ui\shared\logo-small.svg` (thanh tiêu đề, đầu trang Cài đặt).

Hình nền mặc định: `ui\assets\wallpapers\wings-default.jpg` (ô "Mặc định" đầu thư viện trong Cài đặt →
Hình nền); mặc định bật "Lấy màu theo hình nền" (`appearance.autoColor`) và giao diện trong suốt
(`appearance.chromeStyle: "clear"`).

## Cấu trúc

- `engine\` — lõi Gecko: runtime của Firefox 160.0.1 chính thức (đã kiểm tra chữ ký), đổi tên và
  biểu tượng (`tools\rebrand.ps1`). Đã bỏ hẳn phần ứng dụng Firefox (`browser\`), trình gửi báo lỗi,
  cập nhật, gỡ cài đặt, AI/ML… (để tạm ở `old-firefox-ui\engine-firefox-parts\`, xoá được).
- `app\` — ứng dụng của Wings trên lõi (`-app app\application.ini`):
  - `chrome\content\ui\` — giao diện, chép từ `..\ui\` bằng `tools\sync-ui.mjs` (đừng sửa ở đây);
  - `chrome\content\bridge.js` — API Tauri (`window.__TAURI__`) dựng lại trên Gecko, nên các tệp
    giao diện chạy y như bản WebView2;
  - `chrome\modules\Backend.sys.mjs` — xử lý lệnh của giao diện, cửa sổ, Shields trên mạng (chặn
    quảng cáo, bỏ tham số theo dõi), tải xuống, hỏi quyền, các thiết lập của lõi;
  - `chrome\modules\TabHost.sys.mjs` — mỗi tab là một `<browser>` (trang chạy ở tiến trình riêng);
  - `chrome\modules\actors\` — phần chạy trong trang: Shields trước script của trang (chống lấy dấu
    vân tay, scriptlet của danh sách lọc), ẩn ô quảng cáo, menu chuột phải, toàn màn hình video,
    alert/confirm/prompt, mở liên kết bằng Ctrl/chuột giữa, Ctrl + lăn chuột để thu phóng trang (mỗi nấc
    một bậc như Ctrl + = / Ctrl + -, chụm touchpad cũng được; trang tự dùng Ctrl + lăn như bản đồ thì giữ
    lại; mức thu phóng nhớ theo từng trang web);
  - `chrome.manifest` — tắt các thành phần của Firefox còn nằm trong lõi (trình xử lý dòng lệnh,
    JSON viewer, cập nhật, telemetry);
  - `unkcore.dll` — bản dựng của `core\`.
- `core\` — back end Rust của bản Tauri (cài đặt, dấu trang, lịch sử, bộ chặn quảng cáo
  adblock-rust, hình nền + kho, yt-dlp, Dọn rác, sao lưu) làm thành DLL, gọi qua js-ctypes.
- `launcher\` — mã nguồn trình khởi động (Rust).
- `tools\` — `sync-ui.mjs` (giao diện + DLL vào `app\`), `import-tauri.mjs` (đưa dữ liệu bản
  Tauri sang), `rebrand.ps1`.
- `old-firefox-ui\` — bản dùng giao diện Firefox trước đây (tiện ích, cấu hình, hồ sơ) và các phần
  Firefox đã gỡ khỏi lõi. Không còn dùng; xoá được khi không cần.

## Tính năng thêm từ TyranWeb

- **Kiểm tra tệp tải về** (Cài đặt → Chung): chương trình và file nén có chương trình bên trong được
  Windows Defender quét khi tải xong, rồi tra VirusTotal (API key riêng của bạn, lưu mã hoá bằng khoá
  của Windows). Trang kết quả `unk://scan`; tệp có mã độc không được mở từ trình duyệt; mỗi tệp tải về
  được đánh dấu "từ Internet" như Chrome.
- **Ứng dụng trên máy** (thanh bên): các ứng dụng có chữ ký số trong Start menu, ghim lên thanh bên.
- **Phông chữ của bạn** và **con trỏ chuột** (Cài đặt → Giao diện): bộ Sakura / Đêm / Bạc hà hoặc tệp
  .cur / .ani / .ico / .png của bạn, cho cả trang web.
- **Cloudflare WARP** (Cài đặt → Quyền riêng tư): trang web đi qua proxy của ứng dụng WARP.
- **Anime hôm nay** (trang Tab mới): một anime 2000–2010 mỗi ngày từ AniList.
- **Lịch sử Quay lại / Tiến tới của tab** được giữ khi tab ngủ, khi đóng rồi mở lại (Ctrl+Shift+T),
  khi nhân đôi, khi chuyển sang cửa sổ khác và qua các lần mở trình duyệt.
- **Cửa sổ đã đóng gần đây** (menu chính; Lịch sử → Cửa sổ đã đóng) và **chuyển tab sang cửa sổ khác**
  (menu chuột phải của tab).
- **Lịch sử → Đã quét**: mọi tệp đã kiểm tra, kể cả khi đã xoá khỏi danh sách tải xuống.
- **Pixiv** trong Tải từ đường dẫn: ảnh gốc từng trang, ảnh động (ugoira) thành MP4 hoặc GIF, bằng
  tài khoản Pixiv của bạn trong trình duyệt.

- **Hình nền web** (Cài đặt → Hình nền): một trang web, hoặc gói hình nền web (thư mục / zip có
  index.html: Wallpaper Engine, Lively) chạy phía sau giao diện; tìm và cài từ GitHub (Specials).
- **Thêm nhiều hình nền** (tệp, cả thư mục, file zip) và **liên kết thư mục** (dùng ảnh / video tại chỗ).
- **Video nền giải mã bằng card đồ họa**: video nền chạy trong một trang riêng phía sau giao diện
  (`app\chrome\modules\wall\video.html`), vì lõi Gecko chỉ cho giải mã phần cứng ngoài tiến trình giao
  diện; trong giao diện, video 1440p 60 fps tốn khoảng 2,5 nhân CPU và giật. Màu tự động và tông thanh
  công cụ lấy từ khung hình đầu của video.
- **Nhạc nền** cho từng hình nền: file nhạc, hoặc link YouTube / SoundCloud / Spotify; phát khi trang Tab
  mới hoặc Lobby mở, tạm dừng khi tab khác phát tiếng; **phổ nhạc** dưới hình nền.
- **Video trên trang**: mỗi video có ảnh xem trước, kích thước, độ dài.
- **Tải truyện tranh** (Ctrl+Shift+M, menu chính, menu chuột phải, hay chip 🖼 trên thanh địa chỉ — tự hiện
  khi trang trông như một chương truyện): tìm ảnh của chương ngay trong trang (`actors\MangaScan.sys.mjs`) —
  theo khung đọc của các web/khuôn web quen (Madara, MangaStream theo template của Haruneko; NetTruyen,
  TruyenQQ, Manganato, Webtoons…), nếu không thì khung chứa nhiều ảnh lớn nhất; lấy địa chỉ thật của ảnh nạp
  chậm (`data-src`, `srcset`…), bỏ quảng cáo, logo, ảnh nhỏ, giữ thứ tự đọc; làm chính cho truyện **đọc dọc** (các
  trang xếp chồng, cuộn xuống): nhận cả ảnh cắt lát mỏng kiểu webtoon/manhwa khi cùng bề ngang với các trang
  (banner khác bề ngang vẫn bị bỏ), và gom địa chỉ server dự phòng (`data-cdn`, `data-sv1`…) để tự đổi server
  khi một ảnh tải hỏng; đọc tên truyện, chương và link
  chương sau; cả web đọc mỗi trang một địa chỉ. Tải bằng trình tải của lõi với phiên đăng nhập và cookie của
  trình duyệt, trang truyện làm referrer (`Manga.sys.mjs`); mỗi tệp được kiểm là ảnh thật (trang báo lỗi thì tải
  lại) và **luôn lưu dạng PNG** (`001.png`, `002.png`…: JPEG, WebP, AVIF, GIF, BMP được giải mã và mã hoá lại
  bằng `imgITools` của Gecko). Mặc định, mỗi lượt tải tạo **một file ZIP** trong Tải xuống. Tải một chương
  tạo file `<Tên truyện> - <Chương>.zip`. Chọn tải tiếp nhiều chương tạo file `<Tên truyện>.zip`.
  Bên trong ZIP, ảnh nằm theo thứ tự ở `<Tên truyện>/<Chương>/001.png`, `002.png`… Mục Tải xuống hiển thị
  một dòng cho cả ZIP và đếm tổng số ảnh. Bảng tải cũng có lựa chọn lưu từng chương dưới dạng CBZ cho app
  đọc truyện (kèm `ComicInfo.xml`) hoặc thư mục ảnh. Wings nhớ định dạng đã chọn cho lần sau (`general.mangaFormat`).

- **Sảnh trang Tab mới như TyranWeb**: hàng nút kính ở góc phải (con mắt thu gọn thanh tìm kiếm và lối
  tắt, đồng hồ lướt lên góc trái; Sắp xếp kéo đồng hồ / thanh tìm kiếm / lối tắt tới chỗ bạn muốn, nhớ
  riêng lúc hiện và lúc ẩn; Lobby; phổ nhạc; nhạc nền; kho video; Tùy biến), ngày tháng dưới đồng hồ,
  bấm vào đồng hồ để bật / tắt nền kính (ở góc, và cả ở giữa nếu muốn).
- **Kính trong suốt ở thanh dấu trang / ở đồng hồ** (Giao diện, khi thanh công cụ Trong suốt), **bong
  bóng địa chỉ liên kết**, độ rộng cột tab, bo góc khung trang, độ rộng thanh bên (Bố cục).

## Dữ liệu: cùng định dạng với TyranWeb

Dữ liệu nằm trong `profile\unk\data` (hoặc thư mục ghi trong `profile\unk\data-folder.json`,
`{"dir": "..."}` như TyranWeb), với đúng tên tệp và cấu trúc của TyranWeb: `settings.json`,
`history.json` (`{visits:[{id,url,title,favicon,time}]}`), `bookmarks.json`, `downloads.json`
(`filename`, `totalBytes`, `receivedBytes`, `startTime`, `endTime`…), `session.json`,
`window-history.json`, `window-state.json`, `scan-history.json`, `notes.json`. Mỗi tệp ghi qua `.tmp`,
bản trước giữ thành `.bak` và được đọc lại khi tệp hỏng. Trang của trình duyệt ghi là `tyran://…` trong
tệp (là `unk://…` khi chạy); danh sách Quay lại / Tiến tới của tab đếm từ 0 như TyranWeb.

Cài đặt → Giới thiệu → Thư mục dữ liệu: **dùng thẳng thư mục của TyranWeb** (tự tìm qua
`%APPDATA%\TyranWeb\data-folder.json`), **chép dữ liệu TyranWeb sang**, chọn / chép từ thư mục khác, hoặc
về thư mục riêng — áp dụng từ lần mở tới. Dùng chung một thư mục thì không mở cả hai trình duyệt cùng
lúc. Hình nền TyranWeb (`tyran://userdata/…`) được đọc từ thư mục hình nền của TyranWeb
(`wallpaper-folder.json`); hình nền có sẵn trong TyranWeb (`tyran://assets/…`) và sảnh game thì không có.
Tệp cũ của bản trước (`sessions.json`, `scans.json`) được chuyển sang một lần rồi để lại thành `*.old`.

**Đồng bộ data từ TyranWeb** / *Sync data from TyranWeb* (`core/src/tyransync.rs`, `ui/js/tyransync.js`):
khi tìm thấy TyranWeb **1.8.0 trở lên** (mục gỡ cài đặt, lối tắt Desktop / Start menu, tiến trình đang
chạy, thư mục cài thường gặp; phiên bản đọc từ tệp exe), trình duyệt hỏi **một lần** lúc khởi động:
Không / Có, đồng bộ (nút đỏ). Câu trả lời ghi ở `profile\unk\tyran-sync.json` (ngoài thư mục dữ liệu);
hộp hỏi bị đóng mà chưa chọn thì lần mở sau hỏi lại.

Đồng bộ = các tệp data của TyranWeb được **chép** sang thư mục riêng của Wings ở lần mở tới (trình
duyệt khởi động lại ngay): cài đặt, lịch sử, dấu trang, tải xuống, session, nhóm cửa sổ…; bản cũ cất
trong `before-import-<thời gian>\`; tệp data của TyranWeb chỉ được đọc. **Riêng ảnh nền / video nền dùng
chung thư mục**: `wallpaper-folder.json` trong thư mục dữ liệu trỏ tới thư mục hình nền của TyranWeb (cái
nó ghi trong `wallpaper-folder.json`, hoặc `%APPDATA%\TyranWeb\wallpapers`), dùng tại chỗ — nhạc nền
(`music/`) và hình nền web (`live/`) nằm cùng thư mục nên cũng dùng chung.

Thư mục dùng chung được đọc / ghi đúng cấu trúc của TyranWeb (`images/`, `videos/` tên `local-…` /
`video-…`, `thumbnails/<tệp>.thumb.jpg`, `index.json` dạng mảng, `live/index.json`), nên ảnh / video thêm
hay xoá ở một bên thì bên kia cũng thấy; JSON giữ nguyên thứ tự khóa (serde_json `preserve_order`). Địa
chỉ `tyran://userdata/…` ⇄ `resource://unktyran/…`, cả khi là khóa (`frames`,
`music: {"video:<địa chỉ>": …}`); gói hình nền web của TyranWeb (`preset: "package"`) được tìm ra trang
của nó.

Sau này: Cài đặt → Giới thiệu → **Đồng bộ data từ TyranWeb** (nút đỏ) → cảnh báo mất dữ liệu hiện tại,
Hủy / Tiếp tục (nút đỏ) → khởi động lại. Thử lời hỏi với bản TyranWeb cũ hơn: biến môi
trường `UNK_TEST_TYRAN_VERSION=1.8.0` (chỉ để thử).

## Dựng lại

```
cd gecko\core && cargo build --release
node gecko\tools\sync-ui.mjs                (đóng trình duyệt trước, để chép được DLL)
```

## Khác với bản WebView2

- Tiện ích Chrome không chạy được (lõi Gecko không có nền tảng đó); chặn quảng cáo là của trình
  duyệt (adblock-rust + danh sách của Brave/uBO) nên vẫn có.
- Đăng nhập các trang (cookie) không chuyển được từ WebView2: cần đăng nhập lại một lần.
- HTTPS mặc định dùng HTTPS-First của lõi Gecko; chặn cookie bên thứ ba dùng chế độ của lõi.
