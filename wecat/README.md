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

**PR nâng upstream được squash merge** (bảo vệ `master` bắt lịch sử tuyến tính), nên `master` không chứa commit upstream làm tổ tiên. Merge-base khi nâng lần sau vẫn là bản cuối từng merge thật (`v0.5.95`), vì vậy `prepare-upstream` sẽ gặp conflict ở các file upstream đã sửa lại sau đó. Lần 0.5.104 có 19 file. Cách xử lý lặp lại được:

1. Fork chỉ sở hữu `wecat/`, `.github/` và các file sau ngoài hai thư mục đó: `.dockerignore`, `.gitignore`, `AGENTS.md`, khối WeCat đầu `CLAUDE.md`, `tests/unit/codex-refresh-token.test.js` (cửa sổ refresh Codex 10 phút).
2. Conflict ở file không thuộc danh sách trên thì lấy nguyên bản upstream: `git checkout --theirs -- <file>`. Conflict ở file thuộc fork thì sửa tay.
3. Bước bắt buộc: `git diff --stat <upstream-commit> -- . ':!wecat' ':!.github'` chỉ được liệt kê các file của fork ở mục 1. Có file khác là auto-merge đã trộn sai: lấy lại bản upstream của file đó (`git checkout <upstream-commit> -- <file>`).
4. Chạy tiếp phần còn lại của script bằng tay: tạo lại lock nếu manifest đổi, cập nhật `wecat/validation.json`, ghi báo cáo. Ghi số conflict và cách xử lý vào PR.

Nếu đổi danh sách file của fork ở mục 1, cập nhật đoạn này trong cùng PR.

Nếu merge có conflict, script dừng và giữ nguyên trạng thái để xử lý tay. Script không bao giờ push `master` hay deploy. Thêm `--no-commit` để review trước khi commit, hoặc bỏ `--pr` để chỉ commit local. Nếu có mục `dockerfile`, chép thay đổi cần thiết của `Dockerfile` upstream sang `wecat/Dockerfile`. Báo cáo cũng được lưu ở `wecat/.reports/upstream-<version>.md`.

Không có job theo dõi tự động: thỉnh thoảng chạy `node wecat/upstream-status.mjs` (chỉ đọc). Workflow *WeCat upstream watch* vẫn còn file nhưng đã tắt. Sau khi merge, cập nhật [STATUS](STATUS.md).

Không tự đưa các lỗi test mới vào `known-fails`. Suite đầy đủ của upstream có lỗi đã biết và một số test mạng; Gate của fork chỉ dùng tập critical được liệt kê minh bạch. Lỗi critical là blocker. Thêm/bỏ suite cần PR giải thích vì sao và bằng chứng đối chứng.

## Phát hành và production

- **Không CI/CD deploy.** Workflow *WeCat validation* đang active và là check bắt buộc của PR vào `master` (kèm lịch sử tuyến tính); các workflow publish/watch vẫn tắt. Commit chỉ sửa tài liệu có thể dùng `[skip ci]`, nhưng trước khi merge cần một commit không có `[skip ci]` để check chạy. Gate image (`node wecat/check.mjs`) chạy trên máy operator, receipt đúng SHA/image. Không bật thêm workflow hoặc đổi bảo vệ nếu chưa được cho phép.
- **Deploy production thủ công từ máy operator**, không qua GitHub Actions. Sau khi PR merge: chạy gate local với image amd64, `node wecat/ship-image.mjs <host>...` nạp image qua SSH (so image ID với receipt), rồi rollout primary trước, secondary sau, theo [runbook](RUNBOOK.md). Repo không chứa SSH key hay hostname production.
- Các workflow phát hành của upstream được chặn cho fork để tránh dùng nhầm namespace hoặc quy trình.

Xem [tình trạng hiện tại](STATUS.md), [sự cố đã gặp](INCIDENTS.md), [release đã kiểm chứng](releases/) và [checklist PR](../.github/pull_request_template.md). Report của một commit cũ không phải bằng chứng cho commit/image mới.
