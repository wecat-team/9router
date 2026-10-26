# Model Codex qua 9Router (0.5.111)

Tài liệu đối chiếu cho app gọi gateway (app.wecat.vn và các app khác). Cập nhật file này mỗi khi nâng upstream có đổi catalog Codex.

- Nguồn catalog: `open-sse/providers/registry/codex.js` tại upstream `v0.5.111` (`3a978a63`). App gọi với prefix `cx/`, ví dụ `cx/gpt-5.6-terra`.
- Giá: USD/1 triệu token vào/ra, lấy từ `open-sse/providers/pricing.js`. Đây là ước tính 9Router dùng cho trang Usage, **không phải hóa đơn**: Codex dùng quota tài khoản ChatGPT.
- Bằng chứng production: số request thành công trong 14 ngày đến 16/10/2026, gộp theo model, không có dữ liệu khách hàng.
- Model có trong catalog chưa chắc tài khoản dùng được. Trước khi bật model mới trong app, thử ít nhất một lượt thật với đúng payload của app.

## Chat / vision

| Model (`cx/…`) | Giá vào/ra | app.wecat.vn | Production 14 ngày | Ghi chú |
|---|---|---|---|---|
| `gpt-5.6-luna` | 1 / 6 | có | primary 1 | rẻ nhất họ 5.6 |
| `gpt-5.6-terra` | 2,5 / 15 | có, **mặc định** text/copy | primary ~131k | canary chat mỗi lượt rollout |
| `gpt-5.6-sol` | 5 / 30 | có | primary ~10k | kiểm qua HTTPS 16/10: 200 |
| `gpt-6-astra` | 10 / 50 | có | secondary 431 | đắt nhất |
| `gpt-6.1-sol` | 2 / 10 | **chưa** | secondary 38 | `responsesLite`; preset mặc định của Codex CLI upstream |
| `gpt-6-sol` | 2 / 10 | **chưa** | chưa có | `responsesLite`; từ 0.5.111 là model điều phối tool `gpt-image-*` (canary mỗi lượt rollout kiểm qua tool) |
| `gpt-6-luna` | 0,1 / 0,5 | **chưa** | chưa có | `responsesLite`; chưa thử với tài khoản WeCat |

Biến thể không dùng cho app: hậu tố `[1m]` (context mở rộng, cùng model upstream), hậu tố `-review` (tính vào quota review), `gpt-daybreak-blue-latest`, `gpt-reserve`, `codex-auto-review`.

## Ảnh

| Model (`cx/…`) | Kiểu | app.wecat.vn | Production 14 ngày | Ghi chú |
|---|---|---|---|---|
| `gpt-5.6-luna-image` | model chính vẽ | có, **mặc định** | primary ~83k | **gỡ khỏi catalog từ 0.5.111**, request vẫn đi tiếp (contract); canary ảnh mỗi lượt rollout |
| `gpt-5.6-terra-image` | model chính vẽ | có, mặc định Làm mới listing | primary ~12k | gỡ khỏi catalog từ 0.5.111, request vẫn đi tiếp (contract) |
| `gpt-5.6-sol-image` | model chính vẽ | có | primary ~8k | gỡ khỏi catalog từ 0.5.111, request vẫn đi tiếp (contract); thay `gpt-5.5-image` |
| `gpt-6-sol-image` | model chính vẽ | **chưa** | chưa có | có trong catalog từ 0.5.111, thay nhóm `gpt-5.6-*-image`; chưa thử với ảnh tham chiếu |
| `gpt-image-2.5` | tool | có | secondary 3 | |
| `gpt-image-2.5-flare` | tool | có | chưa có | |
| `gpt-image-2.5-sunburst` | tool | có | secondary 852 | canary secondary |
| `gpt-image-2` | tool | có | primary ~1,6k (đến 14/10) | canary primary |
| `gpt-image-1.5` | tool | có | secondary 2 | |

- **Model chính vẽ** (`<model>-image`): 9Router bỏ hậu tố `-image` rồi gọi model đó kèm tool sinh ảnh. Chi phí theo model chính.
- **Tool** (`gpt-image-*`): model điều phối là `gpt-6-sol` từ 0.5.111 (0.5.109: `gpt-5.6-terra`, 0.5.104: `gpt-5.6-sol`, trước đó `gpt-5.5`), model vẽ là chính model tool. Nếu tài khoản nào không được dùng model điều phối thì mọi tool ảnh trên tài khoản đó lỗi; canary `gpt-image-*` bắt trường hợp này.
- Ảnh tham chiếu: `image` là chuỗi khi có một ảnh, `images` là mảng khi có nhiều ảnh; `response_format=binary` đặt trên query.

## Đã gỡ hoặc không có trong catalog

- `gpt-5.5`, `gpt-5.5-review`, `gpt-5.5-image`, `gpt-5.3-image`: upstream gỡ từ 0.5.104 vì coi là model đã ngừng. Request vẫn được chuyển lên upstream, nhưng có thể trả 400 bất cứ lúc nào. app.wecat.vn đã thôi dùng (map sang `gpt-5.6-sol-image` / `gpt-5.6-terra`, migration 0080).
- `gpt-5.6-luna-image`, `gpt-5.6-terra-image`, `gpt-5.6-sol-image`: upstream gỡ từ 0.5.111 vì coi `gpt-6-sol-image` thay thế. Request vẫn được chuyển lên upstream với model chính `gpt-5.6-*` kèm đủ ảnh tham chiếu (contract kiểm offline mỗi lần gate), chỉ mất khỏi `/v1/models`/dashboard. app.wecat.vn ghi cứng danh sách model nên không bị ảnh hưởng. Đổi mặc định sang `gpt-6-sol-image` là việc riêng của app, chỉ làm sau khi thử thật đạt.
- Chỉ `gpt-6-sol-image` có trong catalog. Các `gpt-6-…-image` khác vẫn được chuyển thành model chính kèm tool sinh ảnh nhưng chưa được kiểm; app từng ghi nhận `gpt-6-astra-image` kèm ảnh tham chiếu trả 502 (19/09). Không bật model nào cho đến khi thử đạt với ảnh tham chiếu.

## Khi cập nhật danh sách model ở app

1. Chỉ thêm model có trong bảng trên. Gỡ model khỏi app trước khi gateway gỡ nó.
2. Model mới: thử một lượt thật với đúng payload của app (vision, JSON có cấu trúc, ảnh tham chiếu) và ghi kết quả vào PR của app.
3. Đổi model mặc định hoặc gỡ model: migration cấu hình đã lưu, có bảng backup để downgrade (tiền lệ migration 0080).
4. Sau deploy app: kiểm usage gateway theo model; không còn request tới model đã gỡ.
5. Khi nâng 9Router có đổi catalog: cập nhật file này trong cùng PR nâng upstream.
