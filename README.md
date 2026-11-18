# Sổ Cân Tôm — bản 1.0.0 (Sổ đơn giản)

Web app cài lên iPhone / iPad (Safari → Chia sẻ → Thêm vào MH chính). Chạy không cần mạng, dữ liệu nằm trong máy.

## Chức năng bản này
- **Bảng cân bán**: ghi từng rổ, khối 10 rổ/cột (vạch ở rổ thứ 5), tổng từng cột + cộng dồn; trừ bì mỗi rổ, trừ nước/đá theo %; cỡ tôm, đơn giá (để trống = chưa chốt giá), tiền cọc, các lần trả → còn lại.
- **Bảng sang tôm**: từ ao → sang ao, chỉ tính số rổ và số ký.
- **Nhập nhanh** (218 → 21,8 tự ghi; 21 + Ghi → 2,1) và **Nhập trực tiếp** (gõ 21,8 rồi Ghi); 0,1 kg hoặc 0,01 kg; rổ dưới 10 / 100 / 1.000 kg.
- Soát số lạ: gõ 77 khi rổ thường ~5,5 → hỏi "Ghi 7,7 kg?"; rổ quá nhẹ → gợi ý "rổ cuối lưới? Sửa thành…".
- Hoàn tác rổ, sửa rổ, gạch rổ (có hoàn tác), kết sổ / mở lại. Mọi sửa đổi được ghi vào lịch sử, phiếu có ghi số lần sửa.
- Phiếu cân: gửi chữ (Zalo), gửi ảnh, in / lưu PDF; mã VietQR đúng số tiền còn lại (tạo offline).
- Danh sách ao, danh bạ thương lái, đọc số ký ra loa, giữ màn hình sáng, chữ to.
- Sao lưu ra file .json và khôi phục (gộp, giữ bản mới hơn).
- iPad / màn hình ngang: bảng bên trái, bàn phím bên phải. Có thể gõ bằng bàn phím rời.

## Cấu trúc thư mục (tất cả nằm một cấp để tải lên GitHub dễ)
```
index.html            giao diện + CSS
app.js                màn hình, thao tác, lưu trữ (IndexedDB)
calc.js               lõi tính toán (ký, tiền, phiếu, VietQR) — không dính giao diện
qrcode.js             thư viện vẽ mã QR (MIT, Kazuhiko Arase)
sw.js                 service worker — lưu sẵn để chạy offline
manifest.webmanifest  thông tin cài đặt app
icon-180/192/512.png  biểu tượng app
tests/calc.test.js    bài kiểm tra tự động phép tính (chạy: node tests/calc.test.js)
```

## Quy tắc khi sửa
1. Mọi phép tính sửa trong `calc.js`, thêm bài test vào `tests/calc.test.js`, chạy test phải đạt hết.
2. Khối lượng lưu dạng số nguyên 0,01 kg (centi-kg) để cộng hàng trăm rổ không sai số.
3. Mỗi lần phát hành bản mới: tăng `APP_VERSION` trong `app.js` **và** `CACHE` trong `sw.js` để iPhone tải bản mới.
4. Không xóa dữ liệu cũ khi đổi cấu trúc: thêm trường mới phải có giá trị mặc định khi đọc.

## Để dành cho sau (chưa làm)
Sổ đầy đủ (vụ nuôi, FCR, thống kê), sổ nợ tổng theo thương lái, chuyển bảng bằng QR, hai máy cùng cân, in nhiệt Bluetooth, nhiều ngôn ngữ, gói Pro.

## Địa chỉ app
https://tec123123123-web.github.io/so-can-tom/  (kho mã: https://github.com/tec123123123-web/so-can-tom)
