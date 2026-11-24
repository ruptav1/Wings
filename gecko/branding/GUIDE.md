# Wings — Hướng dẫn dùng logo (bản gọn)

## 1. Logo
- **Ý tưởng:** **Sōyoku Kamon (双羽紋)** — đôi cánh hai tầng thanh thoát xoay đối xứng 180° quanh một khoảng
  trời tròn theo tinh thần gia huy Nhật Bản (*kamon*). Hình khối vừa là đôi cánh đang lướt nhẹ, vừa là ô cửa
  tròn nhìn ra web. Màu sắc rút trực tiếp từ hình nền mặc định (`ui\assets\wallpapers\wings-default.jpg`):
  đỏ thẫm – hồng của cánh hoa và trắng ngọc – xanh băng của đôi cánh.
- **Các bản:**
  - biểu tượng màu phẳng (cánh trên đỏ thẫm `#A41154`, cánh dưới hồng trầm `#D4528A`);
  - bản một màu đen (`#000000`);
  - bản đảo màu cho nền tối (trắng `#FFFFFF` + xanh băng ngọc `#E4F1FD`, đã làm mảnh ~3% bù hiệu ứng nở sáng);
  - **bản cỡ nhỏ** cho 16–32 px (mở rộng khe gió giữa 2 tầng lông từ 15 → 22 đơn vị trên lưới 256, khung đầy hơn);
  - **icon app** (đôi cánh trắng & xanh băng ngọc trên ô hồng sakura sáng `#D43B7E` → `#EE75AA` → `#FBBAD5`).
- **Tạo ra từ:** `make-logo.mjs` (kiểu `soyoku`, mặc định). Logo được thiết kế lại theo quy trình skill
  `logo-design` (brief → 3 concept đen trắng → kiểm thử 16 px / nhòe / đảo màu / kệ trình duyệt → chọn B).
  Các concept và bảng kiểm thử nằm trong `concepts-wings\` (bản *Sakura aperture* trước đây vẫn được giữ trong
  `make-logo.mjs` dưới kiểu `sakura` và thư mục `concepts\`).

## 2. File
| Dùng cho | File |
|---|---|
| Icon app (exe, cửa sổ) | `wings.ico` (10 cỡ 16–256 px; 16–32 px vẽ từ bản cỡ nhỏ), `wings.svg`, `wings-small.svg`, `png\` |
| Biểu tượng chính (màu phẳng) | `kit\wings-symbol.svg` |
| Một màu đen | `kit\wings-symbol-black.svg`, `kit\export\wings-black.svg` |
| Trên nền tối (đã làm mảnh ~3%) | `kit\wings-symbol-reversed.svg`, `kit\export\wings-white.svg` |
| Một màu đỏ thẫm | `kit\export\wings-mono-a41154.svg` |
| 16–32 px | `kit\wings-symbol-small.svg`, `kit\export\wings-favicon.svg` |
| Web / PWA | `kit\export\favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest`, `head-snippet.html` |
| Ảnh vuông (avatar, mạng xã hội) | `kit\export\wings-square.svg` và PNG 64/256/1024 |

Giao diện dùng `ui\shared\logo.svg` (bản đầy đủ, trang Giới thiệu — 56 px) và `ui\shared\logo-small.svg`
(bản cỡ nhỏ, thanh tiêu đề 18 px & đầu trang Cài đặt 24 px).

## 3. Khoảng trống quanh logo
Chừa trống ít nhất **¼ chiều cao biểu tượng** (tương đương đường kính khoảng trời tròn bên trong tâm logo ở tỉ
lệ ~½) ở mọi phía. Khoảng trống luôn tỉ lệ theo kích thước hiển thị của logo.

## 4. Cỡ nhỏ nhất
| Bản | Màn hình | In |
|---|---|---|
| Biểu tượng đầy đủ (`wings.svg`, `wings-symbol.svg`) | 40 px | 10 mm |
| Bản cỡ nhỏ (`wings-small.svg`, `wings-symbol-small.svg`) | 16 px | 6 mm |

Từ 32 px trở xuống (taskbar, thanh tiêu đề 18 px, favicon 16 px) luôn dùng bản cỡ nhỏ để khe tách giữa 2 tầng
lông không bị bết pixel.

## 5. Màu
| Tên | HEX | RGB | CMYK (xấp xỉ) | Vai trò |
|---|---|---|---|---|
| Đỏ thẫm (Sakura Crimson) | `#A41154` | 164, 17, 84 | 0, 90, 49, 36 | Cánh trên (biểu tượng chính), bản một màu |
| Hồng trầm (Warm Rose) | `#D4528A` | 212, 82, 138 | 0, 61, 35, 17 | Cánh dưới (biểu tượng chính) |
| Xanh băng ngọc (Ice Pearl) | `#E4F1FD` | 228, 241, 253 | 10, 5, 0, 1 | Cánh dưới trên ô icon & bản nền tối |
| Trắng | `#FFFFFF` | 255, 255, 255 | 0, 0, 0, 0 | Cánh trên trên ô icon & bản nền tối |
| Ô icon: hồng sakura sáng | `#D43B7E` → `#EE75AA` → `#FBBAD5` | | | Chỉ dùng cho nền ô icon app |
| Xanh than (Midnight Navy) | `#363849` | 54, 56, 73 | 26, 23, 0, 71 | Chữ, nền tối giao diện |

Mọi màu rút từ hình nền mặc định `wings-default.jpg`. Khi in ấn, nhờ nhà in so mã Pantone gần nhất với
`#A41154` và `#D4528A`.

**Cặp logo / nền được dùng:**
- bản màu phẳng (`wings-symbol.svg`) trên nền trắng hoặc sáng;
- bản đảo màu (`wings-symbol-reversed.svg`) trên đỏ thẫm, xanh than hoặc nền tối;
- bản đen (`wings-symbol-black.svg`) trên nền trắng (in một màu / khắc laser);
- icon app (`wings.svg` / `wings-small.svg`) giữ nguyên ô nền chuyển sắc — dùng trên ảnh nền, thanh tiêu đề kính mờ, Windows taskbar;
- trên ảnh rối: luôn dùng icon app có ô nền, hoặc đặt bản trắng/đen ở vùng ảnh yên.

Chuyển màu chỉ dùng cho ô icon app. Biểu tượng độc lập luôn là màu phẳng.

## 6. Không nên
- Không tách rời hoặc bẻ lệch góc đối xứng 180° giữa hai cánh.
- Không thu nhỏ khe gió bên trong cánh hoặc thay bằng đường nét mảnh ở cỡ nhỏ.
- Không kéo giãn, bóp méo tỉ lệ 1:1, hay xoay nghiêng tự do làm mất nhịp đứng của đôi cánh.
- Không thêm bóng đổ, viền ngoài hay hiệu ứng 3D lên biểu tượng chính.
- Không đặt bản đỏ thẫm lên nền đỏ/hồng (mất tương phản) — chuyển sang bản đảo màu trắng/xanh băng.
- Không dùng màu ngoài bảng màu chuẩn ở mục 5.

## 7. Lưu ý bàn giao
- Chưa có chữ "Wings" đi kèm (wordmark / lockup). Nếu mở rộng về sau, dựng chữ thành path vector thay vì dùng `<text>`.
- Chưa thực hiện tra cứu nhãn hiệu pháp lý. Trước khi phát hành thương mại rộng rãi, cần tra cơ sở dữ liệu nhãn hiệu và kiểm tra tìm ảnh ngược.
