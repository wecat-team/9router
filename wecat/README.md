# 9Router của WeCat

Fork này giữ lịch sử từ `decolua/9router`, bổ sung một quy trình kiểm chứng riêng trước khi thay image trên hai production VPS. Build xanh không bảo đảm không còn lỗi; gate chỉ xác nhận các hành vi được kiểm tra. Kết quả local không thay thế canary dùng tài khoản thật.

## Bắt đầu local

Node 22 và Docker Compose/Engine đang chạy. Thực hiện từ root repo, trên một checkout đã commit:

```sh
cp wecat/locks/application.package-lock.json package-lock.json
cp wecat/locks/tests.package-lock.json tests/package-lock.json
npm ci --no-audit --no-fund
npm --prefix tests ci --no-audit --no-fund
npm --prefix wecat ci --ignore-scripts --no-audit --no-fund
(cd wecat && ./node_modules/.bin/playwright install chromium)
node wecat/check.mjs
node wecat/verify-receipt.mjs
```

Nếu máy đã có Chrome, có thể đặt `WECAT_CHROME_EXECUTABLE` thành đường dẫn binary Chrome thay cho tải Chromium. Dùng `--diagnostic` khi đang sửa code: report sẽ mang trạng thái `diagnostic`, **không** được dùng để phát hành. `--no-build` chỉ dùng lại image có label revision đúng commit đang checkout.

Gate thực hiện:

1. Ops tests: proxy IP, lỗi patch, giữ/drain request, request bị hủy, PNG lỗi, bảo vệ receipt và canary thật.
2. Ảnh: các model WeCat dùng, zero/one/multiple input images, thứ tự source/reference, size/quality/detail, SSE collection và binary endpoint.
3. Mutation: chủ động bỏ ảnh tham chiếu; test phải đỏ, rồi hoàn trả source.
4. Tám suite upstream quan trọng, chạy từ `tests/`, không chạy các suite gọi provider thật.
5. Docker build với Node image và dependency lock cố định.
6. Container riêng trên loopback, dữ liệu rỗng: health, browser login, trang Providers, API key, 401 khi thiếu key và 400 cho model giả lập.

Container, network, volume và password của smoke đều tạm thời; không mount dữ liệu local đang dùng và không gọi production/provider thật. Gate ghi log đã che credential, screenshot và receipt vào `wecat/.reports/` (gitignored và không vào Docker image).

## Theo dõi upstream

Remote theo quy ước: `origin` là `wecat-team/9router`, `upstream` là `decolua/9router`. Nếu clone mới chưa có `upstream`, script tự thêm.

```sh
node wecat/upstream-status.mjs            # chỉ đọc: tag mới nhất, số commit, vùng cần review
git switch master && git pull --ff-only origin master
node wecat/prepare-upstream.mjs --pr      # mặc định lấy tag upstream mới nhất; có thể truyền vX.Y.Z hoặc master
```

`prepare-upstream` làm các bước sau:

1. Tạo nhánh `wecat/upstream-<version>-<sha12>` từ `origin/master` và merge upstream.
2. Nếu `package.json` hoặc `tests/package.json` đổi, tạo lại lockfile tương ứng trong `wecat/locks/`. Dependency không đổi giữ nguyên version.
3. Cập nhật commit, version và hash manifest trong `wecat/validation.json`.
4. Commit kèm báo cáo, push và mở PR với mục **Cần review**: patch IP, SQLite, dependency, Dockerfile, đường sinh ảnh, token refresh, workflow.

Nếu merge có conflict, script dừng và giữ nguyên trạng thái để xử lý tay. Script không bao giờ push `master` hay deploy. Thêm `--no-commit` để review trước khi commit, hoặc bỏ `--pr` để chỉ commit local. Nếu có mục `dockerfile`, chép thay đổi cần thiết của `Dockerfile` upstream sang `wecat/Dockerfile`. Báo cáo cũng được lưu ở `wecat/.reports/upstream-<version>.md`.

Không có job theo dõi tự động: thỉnh thoảng chạy `node wecat/upstream-status.mjs` (chỉ đọc). Workflow *WeCat upstream watch* vẫn còn file nhưng đã tắt. Sau khi merge, cập nhật [STATUS](STATUS.md).

Không tự đưa các lỗi test mới vào `known-fails`. Suite đầy đủ của upstream có lỗi đã biết và một số test mạng; Gate của fork chỉ dùng tập critical được liệt kê minh bạch. Lỗi critical là blocker. Thêm/bỏ suite cần PR giải thích vì sao và bằng chứng đối chứng.

## Phát hành và production

- **Không dùng GitHub Actions (CI/CD).** Các workflow `wecat-*` đã tắt và `master` không yêu cầu status check; gate (`node wecat/check.mjs`) chạy trên máy operator, tóm tắt kết quả trong PR. Bật lại được bằng `gh workflow enable` nếu cần.
- **Deploy production thủ công từ máy operator**, không qua GitHub Actions. Sau khi PR merge: chạy gate local với image amd64, `node wecat/ship-image.mjs <host>...` nạp image qua SSH (so image ID với receipt), rồi rollout primary trước, secondary sau, theo [runbook](RUNBOOK.md). Repo không chứa SSH key hay hostname production.
- Các workflow phát hành của upstream được chặn cho fork để tránh dùng nhầm namespace hoặc quy trình.

Xem [tình trạng hiện tại](STATUS.md), [sự cố đã gặp](INCIDENTS.md), [release đã kiểm chứng](releases/) và [checklist PR](../.github/pull_request_template.md). Report của một commit cũ không phải bằng chứng cho commit/image mới.
