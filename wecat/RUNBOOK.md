# Runbook nâng cấp hai production VPS

Dùng tên vai trò `primary` và `secondary`; hostname/SSH identity/secret thực tế nằm ngoài repo public. Rollout do operator chạy từ máy local qua SSH; GitHub Actions không có quyền SSH và không deploy.

## Điều kiện phát hành

- PR đã review và merge vào `master`. Check bắt buộc `WeCat release gate` (Actions validation) phải đạt trên PR; gate phát hành image vẫn chạy trên máy operator.
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
- **Khung giờ:** primary rollout trong 00:00–07:00 giờ VN, khi 30 phút trước đó có dưới khoảng 50 request. Gate đã thả hàng đợi theo nhịp (W-017), nhưng chưa được kiểm bằng rollout thật giờ cao điểm. Secondary rollout lúc ít traffic là đủ, vì gate cố định giữ ở thời điểm rảnh.
- Trước khi chạy: `dmesg` không có `TCP: out of memory` mới; TCP mem trong `/proc/net/sockstat` thấp hơn nhiều so với ngưỡng pressure của `net.ipv4.tcp_mem`; không còn gate tạm hay shadow cũ; cổng gate tạm còn trống.

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

Cả hai host dùng cùng một script handoff của operator. Script nằm trong bộ rollout trên host, **không có trong repo** vì chứa đường dẫn và tên container của từng host.

- Bộ rollout: `/root/wecat-rollout-<version>-<YYYYMMDD>/` trên mỗi host, gồm `operator-rollout.py`, `operator-db.cjs` (chỉ xuất số lượng/fingerprint, không xuất credential), `gate.mjs` (= `wecat/ops/gate.mjs`), `fixtures.mjs` và `live-canary.mjs` (chép từ commit phát hành).
- Mỗi release: chép bộ của lượt trước rồi đổi version trong `operator-rollout.py` (version đích, version đang chạy và tên thư mục backup), sau đó so md5 giữa hai host. Không sửa logic trong lúc rollout.
- Chạy bằng root, tách khỏi phiên SSH để rớt SSH không cắt ngang handoff:

  ```sh
  cd /root/wecat-rollout-<version>-<YYYYMMDD>
  nohup setsid python3 operator-rollout.py <primary|secondary> wecat-9router:<version>-<sha12> <image-id> <fork-commit> > <role>.log 2>&1 < /dev/null &
  ```

- Các mốc trong log: `backup-integrity-ok` → `SHADOW_AUTH_CONFIG_PRESERVATION_PASSED` → `GATE_HELD_BACKUP_VERIFIED_STOPPING_OLD_WRITER` → `LIVE_CANARY_START` → kết quả canary → `TRAFFIC_RESUMED_MONITOR_180_SECONDS` → `Monitor passed …` → `ROLLOUT_PASSED`. Khi lỗi: `ROLLOUT_FAILED` → `ROLLBACK_IMAGE_AUTH_PASSED`.
- **primary** (compose một service, không có gate cố định): script dựng gate tạm `operator-router-gate-<stamp>` trên host network, chuyển `proxy_pass` của nginx sang gate, rồi `POST /hold` và chờ `active=0`. Sau đó đổi `image:` trong compose và `up -d`. Khi xong, nó trả nginx về router và gỡ gate tạm khi `active+queued=0`; backup nằm ở `/opt/9router/operator-<version>-<stamp>/`.
- **secondary** (stack ứng dụng có router-gate cố định): dùng `POST /hold-if-idle` (gate đang deploy không có `/hold`) và retry đến khi rảnh. Sau đó đổi `ROUTER_IMAGE` trong env của stack và `up -d` riêng service router; Caddy và gate không đổi. Backup nằm trong bộ rollout, ngoài cây deploy của ứng dụng.
- Script tự rollback image cũ trên volume hiện tại nếu canary, health hoặc monitor lỗi; schema không đổi thì không restore DB.

### Gate (`wecat/ops/gate.mjs`) và W-017

Lượt 16/10 lúc 10:20 giờ VN: gate tạm thả **cả hàng đợi cùng lúc** sau khi giữ traffic khoảng 3 phút giờ cao điểm. 74–146 request ảnh chạy song song làm kernel hết bộ nhớ TCP (host 3,9 GB RAM), dẫn tới `ETIMEDOUT` tới Codex và khóa toàn bộ tài khoản theo model. Gate còn giữ 42 request mà client đã bỏ.

Từ bản gate có các thay đổi dưới đây (cấu hình qua env khi chạy gate tạm; giá trị 0 là tắt giới hạn tương ứng):

