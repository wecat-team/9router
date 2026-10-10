# Tình trạng 9Router WeCat

Cập nhật: **2026-10-10**. Đây là nơi duy nhất ghi "đang ở đâu". Cập nhật file này trong cùng PR khi nâng upstream, và sau mỗi lần rollout production. Chỉ dùng tên vai trò primary/secondary; hostname, IP và credential không vào repo.

## Upstream

- Nguồn: [`decolua/9router`](https://github.com/decolua/9router), phát hành bằng tag `vX.Y.Z` trên `master`.
- Bản trước candidate: **0.5.95**, commit `a99cf57239ff778b61e434c2786009d5ed1c412c`; production vẫn giữ bản này.
- Candidate **0.5.99** lấy từ `upstream/master`, ghim full SHA `ce4460ef79382bfddb4aa5fc0ff9f3cb0d5f95a8` trong [`validation.json`](validation.json). So với bản trước: 29 commit, 163 file thay đổi. Chưa có canary thật hay rollout production cho candidate.
- Kiểm ngày 2026-10-10: candidate được chuẩn bị bằng `prepare-upstream.mjs master --no-commit`, rồi chốt commit và PR sau review. Gate phát hành phải chạy trên checkout sạch và receipt phải đúng commit/image, không dùng receipt diagnostic của lượt review.

## Fork

- `master`: upstream 0.5.95 cộng bootstrap WeCat ([PR #1](https://github.com/wecat-team/9router/pull/1), [PR #3](https://github.com/wecat-team/9router/pull/3)). [Gate trên master](https://github.com/wecat-team/9router/actions/runs/36856218283) đã đạt và có artifact.
- Bảo vệ `master`: bắt buộc PR, chặn force-push và xóa nhánh. Từ 2026-10-04 **không dùng GitHub Actions**: workflow `wecat-*` đã tắt, bỏ status check bắt buộc; gate chạy trên máy operator.
- Theo dõi vận hành: [issue #2](https://github.com/wecat-team/9router/issues/2). Lỗi mới mở theo template *WeCat build / regression*.

### Candidate 0.5.99

- Chỉ chuẩn bị candidate theo quyết định operator ngày 2026-10-10; không đổi bảo vệ master và không deploy từ PR/push.
- Kiểm thực tế ngày 2026-10-10: master vẫn yêu cầu check `WeCat release gate` từ GitHub Actions và workflow `WeCat validation` đang active. Giữ nguyên workflow/bảo vệ theo quyết định operator, không dùng CI/CD cho candidate: commit candidate có `[skip ci]` để PR không tự chạy Actions. Gate local và bình luận PR không thay thế check Actions; PR còn bị chặn merge.
- API key cũ mặc định không bị giới hạn sau khi thêm hai cột `accessRestricted`/`accessAllow`. Rollback image 0.5.95 đọc được DB mở rộng, nhưng không thực thi ACL mới: không bật hạn chế key trong đợt nâng đầu tiên.
- Test synthetic của lượt review: 0.5.95 → 0.5.99 → 0.5.95 giữ API key, sáu provider giả và usage; `integrity_check` đạt, backup trước đổi schema được tạo. Phải chạy lại trên image phát hành trước handoff.
- Token ảnh Codex được ghi vào Usage khi provider trả usage; giá USD cho model `*-image` có thể dùng giá text hoặc bằng 0 nếu chưa cấu hình giá riêng. Không coi đó là hóa đơn/quota thực tế.
- Payload ảnh, binary endpoint, danh sách model Codex và refresh Codex không đổi. Review dependency lock giữ version cũ cho dependency hiện hữu; thêm AWS/Smithy và `enquirer`. `npm audit` vẫn có 9 cảnh báo có sẵn (7 high, 2 moderate), không thêm so với baseline; đây không phải kết luận không còn rủi ro bảo mật.
- Chưa thực hiện canary provider thật trên candidate. Nếu được phép rollout sau này: giữ gate intake, dừng writer cũ trước writer mới, backup SQLite nhất quán và giữ image/config 0.5.95 để rollback theo [RUNBOOK](RUNBOOK.md).

## Production

Từ 2026-10-04, **cả hai host chạy cùng một image do fork build**: `wecat-9router:0.5.95-556b4a96b8a4`, image ID `sha256:861dd56514c27816f5f43ae073c83c545e20eb57612c644cdf0f22b3d3ce41af`, từ `master` [`556b4a96`](https://github.com/wecat-team/9router/commit/556b4a96b8a40b6ef5e8495b873881851db3b13a). Image được build bằng gate trên máy operator (amd64), rồi nạp qua `docker save | ssh docker load`. Không qua registry hay GitHub Actions.

| Vai trò | Phiên bản | Cách rollout | Kết quả 2026-10-04 | Rollback giữ trên host |
|---|---|---|---|---|
| primary | 0.5.95 | compose một service, `pull_policy: never`, `WECAT_TRUSTED_PROXY_IPS` = gateway Docker của nginx | health/login 200, `/v1` thiếu key 401, API key 3→3, provider 6→6, `integrity_check` ok, theo dõi 3 phút RestartCount=0 | image build-tại-host 0.5.95 + compose cũ + backup volume lúc đã dừng |
| secondary | 0.5.95 | script rollout của repo ứng dụng (bản nhận image local) | backup, shadow clone, auth probe, canary chat ok, canary ảnh với ảnh tham chiếu ok (PNG 633 KB, 20 s), gate healthy, RestartCount=0 | image 0.5.95 cũ + backup SQLite trước rollout |

Ledger: [`releases/0.5.95-556b4a96.json`](releases/0.5.95-556b4a96.json). Bản rollout trước khi có gate: [`releases/0.5.95.json`](releases/0.5.95.json).

Lưu ý vận hành:

- Image chỉ có trên host, không có trong registry. Vì vậy `docker compose pull` toàn stack trên secondary sẽ lỗi ở service router. Script deploy của ứng dụng chỉ pull `api web worker backup`, nên không bị ảnh hưởng.
- Primary chưa có canary thật sau rollout. Request ảnh thật đầu tiên sau 16:46 ngày 04/10 là bằng chứng; nếu cần sớm hơn, chạy `live-canary.mjs` theo RUNBOOK.

## Còn mở

1. **`docker-compose.yml` của upstream trỏ `decolua/9router:latest`.** Không dùng file này cho production WeCat. Giữ nguyên vì là file upstream.

## Lịch sử

| Ngày | Sự kiện |
|---|---|
| 2026-09-23 | primary 0.5.81 → 0.5.86 (build từ source, giữ patch IP) |
| 2026-09-24 | secondary 0.5.81 → 0.5.86 (image official, qua script rollout) |
| 2026-10-01 | Cả hai → 0.5.95. Sự cố gặp phải ghi ở [INCIDENTS](INCIDENTS.md) W-001…W-012 |
| 2026-10-01 | Bootstrap fork: gate, receipt, runbook ([PR #1](https://github.com/wecat-team/9router/pull/1), [PR #3](https://github.com/wecat-team/9router/pull/3)) |
| 2026-10-04 | Trang fork `.github/README.md`, STATUS, công cụ theo dõi/nâng upstream ([PR #4](https://github.com/wecat-team/9router/pull/4)); sửa browser smoke chập chờn W-014 ([PR #5](https://github.com/wecat-team/9router/pull/5)) |
| 2026-10-04 | Cả hai host chuyển sang image fork `wecat-9router:0.5.95-556b4a96b8a4`, build và deploy thủ công từ máy operator. Xóa package ghcr publish thử, không dùng. Homepage repo đổi từ 9router.com sang trang fork. Tắt toàn bộ CI/CD (workflow `wecat-*`) |
