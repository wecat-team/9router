# Đồng bộ app sau khi nâng 9Router

Mỗi lần nâng upstream có thể gỡ, thêm hoặc đổi đường chạy của model Codex. App gọi gateway (app.wecat.vn) ghi cứng tên model và lưu lựa chọn trong DB. Vì vậy gateway đổi mà app không đổi theo thì người dùng gặp lỗi ở bản gateway kế tiếp. Ví dụ 0.5.111 gỡ cả ba `gpt-5.6-*-image`, trong đó có mặc định ảnh của app. Request vẫn chạy nhờ gateway chuyển tiếp model lạ, nhưng không còn được bảo đảm.

Bước này thuộc việc nâng upstream: **chưa xong bàn giao thì chưa đóng đợt nâng**.

## Khi nào chạy

Sau khi **cả hai production** đã rollout đạt bản mới, trước khi chốt ledger của đợt nâng. Chạy cả khi nghĩ là không có gì đổi; công cụ sẽ báo "không cần bàn giao" nếu đúng là vậy.

## Các bước

1. **Diff catalog** (offline, không gọi mạng). Ref cũ là tag upstream của bản production trước, ref mới mặc định là `acceptedUpstreamCommit` trong `validation.json`:

   ```sh
   node wecat/app-handoff.mjs v<bản-cũ>
   ```

   Công cụ so `open-sse/providers/registry/codex.js` (model chat/ảnh, bỏ biến thể `[1m]`, `-review`, STT), model điều phối ảnh dạng tool trong `open-sse/handlers/imageProviders/codex.js` và giá trong `open-sse/providers/pricing.js`. Nếu không có thay đổi, ghi `appHandoff.status = "not-needed"` vào ledger và dừng ở đây.

2. **Số liệu app đang gọi.** Trên primary, đọc DB 9Router ở chế độ chỉ đọc, xuất số request thành công 14 ngày theo model của key app. Chỉ lấy tên model và số đếm, không xuất key hay nội dung request. Lưu file JSON ngoài repo:

   ```sql
   select u.model as model, count(*) as n
   from usageHistory u join apiKeys a on a.key = u.apiKey
   where a.name = 'app.wecat.vn' and datetime(u.timestamp) > datetime('now', '-14 days')
   group by 1 order by 2 desc;
   ```

   Chạy bằng `sqlite3 -json` trên volume dữ liệu. `timestamp` là ISO có chữ `T`, nên phải bọc trong `datetime()` khi so sánh.

3. **Thử thật** (dùng quota, mỗi model một request, gọi tuần tự). Dùng key thử riêng (không dùng key của app), truyền qua env như canary:

   ```sh
   WECAT_CANARY_BASE_URL=<base /v1 của gateway> WECAT_CANARY_API_KEY=<key thử> \
     node wecat/app-handoff.mjs v<bản-cũ> --usage <file.json> --probe-live --allow-live
   ```

   Mặc định thử model mới, model bị gỡ (xem còn chuyển tiếp được không) và một model ảnh dạng tool nếu model điều phối đổi. Ảnh luôn gửi 2 ảnh tham chiếu, `response_format=binary`, `quality: low`. Muốn thử thêm model khác thì dùng `--models a,b`. Kết quả chỉ ghi model, HTTP status, thời gian và kích thước ảnh.

4. **Gửi prompt.** Công cụ ghi `wecat/.reports/app-handoff-<version>.md` (gitignored). Dev đọc lại rồi dán nguyên nội dung vào session agent ở repo app. Prompt yêu cầu agent bên app làm một PR gồm: chuẩn hoá id cũ, đổi mặc định sang model còn trong catalog đã thử đạt, fallback 1 lần khi gateway trả lỗi model-not-supported, test, A/B ảnh thật. Agent không merge và không deploy khi chưa được duyệt.

5. **Theo dõi sau khi app deploy.** Kiểm usage gateway theo model trong 24 giờ: không còn request tới model đã gỡ (trừ job cũ), không có lỗi `model is not supported`/`model_not_found`, tỉ lệ 200 của `/v1/images` và `/v1/chat` không giảm. Cập nhật cột app trong [MODELS](MODELS.md).

6. **Ghi ledger.** Thêm vào `wecat/releases/<version>-<sha8>.json`:

   ```json
   "appHandoff": { "status": "sent | not-needed | done", "date": "YYYY-MM-DD", "removedModelsInUse": ["..."], "probe": "passed | failed | skipped", "appPullRequest": "<link PR app hoặc null>" }
   ```

   `done` khi PR app đã deploy và bước 5 đạt.

## An toàn

- Prompt sinh ra không chứa hostname, key hay ảnh; công cụ có test kiểm điều này. Đừng thêm các thông tin đó khi dán sang repo app.
- Không gỡ model khỏi app khi gateway còn job cũ đang dùng; chuẩn hoá id trước, gỡ sau.
- Model có trong catalog chưa chắc tài khoản dùng được: chỉ đổi mặc định khi bước 3 đạt với đúng payload của app.
- Nếu thử thật lỗi ở model app đang dùng nhiều: coi là sự cố gateway, xử lý theo [RUNBOOK](RUNBOOK.md) (rollback nếu cần) trước khi bàn giao.
