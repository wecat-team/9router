# Tình trạng 9Router WeCat

Cập nhật: **2026-10-30** (cả hai production chạy 0.5.112). Đây là nơi duy nhất ghi "đang ở đâu". Cập nhật file này trong cùng PR khi nâng upstream, và sau mỗi lần rollout production. Chỉ dùng tên vai trò primary/secondary; hostname, IP và credential không vào repo.

## Upstream

- Nguồn: [`decolua/9router`](https://github.com/decolua/9router), phát hành bằng tag `vX.Y.Z` trên `master`.
- Bản đang chạy production: **0.5.112**, commit `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d` (fork `42b7ee16` trên `master`, [PR #20](https://github.com/wecat-team/9router/pull/20)); 0.5.111 giữ làm image rollback.
- Bản trước: **0.5.111** (`3a978a631ad65529c06e48ce495092d5bba29f46`, [PR #17](https://github.com/wecat-team/9router/pull/17)).
- PR #10 squash merge nên `master` không chứa tổ tiên upstream; `prepare-upstream` gặp 19 conflict (merge-base v0.5.95). Fork không sửa file nào trong số đó nên lấy nguyên bản upstream. PR nâng upstream sau nên giữ merge commit để tránh lặp lại.

### Nâng 0.5.112

- Upstream 0.5.111 → 0.5.112 (`1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`): 14 commit, 48 file, áp diff (master mất tổ tiên upstream), 0 conflict, `treeDrift` sạch. Không đổi `custom-server.js`, auth, SQLite/migration, đường sinh ảnh, executor Codex hay `src/sse`; dependency không đổi (lockfile chỉ đổi version). DB tương thích rollback 0.5.111.
- **Codex:** chỉ thêm `gpt-6.1-terra` (`responsesLite`, giá ước tính 1/5, context 500k); không gỡ model nào, mọi model app.wecat.vn đang dùng giữ nguyên. Xem [MODELS](MODELS.md).
- **Chat non-stream:** upstream trả đúng status lỗi khi SSE có frame `error` trong `nonStreamingHandler`. Codex có `forceStream` nên chat `stream:false` đi qua `handleForcedSSEToJson` (không đổi): hành vi lỗi app nhận được không đổi.
- **Dockerfile upstream:** thêm `npm install wreq-js playwright-core` không ghim version, chỉ cho OpenCode Free và provider web (lazy runtime). **Không chép** sang `wecat/Dockerfile`: WeCat không dùng các provider này, và cài không qua lockfile trái chính sách lock của fork. `lazyRuntime` không được executor Codex dùng.
- Bảo mật: route mới `/api/oauth/minimax-code{,-global}/lease-{status,connect}` nhận đường dẫn data dir rồi kết nối unix socket theo đó; `dashboardGuard` khớp tiền tố nên các route này chỉ gọi từ local và bắt buộc đăng nhập. Header/IP/xác thực API key không đổi.
- Phần còn lại không thuộc đường WeCat dùng: MiniMax Code lease, provider Nace Drex (System One), CommandCode headers, CodeBuddy headers, NVIDIA reasoning alias, DeepSeek PoW hash, Copilot Claude 5.5 thinking, schema Gemini, bulk-add key.
- Gate operator trên candidate local (diagnostic cho khảo sát) đạt: ops, contracts, mutation, critical 93/93, build amd64, container smoke. Gate phát hành chạy lại trên commit `master` `42b7ee16` sau squash merge: đạt (critical 93/93, build, container smoke), receipt khớp image. Rollout: secondary 09:07 giờ VN 29/10, primary 00:00 giờ VN 30/10 qua watcher (0 request/30 phút); cả hai đạt canary/monitor, chi tiết ở mục Production.
- Bàn giao app (`app-handoff.mjs v0.5.111`): không model nào bị gỡ, chỉ thêm `gpt-6.1-terra`; app.wecat.vn không cần đổi (`appHandoff: not-needed`). Thêm `gpt-6.1-terra` vào app là tùy chọn, cần thử thật trước.

### Nâng 0.5.111

- Upstream 0.5.109 → 0.5.111 (`3a978a631ad65529c06e48ce495092d5bba29f46`): 17 commit, 56 file, áp diff (master mất tổ tiên upstream), 0 conflict, `treeDrift` sạch. Không đổi `custom-server.js`, auth, SQLite/migration, Dockerfile hay dependency (lockfile chỉ đổi version); DB tương thích rollback 0.5.109.
- **Ảnh Codex (ảnh hưởng WeCat):** upstream gỡ `gpt-5.6-{luna,terra,sol}-image` khỏi catalog, thêm `gpt-6-sol-image`; model điều phối tool `gpt-image-*` đổi `gpt-5.6-terra` → `gpt-6-sol`. Request tới 3 model đã gỡ vẫn đi tiếp tới đúng model chính kèm đủ ảnh tham chiếu; contract đổi sang kiểm passthrough (23 check), mutation-check giữ nguyên. app.wecat.vn ghi cứng danh sách model, không đọc `/v1/models`, nên không cần đổi app trước khi nâng. Rủi ro còn lại: tài khoản không được dùng `gpt-6-sol` sẽ lỗi tool ảnh; canary `gpt-image-2` (primary) và `gpt-image-2.5-sunburst` (secondary) kiểm đúng chỗ này. Chi tiết: [MODELS](MODELS.md).
- Phần còn lại không thuộc đường WeCat dùng: Ollama TTS/embedding, provider Runcrate, Kimi K3.1 Pro, OpenCode Free (TLS/fingerprint), DeepSeek, thinking Claude Haiku/GPT-5.6 qua OpenAI Compatible, Headroom, translator ảnh trong tool message, thẻ CLI Pi. `executors/base.js` chỉ thêm tham số tùy chọn cho OpenCode.
- Thử thật `gpt-6-sol-image` trước rollout (trên 0.5.109, ảnh mẫu, quality low): cả hai host đạt với 1 và 2 ảnh tham chiếu (15–23 s); tài khoản Pro (primary), Team/Plus (secondary) dùng được `gpt-6-sol`. Chưa thử với ảnh/prompt thật của app; đổi model mặc định của app là việc riêng.
- Gate operator chạy trên commit master `605a6b0e` sau squash merge (khác lượt 0.5.109). Rollout: secondary 19:37 giờ VN 26/10, primary 00:00 giờ VN 27/10 qua watcher; cả hai đạt canary/monitor, chi tiết ở mục Production.

### Nâng 0.5.109

- Upstream 0.5.104 → 0.5.109: 39 commit, 259 file, áp diff (master mất tổ tiên upstream), `treeDrift` sạch. Không có migration SQLite; SQLite chỉ thêm strip NUL byte khi bind.
- Ảnh Codex: model điều phối nhóm `gpt-image-*` đổi `gpt-5.6-sol` → `gpt-5.6-terra` (OpenAI từ chối sol trên gói Go); bỏ qua tài khoản Free khi tạo ảnh; plan đọc từ token thật. Nhóm `gpt-5.6-*-image` worker dùng không đổi. Contract 20 check và mutation-check đạt.
- Bảo mật: Node ghim `22.23.4-alpine` (CVE-2026-111497) trong `wecat/Dockerfile`/`validation.json`; `undici` 7.30.1; Next.js 16.1.6 → 16.4.2; dependency thêm `ws`, `ajv`, `playwright-core`, `wreq-js`, bỏ `express`, `http-proxy-middleware`. Không thêm `ffmpeg` (chỉ phục vụ `cx/transcribe`).
- Conflict khi áp diff: `.gitignore` (giữ cả hai) và `tests/unit/codex-refresh-token.test.js` (upstream nay cũng dùng lead 10 phút như fork đã sửa; lấy bản upstream). Gate lần 1 fail ở critical vì marker còn sót trong test này; sửa, amend, gate lần 2 đạt (ops, contracts, mutation, 89 critical, build amd64, container smoke, receipt gắn commit/image).
- Khác với 0.5.99/0.5.104: image được gate và build trên commit nhánh `1a2a1bd4` rồi ship/rollout trước khi merge; master sau squash merge có SHA khác nhưng cùng tree. Lần sau gate trên commit master.
- Vận hành cùng ngày (không thuộc fork): primary gia hạn được cert Let's Encrypt sau khi cài lại plugin nginx của certbot (renew fail từ 16/10, cert hết hạn 15/11); secondary dọn 8 image router cũ (ổ data 69% → 56%); hai tài khoản Codex Pro trên primary hết hạn ~2 giờ chiều 23/10 gây 227 lỗi ảnh rồi tự ổn sau gia hạn.

### Nâng 0.5.104

- Upstream gỡ `gpt-5.5`, `gpt-5.5-review`, `gpt-5.5-image`, `gpt-5.3-image` khỏi catalog Codex. Request tới các model này vẫn được chuyển lên upstream (đã test offline), chỉ mất khỏi `/v1/models`/dashboard; upstream coi `gpt-5.5` là model đã ngừng. app.wecat.vn đã chuyển cấu hình sang model 5.6 trước đợt nâng; contract giữ kiểm tra passthrough cho `gpt-5.5-image`.
- Ảnh dạng tool (`gpt-image-*`) đổi model điều phối `gpt-5.5` → `gpt-5.6-sol`. Contract kiểm tool model giữ nguyên và model điều phối còn trong catalog; canary thật chạy thêm `gpt-image-2` (primary) hoặc `gpt-image-2.5-sunburst` (secondary), song song với ảnh luna để không kéo dài thời gian giữ gate. Canary dùng 3 lượt gọi thật.
- `/v1/models` liệt kê thêm provider miễn phí không cần auth (opencode, …); khả năng gọi đã có từ 0.5.99. ACL theo key vẫn không bật.
- Danh sách model Codex theo catalog 0.5.104 và đối chiếu với app: [MODELS](MODELS.md).

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

Image 0.5.112 do gate operator build (amd64) trên `master` `42b7ee16`: `wecat-9router:0.5.112-42b7ee168bb8`, ID `sha256:5bbb5c158d8a9854f5b179239bf161eb50a63f23c46f13123b8f267dec6646f4`. Đã nạp sang cả hai host qua SSH và so ID với receipt. Image 0.5.111 (`wecat-9router:0.5.111-605a6b0e2322`) giữ làm rollback trên cả hai host.

| Vai trò | Phiên bản đang chạy | Kết quả 29–30/10/2026 | Dữ liệu/cấu hình | Rollback giữ trên host |
|---|---|---|---|---|
| primary | 0.5.112 (00:00 giờ VN 30/10) | Watcher khởi động lúc 00:00:12 (30 phút trước có 0 request); shadow đạt; chat 200 (~3.2 s), `gpt-5.6-luna-image` 2 ref 200 (~21 s, passthrough), `gpt-image-2` qua `gpt-6-sol` 200 (~19 s); monitor 180 s đạt, RestartCount=0; gate tạm drain và tự gỡ, nginx trỏ thẳng router | API key 3→3, provider 6→6; settings/proxy/key giữ nguyên, SQLite ok | image 0.5.111 + compose cũ + SQLite backup API + full volume khi writer dừng |
| secondary | 0.5.112 (09:07 giờ VN 29/10) | 30 phút trước có 21 request; shadow đạt; gate `hold-if-idle`; chat 200 (~2.6 s), `gpt-5.6-luna-image` 2 ref 200 (~18 s, passthrough), `gpt-image-2.5-sunburst` qua `gpt-6-sol` 200 (~20 s); monitor 180 s đạt, RestartCount=0; HTTPS login 200, `/v1/models` không key 401 | API key 2→2, provider 6→6; settings/proxy/key giữ nguyên, SQLite ok; ACL mới vẫn không bật | image 0.5.111 + env cũ + SQLite backup API + full volume khi writer dừng, ngoài cây deploy ứng dụng |

Ledger hiện tại: [`releases/0.5.112-42b7ee16.json`](releases/0.5.112-42b7ee16.json) (cả hai production đã nâng và kiểm chứng; bàn giao app: not-needed). Lịch sử: [`releases/0.5.111-605a6b0e.json`](releases/0.5.111-605a6b0e.json), [`releases/0.5.109-1a2a1bd4.json`](releases/0.5.109-1a2a1bd4.json), [`releases/0.5.104-fd6da50f.json`](releases/0.5.104-fd6da50f.json), [`releases/0.5.99-1bb26a28.json`](releases/0.5.99-1bb26a28.json), [`releases/0.5.95-556b4a96.json`](releases/0.5.95-556b4a96.json), [`releases/0.5.95.json`](releases/0.5.95.json).

Lưu ý vận hành:

- Image chỉ có trên host, không có trong registry. Vì vậy `docker compose pull` toàn stack trên secondary sẽ lỗi ở service router. Script deploy của ứng dụng chỉ pull `api web worker backup`, nên không bị ảnh hưởng.
- Health/auth 200 không chứng minh inference tốt: lượt 11/10 secondary healthy nhưng chat 503 vì credential. Luôn đối chứng chat trên bản đang chạy trước khi kết luận regression. Chỉ một container mount volume router production; shadow đã dọn.
- Từ 0.5.99, cả hai host rollout bằng cùng script handoff của operator; RUNBOOK mục *Lệnh theo vai trò* mô tả quy trình và các mốc log.

## Còn mở

1. **`docker-compose.yml` của upstream trỏ `decolua/9router:latest`.** Không dùng file này cho production WeCat. Giữ nguyên vì là file upstream.
2. **Gate tạm của primary (W-017).** `wecat/ops/gate.mjs` đã thả hàng đợi theo nhịp, giới hạn `active` khi xả, bỏ request mất client và có timeout upstream (test offline trên Node 22/24). Chưa kiểm bằng rollout thật giờ cao điểm: vẫn ưu tiên 00:00–07:00 giờ VN; lượt sau phải chép `gate.mjs` mới vào bộ rollout.
3. **Squash merge làm mất tổ tiên upstream.** `prepare-upstream` tự áp diff khi `master` không chứa upstream đã chấp nhận, và chặn cây lệch upstream ngoài file fork ([README](README.md#theo-dõi-upstream)). Dựng lại lần 0.5.99 → 0.5.104: 0 conflict. Sẽ dùng thật ở lần nâng kế tiếp.
4. **Script rollout không có trong repo.** `operator-rollout.py` chỉ nằm trong bộ rollout trên host (chứa đường dẫn và tên container của từng host); RUNBOOK mô tả cách dùng và các mốc log.

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
| 2026-10-16 | primary → 0.5.104 lúc 23:15 giờ VN (không có traffic), canary/monitor đạt. Cả hai production chạy 0.5.104 |
| 2026-10-23 | Nâng upstream 0.5.109 ([PR #16](https://github.com/wecat-team/9router/pull/16)). secondary → 0.5.109 lúc 22:10 giờ VN đạt canary/monitor; primary → 0.5.109 lúc 23:04 giờ VN (watcher chờ traffic <50/30 phút) đạt canary/monitor. Cả hai production chạy 0.5.109 |
| 2026-10-26 | Nâng upstream 0.5.111 ([PR #17](https://github.com/wecat-team/9router/pull/17)): upstream gỡ `gpt-5.6-*-image` khỏi catalog (vẫn passthrough), tool ảnh chuyển sang `gpt-6-sol`. secondary → 0.5.111 lúc 19:37 giờ VN đạt canary/monitor |
| 2026-10-27 | primary → 0.5.111 lúc 00:00 giờ VN (watcher, 2 request/30 phút) đạt canary/monitor. Cả hai production chạy 0.5.111 |
| 2026-10-29 | Nâng upstream 0.5.112 ([PR #20](https://github.com/wecat-team/9router/pull/20)): Codex chỉ thêm `gpt-6.1-terra`. secondary → 0.5.112 lúc 09:07 giờ VN đạt canary/monitor |
| 2026-10-30 | primary → 0.5.112 lúc 00:00 giờ VN (watcher, 0 request/30 phút) đạt canary/monitor. Cả hai production chạy 0.5.112; bàn giao app not-needed |
