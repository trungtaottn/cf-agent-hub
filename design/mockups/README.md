# CF Agent Factory · Blueprint UI/UX mockups

> Issue: [#124](https://github.com/trungtaottn/cf-agent-hub/issues/124) · Label: **UI-UX** · Status: design proposal (Specified), synthetic data only.

**Xem trực tiếp (live preview):** [raw.githack](https://raw.githack.com/trungtaottn/cf-agent-hub/design/ui-ux-mockups/design/mockups/index.html) · hoặc clone repo rồi mở `design/mockups/index.html` bằng trình duyệt.

Ảnh chụp màn hình nằm trong [screenshots/](screenshots/).

---
Bản thiết kế lại giao diện của [cf-agent-hub](https://github.com/trungtaottn/cf-agent-hub) theo ẩn dụ **nhà máy AI**. Mỗi trang là một "sheet" bản vẽ kỹ thuật (blueprint). Chỉ là mockup HTML, không phải ứng dụng thật. Mọi số liệu là dữ liệu mô phỏng (gắn nhãn `SIM DATA`).

## 1. Design brief (ak:frontend-design)

```text
Register:  Product (có các màn hình immersive cho sàn nhà máy và kịch bản)
Scene:     Quản đốc và reviewer theo dõi nhà máy agent trên màn hình desktop hoặc wall display phòng tối,
           cần biết ngay ai đang giữ việc, việc gì chờ người quyết, cái gì bị kẹt.
Direction: Blueprint kỹ thuật (cyanotype) vì sản phẩm là "bản vẽ" của một quy trình có ràng buộc chặt
           (lease, fence, version). Bản vẽ kỹ thuật là ngôn ngữ của sự chính xác và có thể kiểm chứng.
Color:     Drenched blueprint. bg #0a2342, ink #e8f3ff, line #6f9fd0.
           Redline amber #ffc35c chỉ dùng cho việc cần CON NGƯỜI. Coral #ff7d6e cho lỗi/stale.
Type:      IBM Plex Sans Condensed (tiêu đề, nhãn phòng) + IBM Plex Sans (body) + IBM Plex Mono (ID, số, annotation).
           Plex hỗ trợ tiếng Việt đầy đủ dấu.
Signature: Mặt bằng nhà máy động: agent hình lục giác đi dọc hành lang, task là thùng hàng chạy trên băng chuyền
           Backlog → Done, mỗi trang có khung tên (title block) như bản vẽ kỹ thuật thật.
Dials:     variance 4, motion 6 (có nút dừng), density 6
```

ak:ui-ux-pro-max gợi ý: style Dark/ops, chart streaming cần **nút pause** và KPI dạng text, flow/Sankey cần **bảng thay thế**, không dùng emoji làm icon, tôn trọng `prefers-reduced-motion`, kiểm tra 375/768/1440.

## 2. Ánh xạ khái niệm sản phẩm → nhà máy

| cf-agent-hub | Nhà máy |
|---|---|
| Workspace | Nhà máy (Aurora) |
| Project + work role (do profile cấu hình) | Phòng ban |
| Task | Phiếu công việc / thùng hàng trên băng chuyền |
| Backlog / Ready / Doing / Waiting / Review / Done | Các trạm dọc dây chuyền |
| Claim + lease + fence | Agent "nhận việc" ở trạm Ready, đeo thẻ lease có hạn, số fence tăng dần |
| Human decision (proposal version) | Cổng phê duyệt (màu amber) |
| Independent review | Trạm kiểm định QC |
| Message / thread / ACK | Phòng thư, Phòng họp |
| Artifact (staged/uploaded/committed) | Kho artifact |
| Runtime enrollment, credential | Cổng an ninh |
| Outbox, recovery, readiness | Phòng bảo trì |
| HTTP / CLI / MCP / A2A / connectors | Bến kết nối |
| Profile + preferences | Cấu hình nhà máy |
| Presence stale / idle / cooldown | Khu giải trí (chỉ là trình bày, không đổi quyền) |

**Nguyên tắc trung thực từ tài liệu gốc:** presence ≠ quyền sở hữu task; webhook thành công ≠ hoàn tất; approval ≠ đã thực thi; số chưa biết hiển thị "Not reported", không bao giờ là 0; trạng thái luôn có glyph + chữ + màu.

## 3. Danh sách sheet

| Sheet | File | Nội dung |
|---|---|---|
| 00 | index.html | Mục lục bản vẽ |
| 25 | 25-office-hq.html | Tòa văn phòng 4 tầng: mặt cắt + mặt bằng nội thất, agent làm việc như người |
| 26 | 26-workstation.html | Bàn làm việc cận cảnh: 2 màn hình, terminal, lease, ghi chú dán |
| 01 | 01-factory-floor.html | Sàn nhà máy, tổng quan động |
| 02 | 02-departments.html | Danh sách phòng ban |
| 03 | 03-department-detail.html | Chi tiết Xưởng Kỹ thuật |
| 04 | 04-mission-line.html | Dây chuyền nhiệm vụ (Kanban dạng băng chuyền) |
| 05 | 05-work-order.html | Phiếu công việc (task detail) |
| 06 | 06-pick-task.html | Trạm nhận việc: claim, tranh chấp, lease, fence |
| 07 | 07-workforce.html | Đội ngũ agent |
| 08 | 08-agent-profile.html | Hồ sơ agent (sơ đồ robot, runtime, hành động) |
| 09 | 09-control-room.html | Phòng điều khiển: bảng trạng thái wall display |
| 10 | 10-activity.html | Nhật ký hoạt động (event append-only) |
| 11 | 11-flow-motion.html | Luồng vận hành: motion của task qua hệ thống |
| 12 | 12-approval-gate.html | Cổng phê duyệt |
| 13 | 13-qc-review.html | Trạm nghiệm thu |
| 14 | 14-meeting-room.html | Phòng họp (standup, planning, retro) |
| 15 | 15-lounge.html | Khu giải trí (idle, cooldown, sự kiện vui) |
| 16 | 16-scenarios.html | Kịch bản mô phỏng (ca làm, họp, giải trí, sự cố, ca đêm) |
| 17 | 17-mailroom.html | Phòng thư (messages, threads, delivery, ACK) |
| 18 | 18-warehouse.html | Kho artifact |
| 19 | 19-security-gate.html | Cổng an ninh |
| 20 | 20-maintenance.html | Phòng bảo trì |
| 21 | 21-hr-teams.html | Nhân sự và thành viên |
| 22 | 22-loading-dock.html | Bến kết nối |
| 23 | 23-settings.html | Cấu hình nhà máy |
| 24 | 24-onboarding.html | Khởi công (wizard dựng workspace) |

## 4. Cấu trúc file

```
assets/blueprint.css   token + component dùng chung
assets/data.js         dữ liệu mô phỏng thống nhất (agent, phòng ban, task)
assets/app.js          shell (rail, topbar, title block), BP.svg, motion engine, toast
NN-*.html              mỗi sheet một file
```

## 5. Đổi màu (theme)

5 theme dùng chung token, đổi ở topbar hoặc thêm `?theme=` vào URL: `blueprint` (mặc định), `paper` (giấy trắng nét xanh), `graphite`, `cad` (xanh lá CAD), `sunset`. Lựa chọn được lưu trong localStorage nên áp dụng cho mọi sheet. Tòa văn phòng có thêm công tắc "Hình người / Ký hiệu robot".

Mở `index.html` bằng trình duyệt. Nút **Dừng motion** trên topbar tạm dừng mọi chuyển động.
