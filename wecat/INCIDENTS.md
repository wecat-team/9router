# Sự cố và kiểm tra chống tái diễn

Các ghi nhận dưới đây đến từ đợt nâng 0.5.91 → 0.5.95 ngày 01/10/2026. Đã lược bỏ host/credential/dữ liệu khách hàng. Không coi mọi lỗi dưới đây là bug application.

| ID | Hiện tượng / nguyên nhân | Xử lý | Check hiện tại |
|---|---|---|---|
| W-001 | Canary ảnh dùng mẫu PNG 1px lỗi, bị trả 400; có thể bị hiểu nhầm là regression | Chạy đối chứng release cũ, thay fixture PNG hợp lệ 128×128 | CRC/IDAT validator + test fixture cũ bị từ chối |
| W-002 | Chờ idle tự nhiên không đạt khi nhiều job liên tục; timeout 180s không đủ | Gate giữ intake mới rồi drain các request cũ | Ops test: hold lúc active, request cũ hoàn tất, request mới chỉ chạy sau resume |
| W-003 | `exec 9>lock` bị từ chối trên lock của user khác trong sticky directory với fs.protected_regular | Mở lock có sẵn mà không O_CREAT, không unlink lock của rollout khác | Runbook/operator review; cần kiểm trên host thật, không giả vờ CI đã tái hiện kernel policy |
| W-004 | Smoke cũ đòi đúng một image usage row/token metadata, trong khi đã chuyển sang official upstream | Kiểm contract thực: HTTP, PNG/reference, preservation; kiểm ledger riêng nếu sản phẩm cần | Critical image tests + container API smoke |
| W-005 | Image chỉ có trên máy, tag đã ghi vào prod nhưng registry chưa có | Publish artifact đã kiểm bằng immutable SHA tag, verify digest | Receipt identity + manual publish workflow |
| W-006 | Test upstream ghim Codex header 0.154.0 nhưng runtime đã 0.159.0; kỳ vọng refresh sớm 5 ngày trong khi fix mới dùng 10 phút | Sửa kỳ vọng test theo identity nguồn chuẩn và hành vi refresh mới | 8 critical suites; floor version và contract checks |
| W-007 | Test dùng path tương đối `../open-sse`, chạy sai cwd làm lỗi collection | Runner chạy vitest từ tests/ | Critical runner; lỗi collection chặn gate |
| W-008 | Browser login render phía client; chỉ tìm chữ password trong HTML ban đầu gây false failure | Test browser thật và backend auth độc lập | Playwright login → Providers, JS error count=0 |
| W-009 | Receipt của bản cũ hoặc dirty checkout được dùng cho image mới | Diagnostic không được publish; bind full commit, image ID và lock hash | Negative receipt tests + verify-receipt |
| W-010 | Xóa/kill proxy tạm khi còn request có thể cắt các lượt sinh ảnh | Drain proxy; cleanup không là lý do rollback service đã đạt | Gate tests + rollback checklist |
| W-012 | GitHub artifact uploader bỏ qua .reports vì là thư mục ẩn, CI vẫn xanh nhưng không có evidence | include-hidden-files=true trong đúng thư mục đã lọc; if-no-files-found=error; kiểm download artifact thực tế | Workflow upload fail-closed và xác minh artifact sau CI |
| W-011 | Request đã hủy trong hàng đợi bị gửi tiếp sau resume, gây gọi/billing trùng | Loại queued entry khi client đóng | Abort-before-resume test, upstream call count=0 |

## Khi phát hiện lỗi mới

Mở issue theo template **WeCat build / regression**, kèm SHA/image digest, stage, lệnh tái hiện và CI artifact đã lọc. Tái hiện trước khi sửa; thêm regression test và mutation/đối chứng nếu phù hợp. Ghi `open`, `fixed`, `validated` khác nhau; chưa có chứng cứ thì không ghi “đã hết lỗi”. Không sửa allowlist known-fails để làm CI xanh.

## Giới hạn

Gate không chứng minh entitlement/quota của provider thật, độ ổn định mạng ngoài, hoặc mọi nhánh toàn suite upstream. Production vẫn cần canary với tài khoản thật, snapshot/rollback và theo dõi sau handoff. Công cụ này giảm các lỗi đã kiểm chứng, không bảo đảm hệ thống không bao giờ lỗi.
