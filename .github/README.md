# 9Router — bản của WeCat

Fork của [decolua/9router](https://github.com/decolua/9router): AI gateway một endpoint OpenAI-compatible (`/v1/*`) định tuyến tới nhiều provider. WeCat dùng nó làm gateway cho hai môi trường production (**primary** và **secondary**).

Fork này **không phát triển tính năng riêng**. Mục đích là theo sát upstream và kiểm chứng từng bản trước khi thay image production. Code ứng dụng (`src/`, `open-sse/`, `cli/`) giữ nguyên upstream. Phần riêng của WeCat nằm trong [`wecat/`](../wecat/README.md) và các workflow `wecat-*`.

## Tình trạng

> Cập nhật 2026-10-04. Chi tiết và việc còn mở: [wecat/STATUS.md](../wecat/STATUS.md).

| | |
|---|---|
| Upstream | `decolua/9router`, đã đồng bộ tới **v0.5.95** ([`a99cf572`](https://github.com/decolua/9router/commit/a99cf57239ff778b61e434c2786009d5ed1c412c)). Chưa có bản mới hơn. |
| Fork | Upstream cộng với `wecat/` (gate kiểm chứng, runbook, nhật ký sự cố). `master` chỉ nhận PR có **WeCat release gate** xanh. |
| Production | primary và secondary đều chạy **0.5.95** từ **cùng một image do fork build** (`wecat-9router:0.5.95-556b4a96b8a4`), triển khai ngày 2026-10-04. |
| Phát hành | Gate chạy trên mọi PR. Deploy **thủ công từ máy operator** qua SSH, không qua GitHub Actions hay registry. |

## Khác gì upstream

- `wecat/`: gate offline (contract ảnh, mutation, 8 suite critical, Docker build với lockfile ghim, smoke API + browser), receipt gắn commit/image, runbook hai production, [nhật ký sự cố](../wecat/INCIDENTS.md), [ledger release](../wecat/releases/).
- `wecat/Dockerfile`: giống Dockerfile upstream nhưng dùng Node image và lockfile ghim, kèm patch IP client (`WECAT_TRUSTED_PROXY_IPS`, chỉ nhận danh sách IP chính xác).
- Workflow phát hành của upstream (Docker Hub, tray, GitBook) bị chặn trên fork. Image production do operator build bằng gate rồi nạp qua SSH. Workflow publish ghcr chạy tay chỉ là tùy chọn; không có `latest` và không có deploy tự động.
- Root `README.md` là bản gốc của upstream, giữ nguyên để merge không conflict. Trang này (`.github/README.md`) là trang GitHub hiển thị cho fork.

## Nâng lên bản upstream mới

```sh
node wecat/upstream-status.mjs           # upstream có gì mới, chạm vùng nào WeCat phụ thuộc
node wecat/prepare-upstream.mjs --pr     # nhánh candidate + merge + lockfile + validation.json + PR
```

1. Workflow **WeCat upstream watch** kiểm hằng ngày và mở (hoặc cập nhật) một issue khi upstream có tag mới.
2. `prepare-upstream` tạo nhánh `wecat/upstream-<version>-<sha>`, merge, tạo lại lockfile nếu manifest đổi, cập nhật `wecat/validation.json`, rồi mở PR kèm danh sách cần review (patch IP, SQLite, dependency, Dockerfile, đường sinh ảnh, token refresh, workflow). Nếu có conflict, script dừng và giữ nguyên để xử lý tay.
3. CI chạy **WeCat release gate** trên PR. Review rồi merge.
4. Trên máy operator, ở checkout sạch của `master`: `DOCKER_DEFAULT_PLATFORM=linux/amd64 node wecat/check.mjs`, rồi `node wecat/ship-image.mjs <ssh-primary> <ssh-secondary>`. Lệnh này nạp image qua SSH và so image ID với receipt.
5. Rollout primary rồi mới tới secondary theo [RUNBOOK](../wecat/RUNBOOK.md), có backup, canary và rollback. Cập nhật [STATUS](../wecat/STATUS.md) và thêm ledger trong `wecat/releases/`.

## Chạy local

```sh
cp .env.example .env                      # đặt INITIAL_PASSWORD, JWT_SECRET, API_KEY_SECRET
docker build -f wecat/Dockerfile -t 9router:local .
docker run -d --name 9router -p 20128:20128 --env-file .env \
  -e DATA_DIR=/app/data -v "$PWD/data:/app/data" 9router:local
```

Dashboard ở <http://localhost:20128/dashboard>, API ở `/v1`. Mỗi instance cần một thư mục dữ liệu riêng: hai instance dùng chung tài khoản OAuth sẽ refresh token chồng nhau ([W-013](../wecat/INCIDENTS.md)). Gate đầy đủ trước khi phát hành: [wecat/README.md](../wecat/README.md).

## Tài liệu

- WeCat: [quy trình và gate](../wecat/README.md), [tình trạng](../wecat/STATUS.md), [runbook](../wecat/RUNBOOK.md), [sự cố](../wecat/INCIDENTS.md).
- Sản phẩm (upstream): [README gốc](../README.md), [kiến trúc](../docs/ARCHITECTURE.md), [CHANGELOG](../CHANGELOG.md).
- Agent: [AGENTS.md](../AGENTS.md) (quy tắc fork), [CLAUDE.md](../CLAUDE.md).

Giấy phép MIT, giữ nguyên từ upstream. Toàn bộ tính năng thuộc về tác giả [decolua/9router](https://github.com/decolua/9router).
