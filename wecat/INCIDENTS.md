# Sự cố và kiểm tra chống tái diễn

W-001…W-012 đến từ đợt nâng 0.5.91 → 0.5.95 ngày 01/10/2026; mục sau đó ghi ngày riêng. Đã lược bỏ host/credential/dữ liệu khách hàng. Không coi mọi lỗi dưới đây là bug application.

| ID | Hiện tượng / nguyên nhân | Xử lý | Check hiện tại |
|---|---|---|---|
| W-001 | Canary ảnh dùng mẫu PNG 1px lỗi, bị trả 400; có thể bị hiểu nhầm là regression | Chạy đối chứng release cũ, thay fixture PNG hợp lệ 128×128 | CRC/IDAT validator + test fixture cũ bị từ chối |
| W-002 | Chờ idle tự nhiên không đạt khi nhiều job liên tục; timeout 180s không đủ | Gate giữ intake mới rồi drain các request cũ | Ops test: hold lúc active, request cũ hoàn tất, request mới chỉ chạy sau resume |
| W-003 | `exec 9>lock` bị từ chối trên lock của user khác trong sticky directory với fs.protected_regular | Mở lock có sẵn mà không O_CREAT, không unlink lock của rollout khác | Runbook/operator review; cần kiểm trên host thật, không giả vờ CI đã tái hiện kernel policy |
| W-004 | Smoke cũ đòi đúng một image usage row/token metadata, trong khi đã chuyển sang official upstream | Kiểm contract thực: HTTP, PNG/reference, preservation; kiểm ledger riêng nếu sản phẩm cần | Critical image tests + container API smoke |
| W-005 | Image chỉ có trên máy, tag đã ghi vào prod nhưng registry chưa có | Publish artifact đã kiểm bằng immutable SHA tag, verify digest | Receipt identity + manual publish workflow |
| W-006 | Test upstream ghim Codex header 0.154.0 nhưng runtime đã 0.159.0; kỳ vọng refresh sớm 5 ngày trong khi fix mới dùng 10 phút | Sửa kỳ vọng test theo identity nguồn chuẩn và hành vi refresh mới | 8 critical suites; floor version và contract checks |
| W-007 | Test dùng path tương đối `../open-sse`, chạy sai cwd làm lỗi collection | Runner chạy vitest từ tests/ | Critical runner; lỗi collection chặn gate |
| W-008 | Browser login render phía client; chỉ tìm chữ password trong HTML ban đầu gây false failure | Test browser thật và backend auth độc lập | Playwright login → Providers, JS error count=0 |
| W-009 | Receipt của bản cũ hoặc dirty checkout được dùng cho image mới | Diagnostic không được publish; bind full commit, image ID và lock hash | Negative receipt tests + verify-receipt |
| W-010 | Xóa/kill proxy tạm khi còn request có thể cắt các lượt sinh ảnh | Drain proxy; cleanup không là lý do rollback service đã đạt | Gate tests + rollback checklist |
| W-012 | GitHub artifact uploader bỏ qua .reports vì là thư mục ẩn, CI vẫn xanh nhưng không có evidence | include-hidden-files=true trong đúng thư mục đã lọc; if-no-files-found=error; kiểm download artifact thực tế | Workflow upload fail-closed và xác minh artifact sau CI |
| W-011 | Request đã hủy trong hàng đợi bị gửi tiếp sau resume, gây gọi/billing trùng | Loại queued entry khi client đóng | Abort-before-resume test, upstream call count=0 |
| W-014 | (04/10/2026) Lần chạy publish đầu tiên đỏ ở browser smoke: `page.goto(..., networkidle)` quá 30s, trong khi gate trên master cùng commit vẫn xanh. Dashboard có request giữ kết nối nên "network idle" không ổn định | Chờ đúng response `GET /api/providers` của trang rồi mới kiểm lỗi JS | Container smoke; publish chạy lại gate đầy đủ |
| W-013 | (Local, 23/09/2026) Dev server và container dùng chung một thư mục dữ liệu, nên hai background refresher cùng refresh tài khoản Codex. Refresh token bị xoay vòng làm lỗi `refresh_token_reused`/`invalidated`, nhiều tài khoản phải đăng nhập lại | Mỗi instance một `DATA_DIR` riêng; shadow/candidate đặt `DISABLE_BACKGROUND_TOKEN_REFRESH=true` | Gate chạy với DATA_DIR tạm và tắt refresh; RUNBOOK bước 1–2; hướng dẫn local ở `.github/README.md` |

