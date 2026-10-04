# Runbook nâng cấp hai production VPS

Dùng tên vai trò `primary` và `secondary`; hostname/SSH identity/secret thực tế nằm ngoài repo public. Rollout do operator chạy từ máy local qua SSH; GitHub Actions không có quyền SSH và không deploy.

## Điều kiện phát hành

- PR đã review và merge vào `master`; gate chạy trên máy operator (không dùng CI).
- Deploy **thủ công từ máy operator**, không qua GitHub Actions hay registry. Trên checkout sạch của commit đó, chạy gate với image amd64 (giống kiến trúc hai host), rồi nạp image sang từng host:

  ```sh
  DOCKER_DEFAULT_PLATFORM=linux/amd64 node wecat/check.mjs   # Mac ARM build amd64 qua giả lập nên chậm
  node wecat/verify-receipt.mjs
  node wecat/ship-image.mjs <ssh-primary> <ssh-secondary>    # docker save | ssh docker load, so image ID với receipt
  ```

  Image trên host tên `wecat-9router:<version>-<sha12>`, image ID phải trùng receipt. Không pull `latest` trên prod.
- Đọc INCIDENTS; xác định model WeCat đang sử dụng và khác biệt từ release trước.
- Có backup SQLite được tạo bằng SQLite backup API, chạy `integrity_check`, quyền 600; backup cấu hình trong thư mục quyền 700. Giữ image cũ và bí mật hiện tại.
- Khóa rollout toàn host, không đồng thời với rollout app khác.

## Quy trình mỗi host

1. Clone **backup nhất quán** sang shadow volume, không mount production volume cho candidate. Đặt `DISABLE_BACKGROUND_TOKEN_REFRESH=true` trên shadow để tránh hai tiến trình cùng refresh tài khoản.
2. Kiểm health, auth/model catalog và fingerprint API key / provider IDs trên shadow. Canary thật chỉ chạy ở thời điểm đã kiểm soát credential/writer; không clone tài khoản rồi cho hai background refresher cùng chạy.
3. Primary: kiểm tra gateway Docker và đặt `WECAT_TRUSTED_PROXY_IPS` là allowlist IP chính xác. Không dùng wildcard/CIDR hoặc tin mọi `X-Forwarded-For`. Secondary dùng reverse proxy/gate hiện hữu; không cần chép IP của primary.
4. Gate giữ **request mới**, cho request đang chạy hoàn tất. `POST /hold-if-idle` phù hợp lúc ít traffic; nếu traffic liên tục, dùng `POST /hold` rồi đợi `active=0`. GET stream read-only đã được loại khỏi bộ đếm; chúng reconnect khi chuyển phiên bản.
5. Lấy backup cuối ở boundary. Dừng writer cũ trước khi start writer mới trên production volume. Giữ nguyên API key, provider, JWT/API-key secret và machine salt.
6. Health/auth/model catalog; xác nhận API key và provider IDs còn nguyên; integrity_check.
7. Canary chat + PNG binary có **hai ảnh tham chiếu hợp lệ**. Dùng đúng payload WeCat: `image` là chuỗi cho một ảnh; `images` là mảng cho nhiều ảnh; `response_format=binary` trên query. Mức chất lượng `low` cho smoke để giới hạn chi phí.
8. Resume traffic, xác minh gate `held=false`, `queued=0`. Theo dõi ít nhất ba phút: container health, RestartCount, lỗi SQLite, HTTP lỗi và request thực tế từ app gọi gateway. Không dùng health 200 để kết luận inference thành công.
9. Chỉ sau khi host thứ nhất đạt mới chuyển host thứ hai. Khôi phục cấu hình proxy bình thường và drain proxy tạm trước khi xóa. Giữ backup và image rollback, ghi kết quả vào ledger/issue bằng dữ liệu đã lọc.

### Lệnh theo vai trò

- **primary** (compose một service, không có gate): kiểm không còn kết nối tới cổng router, `docker compose stop`, backup volume khi đã dừng, đổi `image:` trong compose sang `wecat-9router:<version>-<sha12>` (`pull_policy: never`), `docker compose up -d`. So số API key/provider và `integrity_check` trước và sau. Rollback: trả compose cũ rồi `up -d`.
- **secondary** (stack ứng dụng có router-gate): chạy script rollout của repo ứng dụng với tên image local, bằng user `deploy`. Script lo backup, shadow clone, giữ gate, đổi container, canary, theo dõi và tự khôi phục. Bản dùng cho image local chỉ khác bản gốc hai điểm: nhận tên `wecat-9router:<version>-<sha12>`, và chỉ pull khi image chưa có trên host.

## Canary thật

Đây là một thao tác dùng quota: mặc định không chạy trong gate. Operator được phép truyền `WECAT_CANARY_BASE_URL` (base `/v1`), `WECAT_CANARY_API_KEY`, `WECAT_CANARY_TARGET=primary|secondary` qua cơ chế secret an toàn, rồi gọi:

```sh
node wecat/live-canary.mjs --allow-live
```

Tối đa hai request: chat 32 tokens, ảnh 1024 low với hai reference PNG 128×128 có CRC/IDAT hợp lệ. Report chỉ chứa target role, status, thời gian, kích thước ảnh; không chứa key, prompt, output image hoặc tài khoản. Không paste `.env`, response token hay cookie lên GitHub.

## Rollback

- Trước handoff thất bại: giữ service cũ, mở gate, drain shadow rồi xóa shadow.
- Sau handoff canary/health thất bại: giữ intake, dừng writer mới, đưa image/config cũ trở lại, kiểm SQLite/auth rồi mở gate.
- Chỉ restore DB snapshot khi cần và đã dừng mọi writer. Nếu schema không đổi và DB vẫn tốt, rollback image trên volume hiện tại tránh làm mất token refresh/usage mới.
- Không rollback một service đã đạt chỉ vì dọn proxy tạm chậm. Giữ proxy passthrough tới khi request của nó drain; phân biệt lỗi cleanup với lỗi application.
- Không chạy `docker system prune`, xóa volume hoặc reset repo chứa thay đổi không thuộc release này.

## Bằng chứng cần lưu

Upstream SHA, fork SHA, dependency hashes, image digest, thời điểm/role, backup path riêng tư, key/provider preservation (boolean/count, không giá trị), canary result, health/RestartCount, gate resumed, rollback decision. Receipt local và canary prod phải được ghi thành hai loại bằng chứng riêng.
