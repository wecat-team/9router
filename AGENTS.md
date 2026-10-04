# WeCat 9Router fork

Đọc `wecat/STATUS.md`, `wecat/README.md`, `wecat/INCIDENTS.md` và phần liên quan của `CLAUDE.md` trước khi sửa. Nếu sửa engine, đọc `open-sse/AGENTS.md`.

- Giữ remote `upstream` là decolua/9router; `origin` là wecat-team/9router. Nâng upstream bằng `node wecat/prepare-upstream.mjs --pr` (nhánh candidate + PR), không force-push master. Cập nhật `wecat/STATUS.md` trong cùng PR.
- Không sửa root `README.md`/`CLAUDE.md` ngoài khối WeCat ở đầu `CLAUDE.md`. Đó là file upstream; trang của fork là `.github/README.md`. Code ứng dụng giữ nguyên upstream, trừ khi PR ghi rõ lý do.
- Mã/comment mới của WeCat viết tiếng Việt; giữ MIT LICENSE và phần upstream. Logic vận hành riêng đặt dưới wecat/.
- Không commit `.env`, SSH key, OAuth token, API key/cookie, hostname/IP production, ảnh hoặc prompt khách hàng. Public docs chỉ dùng primary/secondary.
- Không deploy/pull latest theo push/PR. Bản candidate phải có full SHA, image digest, receipt đúng commit và các gate đạt. Production cần operator approval riêng, canary và rollback.
- Test local dùng dataset/container riêng, không dùng volume hoặc credential production. Canary thật cần cờ --allow-live và được phép sử dụng quota.
- Gate chuẩn: `node wecat/check.mjs` và `node wecat/verify-receipt.mjs`. Diagnostic không là release evidence. Lỗi critical mới không được che bằng known-fails.
- Trước commit, kiểm remotes. Nếu có remote wecat-team, thêm trailer `Co-Authored-By` của đúng agent đã làm, cách body một dòng trống: Codex dùng `Co-Authored-By: Codex <noreply@openai.com>`, Claude dùng trailer Claude Code cấp. Giữ Git author/committer của người dùng.