## Rollout ngày 11–12/10/2026

- **W-015 (vận hành, đã đối chứng):** gate secondary đang deploy chỉ có `/hold-if-idle`, không có `/hold`. Lượt đầu dừng trước handoff; router cũ/gate vẫn healthy. Đọc protocol image hiện hữu rồi dùng hold-if-idle, không thay gate/Caddy. Chỉ retry khi busy 409; lỗi điều khiển khác phải fail-closed.
- **W-016 (fixed, validated 12/10/2026):** canary 0.5.99 không đạt; tự rollback về 0.5.95 và resume gate. Backup boundary trước handoff đã có sáu provider Codex refresh-invalid/401; đối chứng chat 0.5.95 cũng 503. API key/settings/proxy và SQLite vẫn nguyên. Chỉ một container mount volume router production; shadow đã dọn và đã tắt background refresh khi chạy. Xử lý: operator đăng nhập lại sáu OAuth Codex trên chính secondary (không chép credential từ host khác); đối chứng 0.5.95 chat 200, rồi rollout lại 0.5.99 đạt canary chat + PNG hai reference và monitor 180 s. Kết luận: lỗi do credential, không phải regression của 0.5.99. Nguyên nhân token invalid trước đó chưa xác định. Bài học: health/auth 200 không chứng minh inference, luôn đối chứng chat trên bản đang chạy trước khi coi là regression.

## Rollout ngày 16/10/2026

- **W-017 (rollout đạt khi ít traffic, gate vẫn mở, primary):** rollout 0.5.104 lúc 10:27 giờ VN (khoảng 1.400 ảnh/giờ). Gate tạm (nginx → gate → router) giữ traffic khoảng 3 phút (drain + canary). Khi resume, 74–146 request ảnh chạy cùng lúc; host 3.9 GB RAM có `tcp_mem` max 87834 trang, kernel báo `TCP: out of memory`, kết nối mới tới Codex `ETIMEDOUT`, router khóa toàn bộ tài khoản theo model. Monitor fail, tự rollback 0.5.99; 0.5.99 gặp cùng lỗi khi nhận đợt dồn sau rollback, nên không phải regression của 0.5.104. Lỗi hết sau khoảng 1 phút. Gate tạm giữ 42 request đã mất client (đếm active không giảm), được gỡ thủ công khi phía client không còn kết nối. Ảnh hưởng app khoảng 10:27–10:37. Hướng xử lý: rollout ngoài giờ cao điểm, gate thả hàng đợi dần và trừ request khi client đóng; tăng `tcp_mem` cần operator duyệt riêng. Log đã che token lưu riêng tư trên host, không vào repo. Nền so sánh: sau sự cố, 0.5.99 trên primary vẫn có `ETIMEDOUT` rải rác (41 lần trong khoảng 3 giờ, không kèm TCP OOM mới); khi đánh giá lượt rollout sau, so với mức nền này, đừng coi mọi `ETIMEDOUT` là regression.
  Sửa gate (fixed, chưa validated): thả hàng đợi theo nhịp (`ROUTER_GATE_RESUME_*`), không vượt `active` tối đa khi xả, bỏ request khi client half-close lúc đang xếp hàng (gate cũ kẹt ở trường hợp này trên Node 22), timeout upstream im lặng. Đối chứng: test mới đỏ với gate cũ ở 3/4 trường hợp. Riêng half-close khi đang chạy thì gate cũ đã xử lý đúng, nên nguyên nhân chính xác của 42 request kẹt chưa được tái hiện; timeout upstream là lớp chặn cuối. Validated chỉ sau một lượt rollout thật giờ cao điểm.
  Rollout lại lúc 23:15 giờ VN (0 request trong 30 phút trước): canary, monitor 180 s và kiểm model app qua HTTPS đều đạt, không có TCP OOM mới, gate tạm tự drain và gỡ. Việc còn mở: gate tạm thả hàng đợi dần và trừ request khi client đóng; chưa sửa thì không rollout primary giờ cao điểm.

