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

```sh
git switch master
git pull --ff-only origin master
node wecat/prepare-upstream.mjs master
```

Lệnh tạo nhánh candidate và merge chưa commit, không tự push hoặc deploy. Review diff/API/model/SQLite/proxy; xử lý conflict; cập nhật SHA/version/manifest hash trong `wecat/validation.json`, tạo lại và review các lockfile nếu manifest đổi. Commit với attribution, chạy gate rồi mở PR.

Không tự đưa các lỗi test mới vào `known-fails`. Suite đầy đủ của upstream có lỗi đã biết và một số test mạng; CI fork chỉ dùng tập critical được liệt kê minh bạch. Lỗi critical là blocker. Thêm/bỏ suite cần PR giải thích vì sao và bằng chứng đối chứng.

## Phát hành và production

- PR/push chạy **WeCat validation**, không gọi SSH hoặc deploy VPS.
- Workflow **WeCat publish verified candidate** chạy tay, chỉ nhận full SHA thuộc master. Nó chạy lại gate, kiểm receipt/image/lock, cần approval tại environment `wecat-release`, rồi publish `ghcr.io/wecat-team/9router:sha-<commit>`; không cập nhật `latest` hoặc deploy.
- Promotion production được làm riêng, theo [runbook](RUNBOOK.md), có reviewer ở `production-primary` / `production-secondary` và hai canary thật. Repo chưa chứa SSH key của production.
- Các workflow phát hành của upstream được chặn cho fork để tránh dùng nhầm namespace hoặc quy trình.

Xem [sự cố đã gặp](INCIDENTS.md), [release đã kiểm chứng](releases/0.5.95.json) và [checklist PR](../.github/pull_request_template.md). Report của một commit cũ không phải bằng chứng cho commit/image mới.
