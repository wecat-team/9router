# WeCat 9Router fork

Đọc `wecat/README.md`, `wecat/INCIDENTS.md` và phần liên quan của `CLAUDE.md` trước khi sửa. Nếu sửa engine, đọc `open-sse/AGENTS.md`.

- Giữ remote `upstream` là decolua/9router; `origin` là wecat-team/9router. Nâng upstream trên nhánh candidate qua PR, không force-push master.
- Mã/comment mới của WeCat viết tiếng Việt; giữ MIT LICENSE và phần upstream. Logic vận hành riêng đặt dưới wecat/.
- Không commit `.env`, SSH key, OAuth token, API key/cookie, hostname/IP production, ảnh hoặc prompt khách hàng. Public docs chỉ dùng primary/secondary.
- Không deploy/pull latest theo push/PR. Bản candidate phải có full SHA, image digest, receipt đúng commit và các gate đạt. Production cần operator approval riêng, canary và rollback.
- Test local dùng dataset/container riêng, không dùng volume hoặc credential production. Canary thật cần cờ --allow-live và được phép sử dụng quota.
- Gate chuẩn: `node wecat/check.mjs` và `node wecat/verify-receipt.mjs`. Diagnostic không là release evidence. Lỗi critical mới không được che bằng known-fails.
- Trước commit, kiểm remotes. Nếu có remote wecat-team, thêm đúng trailer `Co-Authored-By: Codex <noreply@openai.com>` cách body một dòng trống. Giữ Git author/committer của người dùng.
