# Tình trạng 9Router WeCat

Cập nhật: **2026-10-12**. Đây là nơi duy nhất ghi "đang ở đâu". Cập nhật file này trong cùng PR khi nâng upstream, và sau mỗi lần rollout production. Chỉ dùng tên vai trò primary/secondary; hostname, IP và credential không vào repo.

## Upstream

- Nguồn: [`decolua/9router`](https://github.com/decolua/9router), phát hành bằng tag `vX.Y.Z` trên `master`.
- Bản trước: **0.5.95**, commit `a99cf57239ff778b61e434c2786009d5ed1c412c`; giữ làm image rollback trên cả hai host.
- Đã đồng bộ **0.5.99** từ `upstream/master`, ghim full SHA `ce4460ef79382bfddb4aa5fc0ff9f3cb0d5f95a8` trong [`validation.json`](validation.json). So với bản trước: 29 commit, 163 file thay đổi. Cả primary và secondary đã qua canary thật.
- Kiểm ngày 2026-10-10: candidate được chuẩn bị bằng `prepare-upstream.mjs master --no-commit`, rồi chốt commit và PR sau review. Gate phát hành phải chạy trên checkout sạch và receipt phải đúng commit/image, không dùng receipt diagnostic của lượt review.

## Fork

- [PR #10](https://github.com/wecat-team/9router/pull/10) đã squash merge theo bảo vệ lịch sử tuyến tính. Commit phát hành: `1bb26a28395bf77bceb6196bca8f8494c1108676`. [Validation PR](https://github.com/wecat-team/9router/actions/runs/38022476245) và [validation master](https://github.com/wecat-team/9router/actions/runs/38022748879) đạt; receipt master đã tải kiểm tra.
- Bảo vệ `master`: bắt buộc PR và check `WeCat release gate` từ GitHub Actions, chặn force-push và xóa nhánh. Workflow validation đang active; các workflow publish/deploy/watch vẫn tắt. Gate phát hành image production vẫn chạy trên máy operator.
- Theo dõi vận hành: [issue #2](https://github.com/wecat-team/9router/issues/2). Lỗi mới mở theo template *WeCat build / regression*.

### Phát hành 0.5.99

- Operator ngày 2026-10-10 đã cho phép chạy Actions validation; chỉ khi đạt mới merge, chạy gate trên commit master, canary và rollout primary rồi secondary. Giữ nguyên API key/cấu hình và chuẩn bị rollback; không deploy tự động từ PR/push.
- [Validation thủ công trên candidate ban đầu](https://github.com/wecat-team/9router/actions/runs/38022169631) đã đạt, nhưng check `workflow_dispatch` không mở khóa check bắt buộc của PR. Commit tài liệu tiếp theo không có skip instruction để validation chạy theo sự kiện PR; giữ nguyên workflow và bảo vệ master.
- API key cũ mặc định không bị giới hạn sau khi thêm hai cột `accessRestricted`/`accessAllow`. Rollback image 0.5.95 đọc được DB mở rộng, nhưng không thực thi ACL mới: không bật hạn chế key trong đợt nâng đầu tiên.
- Gate operator trên SHA master đạt: ops, contracts, mutation, 95 test critical, build amd64, API/browser smoke (0 lỗi JavaScript) và receipt đúng commit/image/lock. 132 test bổ sung đạt. Test synthetic chạy lại trên image phát hành: 0.5.95 → 0.5.99 → 0.5.95 giữ key, sáu provider giả và usage; SQLite/backup schema đạt.
- Token ảnh Codex được ghi vào Usage khi provider trả usage; giá USD cho model `*-image` có thể dùng giá text hoặc bằng 0 nếu chưa cấu hình giá riêng. Không coi đó là hóa đơn/quota thực tế.
- Payload ảnh, binary endpoint, danh sách model Codex và refresh Codex không đổi. Review dependency lock giữ version cũ cho dependency hiện hữu; thêm AWS/Smithy và `enquirer`. `npm audit` vẫn có 9 cảnh báo có sẵn (7 high, 2 moderate), không thêm so với baseline; đây không phải kết luận không còn rủi ro bảo mật.
- Canary primary đạt ngày 10/10. Secondary lượt 11/10 tự rollback khi canary không đạt (W-016); ngày 12/10 operator đăng nhập lại sáu OAuth Codex trên chính secondary (không chép credential từ host khác), đối chứng 0.5.95 chat 200, rồi rollout lại đạt canary/monitor. Không bypass canary.

## Production

Image 0.5.99 do gate operator build (amd64): `wecat-9router:0.5.99-1bb26a28395b`, ID `sha256:2e3a8604500a30770968743f9ec481a777b38ab494777cecbda2419f2ead1b47`. Đã nạp sang cả hai host qua SSH và so ID với receipt; cả hai host đã được chấp nhận chạy image này. Không deploy qua registry/GitHub Actions.

| Vai trò | Phiên bản đang chạy | Kết quả 10–12/10/2026 | Dữ liệu/cấu hình | Rollback giữ trên host |
|---|---|---|---|---|
| primary | 0.5.99 | shadow đạt; chat 200 (~3 s), PNG hai reference 200 (~89 s, 984057 byte); monitor 180 s đạt, RestartCount=0; proxy tạm drain rồi dọn; kiểm lại HTTPS auth/phiên bản ngày 11/10 đạt | API key 3→3, provider 6→6; fingerprint settings/proxy/key giữ nguyên, SQLite ok | image 0.5.95 + compose/env cũ + SQLite backup API đã kiểm integrity + full volume khi writer dừng |
| secondary | 0.5.99 (12/10) | 11/10: canary không đạt, tự rollback 0.5.95 (OAuth Codex refresh-invalid/401, W-016). 12/10 sau đăng nhập lại: đối chứng 0.5.95 chat 200; shadow đạt; gate `hold-if-idle`; chat 200 (~3.7 s, một tài khoản 429 rồi fallback), PNG hai reference 200 (~97 s, 158644 byte); monitor 180 s đạt, RestartCount=0; gate held=false, queued=0; HTTPS login 200, `/v1/models` không key 401; traffic ảnh thật sau rollout thành công | API key 1→1, provider 6→6; settings/proxy/key giữ nguyên, SQLite ok; ACL mới vẫn không bật | image 0.5.95 + env cũ + SQLite backup API + full volume khi writer dừng, ngoài cây deploy ứng dụng |

Ledger hiện tại: [`releases/0.5.99-1bb26a28.json`](releases/0.5.99-1bb26a28.json) (cả hai production đã nâng và kiểm chứng). Lịch sử: [`releases/0.5.95-556b4a96.json`](releases/0.5.95-556b4a96.json), [`releases/0.5.95.json`](releases/0.5.95.json).

Lưu ý vận hành:

- Image chỉ có trên host, không có trong registry. Vì vậy `docker compose pull` toàn stack trên secondary sẽ lỗi ở service router. Script deploy của ứng dụng chỉ pull `api web worker backup`, nên không bị ảnh hưởng.
- Health/auth 200 không chứng minh inference tốt: lượt 11/10 secondary healthy nhưng chat 503 vì credential. Luôn đối chứng chat trên bản đang chạy trước khi kết luận regression. Chỉ một container mount volume router production; shadow đã dọn.
- Lượt 0.5.99 trên secondary dùng script handoff riêng của operator (backup → shadow → `hold-if-idle` → đổi `ROUTER_IMAGE` → canary → monitor → tự rollback), không dùng bản `deploy-router.sh` cho image local như lượt 0.5.95. RUNBOOK mục secondary vẫn mô tả cách cũ; cần thống nhất trước đợt sau.

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
| 2026-10-10 | Nâng upstream 0.5.99 ([PR #10](https://github.com/wecat-team/9router/pull/10)); Actions validation được operator cho phép, bật lại check bắt buộc. primary → 0.5.99 (`wecat-9router:0.5.99-1bb26a28395b`), canary/monitor đạt |
| 2026-10-11 | secondary: canary 0.5.99 không đạt, tự rollback về 0.5.95 (W-015, W-016). Chặn bởi OAuth Codex refresh-invalid/401; chờ operator đăng nhập lại |
| 2026-10-12 | secondary: operator đăng nhập lại sáu OAuth Codex; rollout 0.5.99 đạt canary/monitor. Cả hai production chạy 0.5.99 |