## Sự cố ngày 05/11/2026

- **W-018 (ngoài gateway, phía Codex; giảm thiểu bằng app + engine):** từ ~00:05 giờ VN 05/11, mọi model ảnh dạng tool `gpt-image-*` (`gpt-image-1.5`, `gpt-image-2`, `gpt-image-2.5`, `-2.5-flare`, `-2.5-sunburst`) trả HTTP 502 `Codex did not return an image. Account may not be entitled` ở **mọi tài khoản, trên cả hai production**. Thử thật xác nhận cả nhóm hỏng; model ảnh dạng model chính (`gpt-6-sol-image`, `gpt-5.6-*-image`) vẫn chạy. 9Router không đổi phiên bản kể từ 29–30/10 và canary lúc đó đạt, nên là thay đổi phía Codex/OpenAI, không phải regression gateway; upstream chưa có bản sửa. app.wecat.vn gọi `gpt-image-2` ~850 lượt/ngày, chỉ ở 12 cấu hình Product Scenes.
  - **Phía app** ([wecat-product-intelligence#482](https://github.com/wecat-team/wecat-product-intelligence/pull/482), deploy 05/11 02:49 UTC): map 5 id `cx/gpt-image-*` → `cx/gpt-6-sol-image` (migration 0087 có backup), ẩn khỏi dropdown, fallback 1 lần khi gặp lỗi này. Sau deploy, gateway xác nhận 25 phút đầu: 0 request `cx/gpt-image-*`, 0 lỗi "did not return an image", `gpt-6-sol-image` chạy thành công.
  - **Phía gateway** (PR #22): lỗi "did not return an image" trả 502 ổn định, bỏ `retry-after`/đuôi `(reset after …)`, thêm header `x-error-code: image_not_returned` để client không gửi lại cùng model (trước đó mỗi lượt hỏng ~80 s vì client coi là lỗi tạm thời).
  - **Nguyên nhân gốc** (theo [decolua/9router#5477](https://github.com/decolua/9router/pull/5477)): đường ảnh tool gửi `reasoning: { effort: "medium" }`; Codex bắt đầu từ chối với `Complexity 'medium' is not supported for this image model`. Parser bỏ qua `response.failed` nên chỉ hiện lỗi entitlement chung. Đường model chính gửi `reasoning: null` nên không hỏng.
  - **Sửa tận gốc (fixed trên secondary, validated 06/11):** fork áp nguyên #5477 (PR #24, `06c0b645`), rollout **chỉ secondary** 09:35 giờ VN 06/11: canary `gpt-image-2.5-sunburst` 200 (PNG 1254×1254, ~18 s), operator thử `gpt-image-2.5` 200 (~31 s). **Primary giữ `42b7ee16` chờ upstream merge** #5477. Ledger [`releases/0.5.112-06c0b645.json`](releases/0.5.112-06c0b645.json).
  - Bài học: model trong catalog chưa chắc tài khoản dùng được; model ảnh tool phụ thuộc Codex trả ảnh, có thể bị chặn bất cứ lúc nào mà gateway không đổi gì. Ưu tiên model ảnh dạng model chính có trong catalog (`gpt-6-sol-image`).

## Sự cố ngày 10–12/11/2026

- **W-019 (open, primary, 0.5.116): Node hết heap rồi crash giờ cao điểm.** Container primary tự restart 16 lần (exit 139): 15:23 và 15:35 giờ VN 10/11; 12 lần từ 09:58 tới 13:33 giờ VN 12/11. Log ngay trước crash: `FATAL ERROR: Ineffective mark-compacts near heap limit … JavaScript heap out of memory` ở khoảng 1,93 GB (heap mặc định, không đặt `NODE_OPTIONS`). Container trụ 30 phút tới 12 giờ tùy tải; sáng 13/11 RSS 1,86 GB khi mới vào giờ cao điểm. Mỗi lần crash, request đang chạy (chủ yếu ảnh) bị lỗi, dịch vụ gián đoạn khoảng 10–20 s.
  - Đối chứng: 0.5.112 chạy primary 10 ngày (30/10–09/11), RestartCount=0. secondary chạy 0.5.116 cùng image, tải thấp hơn nhiều, không restart.
  - Nghi vấn: 0.5.116 nâng `undici` 7 → 8, gọi Codex qua HTTP/2. Log có `ERR_HTTP2_STREAM_ERROR … NGHTTP2_ENHANCE_YOUR_CALM` ngay trước crash; `ETIMEDOUT` tới Codex cũng tăng (hàng trăm lần/giờ, 09–16h). Chưa có heap snapshot nên chưa xác nhận đúng chỗ giữ bộ nhớ.
  - Hướng xử lý (fixed, chờ validated): upstream 0.5.119 đưa `undici` về 7.x (`94f141dd`). Nâng cả hai host lên 0.5.119; operator duyệt rollout primary ngay giờ cao điểm 13/11 vì crash lặp lại gây gián đoạn nhiều hơn rủi ro W-017. Chỉ ghi validated sau ít nhất một ngày cao điểm RestartCount=0. Cảnh báo `♻️` của `wecat/ops/alert.py` báo khi container tự restart.
  - Kết quả 13/11: primary lên 0.5.119 lúc 10:07; 6 phút đầu 100% 200, 0 lỗi `NGHTTP2`/`ETIMEDOUT` (trước đó hàng trăm lần/giờ), RSS 664 MB (trước đó 1,86 GB lúc vào giờ cao điểm).

## Rollout ngày 13/11/2026

- **W-017 lặp lại (primary, giờ cao điểm, operator duyệt):** lượt 09:07 bằng `operator-rollout.py`. Bước drain chờ request ảnh đang chạy mất ~6 phút; trong lúc giữ, request mới của app (upload ảnh base64 vài MB) dồn vào buffer socket, kernel báo `TCP: out of memory` lúc 09:19. Canary trong container mới không gọi được Codex → `ROLLOUT_FAILED`, tự rollback 0.5.116 (auth đạt). Sau rollback, 0.5.116 tiếp tục lỗi HTTP/2 với Codex vài phút. App gần như không có 200 khoảng 09:12–09:30 (504/499/502). Gate tạm bị giữ (`PASSTHROUGH_RETAINED_FOR_DRAIN`), gỡ tay sau khi kiểm 0 active/queued, 0 peer, nginx đã trỏ thẳng router.
  - Kết luận: thả hàng đợi theo nhịp không đủ; chính việc **giữ** traffic giờ cao điểm làm hết bộ nhớ TCP trên host 3,9 GB. Script chuẩn chỉ dùng cho primary trong khung 04–07h giờ VN.
  - Lượt 10:06: đổi nhanh không giữ traffic (RUNBOOK *Đổi nhanh primary*), đạt; lỗi app chỉ ở phút đổi (37 × 502).
  - Phụ: `backup()` trực tuyến của SQLite (DB 676 MB) không xong được giờ cao điểm vì chạy lại từ đầu mỗi lần có ghi mới; `VACUUM INTO` chụp nhất quán trong ~10 s. Backup cũ nằm trong volume (6,4 GB) bị bước shadow chép theo, suýt làm đầy đĩa: đã xóa bản trước 09/11, shadow không chép thư mục backup.

## Khi phát hiện lỗi mới

Mở issue theo template **WeCat build / regression**, kèm SHA/image digest, stage, lệnh tái hiện và CI artifact đã lọc. Tái hiện trước khi sửa; thêm regression test và mutation/đối chứng nếu phù hợp. Ghi `open`, `fixed`, `validated` khác nhau; chưa có chứng cứ thì không ghi “đã hết lỗi”. Không sửa allowlist known-fails để làm CI xanh.

## Giới hạn

Gate không chứng minh entitlement/quota của provider thật, độ ổn định mạng ngoài, hoặc mọi nhánh toàn suite upstream. Production vẫn cần canary với tài khoản thật, snapshot/rollback và theo dõi sau handoff. Công cụ này giảm các lỗi đã kiểm chứng, không bảo đảm hệ thống không bao giờ lỗi.