| Env | Mặc định | Tác dụng |
|---|---|---|
| `ROUTER_GATE_RESUME_BATCH` | 4 | Số request thả mỗi nhịp sau `/resume` |
| `ROUTER_GATE_RESUME_INTERVAL_MS` | 1000 | Khoảng cách giữa các nhịp |
| `ROUTER_GATE_RESUME_MAX_ACTIVE` | 64 | Không thả thêm khi `active` đã chạm mức này |
| `ROUTER_GATE_UPSTREAM_IDLE_TIMEOUT_MS` | 600000 | Hủy request mà upstream không gửi byte nào quá lâu (dài hơn timeout ảnh 300 s của app) |

- Trong lúc xả hàng đợi, request mới xếp sau, không vượt hàng; `queued` gồm cả request đang chờ thả. 100 request tồn được thả hết trong khoảng 25 giây.
- Client đóng kết nối (kể cả half-close/FIN) khi đang xếp hàng hay đang chạy thì gate bỏ request, hủy upstream và trả `active` về đúng.
- Bộ rollout trên host chép `gate.mjs` từ commit phát hành: lượt sau phải chép bản mới. Gate cố định của secondary thuộc repo ứng dụng, không đổi.
- **Chưa kiểm bằng rollout thật giờ cao điểm.** Cho đến khi có một lượt như vậy đạt, vẫn ưu tiên khung 00:00–07:00 giờ VN cho primary.
- Gate vẫn kẹt (script báo `TEMPORARY_GATE_PASSTHROUGH_RETAINED_FOR_DRAIN`): kiểm nginx đã trỏ về router và `ss -tn state established "( dport = :<cổng gate> )"` không còn peer, rồi mới `docker stop`/`docker rm` gate tạm.
- Mức nền khi đánh giá: primary có `ETIMEDOUT` rải rác (khoảng 10–15 lần mỗi giờ) ngay cả khi không rollout. Chỉ coi là sự cố khi vượt mức này hoặc có `all … accounts locked`.

## Canary thật

Đây là một thao tác dùng quota: mặc định không chạy trong gate. Operator được phép truyền `WECAT_CANARY_BASE_URL` (base `/v1`), `WECAT_CANARY_API_KEY`, `WECAT_CANARY_TARGET=primary|secondary` qua cơ chế secret an toàn, rồi gọi:

```sh
node wecat/live-canary.mjs --allow-live
```

Ba request: chat 32 tokens, rồi song song hai ảnh 1024 low, mỗi ảnh có hai reference PNG 128×128 có CRC/IDAT hợp lệ: `gpt-5.6-luna-image` và ảnh dạng tool (`gpt-image-2` ở primary, `gpt-image-2.5-sunburst` ở secondary). Report chỉ chứa target role, status, thời gian, kích thước ảnh; không chứa key, prompt, output image hoặc tài khoản. Không paste `.env`, response token hay cookie lên GitHub.

## Rollback

- Trước handoff thất bại: giữ service cũ, mở gate, drain shadow rồi xóa shadow.
- Sau handoff canary/health thất bại: giữ intake, dừng writer mới, đưa image/config cũ trở lại, kiểm SQLite/auth rồi mở gate.
- Chỉ restore DB snapshot khi cần và đã dừng mọi writer. Nếu schema không đổi và DB vẫn tốt, rollback image trên volume hiện tại tránh làm mất token refresh/usage mới.
- Không rollback một service đã đạt chỉ vì dọn proxy tạm chậm. Giữ proxy passthrough tới khi request của nó drain; phân biệt lỗi cleanup với lỗi application.
- Không chạy `docker system prune`, xóa volume hoặc reset repo chứa thay đổi không thuộc release này.

## Sau rollout: đồng bộ app

Khi **cả hai host** đã đạt, chạy bàn giao model cho app gọi gateway theo [APP-SYNC](APP-SYNC.md) trước khi đóng đợt nâng:

```sh
node wecat/app-handoff.mjs v<bản-production-cũ>   # offline: diff catalog/đường model Codex, sinh prompt cho agent repo app
```

Có thay đổi model thì thêm số liệu usage và thử thật (`--usage`, `--probe-live --allow-live`), rồi gửi `wecat/.reports/app-handoff-<version>.md` cho agent ở repo app. Ghi `appHandoff` vào ledger. Không có thay đổi thì ghi `not-needed`.

## Bằng chứng cần lưu

Upstream SHA, fork SHA, dependency hashes, image digest, thời điểm/role, backup path riêng tư, key/provider preservation (boolean/count, không giá trị), canary result, health/RestartCount, gate resumed, rollback decision. Receipt local và canary prod phải được ghi thành hai loại bằng chứng riêng.
