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

| Vai trò | Phiên bản | Image đang chạy | Cách rollout hiện tại |
|---|---|---|---|
| primary | 0.5.95 (2026-10-01) | Build tại host từ source upstream, cộng patch IP cũ (tin một IP gateway Docker cố định) | Thủ công trên host: backup volume, gắn tag image rollback, build, `compose up` |
| secondary | 0.5.95 (2026-10-02) | Image do repo ứng dụng build, pin theo digest | Script rollout của repo ứng dụng: backup, shadow clone, gate giữ request, đổi container, theo dõi 3 phút, tự khôi phục khi lỗi |

Ledger rollout 0.5.95: [`releases/0.5.95.json`](releases/0.5.95.json). Bản đó được rollout **trước** khi có gate của fork, nên không có receipt của fork.

## Khoảng cách với quy trình mục tiêu

Quy trình mục tiêu ([README](README.md), [RUNBOOK](RUNBOOK.md)): một image do fork publish, `ghcr.io/wecat-team/9router:sha-<commit>`, đã qua gate và pin theo digest, dùng cho **cả hai** host. Hiện còn thiếu:

1. **Chưa publish image fork nào.** Workflow *WeCat publish verified candidate* chưa chạy lần nào, nên hai host vẫn build theo hai đường khác nhau. Receipt của fork chưa phủ image đang chạy.
2. **Patch IP khác nhau.** Primary dùng patch cũ. Image fork dùng `WECAT_TRUSTED_PROXY_IPS`, nên khi chuyển phải đặt biến này đúng IP proxy của host.
3. **Script rollout của secondary chỉ nhận tên image của repo ứng dụng.** Cần cho nó nhận `ghcr.io/wecat-team/9router@sha256:…`.
4. **Quyền pull ghcr.** Trước lần publish đầu, cần quyết định package public hay cấp token pull read-only cho hai host.
5. **`docker-compose.yml` của upstream trỏ `decolua/9router:latest`.** Không dùng file này cho production WeCat. Giữ nguyên vì là file upstream.
6. **Homepage của repo GitHub vẫn là 9router.com.** Nên đổi sang trang của fork.

Khi xong mục 1–4, mỗi lần nâng upstream chỉ còn: merge PR → publish → rollout primary → rollout secondary, cùng một image digest.

## Lịch sử

| Ngày | Sự kiện |
|---|---|
| 2026-09-23 | primary 0.5.81 → 0.5.86 (build từ source, giữ patch IP) |
| 2026-09-24 | secondary 0.5.81 → 0.5.86 (image official, qua script rollout) |
| 2026-10-01 | Cả hai → 0.5.95. Sự cố gặp phải ghi ở [INCIDENTS](INCIDENTS.md) W-001…W-012 |
| 2026-10-01 | Bootstrap fork: gate, receipt, runbook ([PR #1](https://github.com/wecat-team/9router/pull/1), [PR #3](https://github.com/wecat-team/9router/pull/3)) |
| 2026-10-04 | Trang fork `.github/README.md`, STATUS, công cụ theo dõi/nâng upstream |
