# Tình trạng 9Router WeCat

Cập nhật: **2026-10-16**. Đây là nơi duy nhất ghi "đang ở đâu". Cập nhật file này trong cùng PR khi nâng upstream, và sau mỗi lần rollout production. Chỉ dùng tên vai trò primary/secondary; hostname, IP và credential không vào repo.

## Upstream

- Nguồn: [`decolua/9router`](https://github.com/decolua/9router), phát hành bằng tag `vX.Y.Z` trên `master`.
- Bản đang chạy production: **0.5.99**, commit `ce4460ef79382bfddb4aa5fc0ff9f3cb0d5f95a8` (fork `1bb26a28`); giữ làm image rollback khi nâng 0.5.104.
- Candidate **0.5.104** (tag `v0.5.104`, full SHA `87a74e1bda3677193c6f71a7e2100c90311f0689`, ghim trong [`validation.json`](validation.json)). So với 0.5.99: 38 commit, 140 file; không có migration SQLite, dependency không đổi (lock chỉ đổi version). Secondary đã chạy; primary chờ rollout lại (W-017).
- PR #10 squash merge nên `master` không chứa tổ tiên upstream; `prepare-upstream` gặp 19 conflict (merge-base v0.5.95). Fork không sửa file nào trong số đó nên lấy nguyên bản upstream. PR nâng upstream sau nên giữ merge commit để tránh lặp lại.

### Nâng 0.5.104

- Upstream gỡ `gpt-5.5`, `gpt-5.5-review`, `gpt-5.5-image`, `gpt-5.3-image` khỏi catalog Codex. Request tới các model này vẫn được chuyển lên upstream (đã test offline), chỉ mất khỏi `/v1/models`/dashboard; upstream coi `gpt-5.5` là model đã ngừng. app.wecat.vn đã chuyển cấu hình sang model 5.6 trước đợt nâng; contract giữ kiểm tra passthrough cho `gpt-5.5-image`.
- Ảnh dạng tool (`gpt-image-*`) đổi model điều phối `gpt-5.5` → `gpt-5.6-sol`. Contract kiểm tool model giữ nguyên và model điều phối còn trong catalog; canary thật chạy thêm `gpt-image-2` (primary) hoặc `gpt-image-2.5-sunburst` (secondary), song song với ảnh luna để không kéo dài thời gian giữ gate. Canary dùng 3 lượt gọi thật.
- `/v1/models` liệt kê thêm provider miễn phí không cần auth (opencode, …); khả năng gọi đã có từ 0.5.99. ACL theo key vẫn không bật.

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

Image 0.5.104 do gate operator build (amd64) trên `fd6da50f`: `wecat-9router:0.5.104-fd6da50fd740`, ID `sha256:96247a24ebe5f7d25dbbe328c0b96f2ab6ebb214d070ae481c83c748cabf48cc`. Đã nạp sang cả hai host qua SSH và so ID với receipt. Image 0.5.99 (`wecat-9router:0.5.99-1bb26a28395b`) giữ làm rollback trên cả hai host.

| Vai trò | Phiên bản đang chạy | Kết quả 16/10/2026 | Dữ liệu/cấu hình | Rollback giữ trên host |
|---|---|---|---|---|
| primary | 0.5.99 (rollback) | shadow đạt; canary 0.5.104 đạt (chat 200, luna-image 200, `gpt-image-2` 200). Monitor fail sau 30 s: kernel TCP OOM khi thả hàng đợi giờ cao điểm (W-017); tự rollback 0.5.99, 0.5.99 gặp cùng lỗi rồi hồi sau khoảng 1 phút. Chờ rollout lại ngoài giờ cao điểm | key/provider/cấu hình giữ nguyên, SQLite ok | image 0.5.99 + compose cũ + SQLite backup API + full volume khi writer dừng |
| secondary | 0.5.104 | shadow đạt; gate `hold-if-idle`; chat 200 (~1.9 s), luna-image 200 (~29 s), `gpt-image-2.5-sunburst` 200 (~35 s); monitor 180 s đạt, RestartCount=0; gate held=false, queued=0; HTTPS login 200, `/v1/models` không key 401 | API key 1→1, provider 6→6; settings/proxy/key giữ nguyên, SQLite ok; ACL mới vẫn không bật | image 0.5.99 + env cũ + SQLite backup API + full volume khi writer dừng, ngoài cây deploy ứng dụng |

Ledger hiện tại: [`releases/0.5.104-fd6da50f.json`](releases/0.5.104-fd6da50f.json) (**partial rollout**, primary chờ). Lịch sử: [`releases/0.5.99-1bb26a28.json`](releases/0.5.99-1bb26a28.json), [`releases/0.5.95-556b4a96.json`](releases/0.5.95-556b4a96.json), [`releases/0.5.95.json`](releases/0.5.95.json).

Lưu ý vận hành:

- Image chỉ có trên host, không có trong registry. Vì vậy `docker compose pull` toàn stack trên secondary sẽ lỗi ở service router. Script deploy của ứng dụng chỉ pull `api web worker backup`, nên không bị ảnh hưởng.
- Health/auth 200 không chứng minh inference tốt: lượt 11/10 secondary healthy nhưng chat 503 vì credential. Luôn đối chứng chat trên bản đang chạy trước khi kết luận regression. Chỉ một container mount volume router production; shadow đã dọn.
- Lượt 0.5.99 trên secondary dùng script handoff riêng của operator (backup → shadow → `hold-if-idle` → đổi `ROUTER_IMAGE` → canary → monitor → tự rollback), không dùng bản `deploy-router.sh` cho image local như lượt 0.5.95. RUNBOOK mục secondary vẫn mô tả cách cũ; cần thống nhất trước đợt sau.

## Còn mở

1. **`docker-compose.yml` của upstream trỏ `decolua/9router:latest`.** Không dùng file này cho production WeCat. Giữ nguyên vì là file upstream.
2. **Primary chưa lên 0.5.104 (W-017).** Rollout lúc ít traffic. Gate tạm của script primary thả cả hàng đợi một lúc và không trừ request đã mất client; nên sửa trước đợt sau.

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
| 2026-10-16 | Nâng upstream 0.5.104 ([PR #12](https://github.com/wecat-team/9router/pull/12)). secondary → 0.5.104 đạt. primary: canary đạt nhưng monitor fail do TCP OOM của host khi thả hàng đợi giờ cao điểm (W-017), rollback 0.5.99 |
