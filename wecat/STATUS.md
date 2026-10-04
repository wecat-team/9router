# Tình trạng 9Router WeCat

Cập nhật: **2026-10-04**. Đây là nơi duy nhất ghi "đang ở đâu". Cập nhật file này trong cùng PR khi nâng upstream, và sau mỗi lần rollout production. Chỉ dùng tên vai trò primary/secondary; hostname, IP và credential không vào repo.

## Upstream

- Nguồn: [`decolua/9router`](https://github.com/decolua/9router), phát hành bằng tag `vX.Y.Z` trên `master`.
- Fork đã chấp nhận: **0.5.95**, commit `a99cf57239ff778b61e434c2786009d5ed1c412c` (ghi trong [`validation.json`](validation.json)).
- Kiểm ngày 2026-10-04: upstream chưa có tag hay commit mới hơn. Kiểm lại bằng `node wecat/upstream-status.mjs`. Workflow **WeCat upstream watch** cũng kiểm hằng ngày.

## Fork

- `master`: upstream 0.5.95 cộng bootstrap WeCat ([PR #1](https://github.com/wecat-team/9router/pull/1), [PR #3](https://github.com/wecat-team/9router/pull/3)). [Gate trên master](https://github.com/wecat-team/9router/actions/runs/36856218283) đã đạt và có artifact.
- Bảo vệ `master`: bắt buộc PR, check **WeCat release gate**, chặn force-push và xóa nhánh.
- Theo dõi vận hành: [issue #2](https://github.com/wecat-team/9router/issues/2). Lỗi mới mở theo template *WeCat build / regression*.

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
2. **Homepage của repo GitHub vẫn là 9router.com.** Nên đổi sang trang của fork.
3. **Package `ghcr.io/wecat-team/9router:sha-556b4a96…` (private) đã publish thử** nhưng không dùng. Workflow publish vẫn còn và là tùy chọn.

## Lịch sử

| Ngày | Sự kiện |
|---|---|
| 2026-09-23 | primary 0.5.81 → 0.5.86 (build từ source, giữ patch IP) |
| 2026-09-24 | secondary 0.5.81 → 0.5.86 (image official, qua script rollout) |
| 2026-10-01 | Cả hai → 0.5.95. Sự cố gặp phải ghi ở [INCIDENTS](INCIDENTS.md) W-001…W-012 |
| 2026-10-01 | Bootstrap fork: gate, receipt, runbook ([PR #1](https://github.com/wecat-team/9router/pull/1), [PR #3](https://github.com/wecat-team/9router/pull/3)) |
| 2026-10-04 | Trang fork `.github/README.md`, STATUS, công cụ theo dõi/nâng upstream ([PR #4](https://github.com/wecat-team/9router/pull/4)); sửa browser smoke chập chờn W-014 ([PR #5](https://github.com/wecat-team/9router/pull/5)) |
| 2026-10-04 | Cả hai host chuyển sang image fork `wecat-9router:0.5.95-556b4a96b8a4`, build và deploy thủ công từ máy operator |
