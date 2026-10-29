/* CF AGENT FACTORY · synthetic mock data (shared by every sheet).
   All numbers are illustrative and labelled "SIM DATA" in the UI. */
window.FACTORY = {
  workspace: { id: "ws-aurora", name: "Nhà máy Aurora", shift: "Ca ngày", revision: "R2" },

  humans: [
    { id: "hu-qd", code: "QĐ", name: "Quản đốc", role: "Owner · Operator" },
    { id: "hu-ha", code: "HA", name: "Hà", role: "Reviewer" },
    { id: "hu-kn", code: "KN", name: "Khánh", role: "Member · Decision" }
  ],

  // Departments = projects + work roles presented by the workspace profile
  departments: [
    { id: "kt", code: "KT-01", name: "Xưởng Kỹ thuật", en: "Engineering", color: "--s-doing", agents: ["atlas", "forge", "bolt"], wip: 3, wipLimit: 4 },
    { id: "nc", code: "NC-02", name: "Phòng Nghiên cứu", en: "Research", color: "--s-ready", agents: ["vega", "kite"], wip: 2, wipLimit: 3 },
    { id: "nd", code: "ND-03", name: "Studio Nội dung", en: "Content", color: "--s-review", agents: ["muse", "pixel"], wip: 1, wipLimit: 3 },
    { id: "dl", code: "DL-04", name: "Phòng Dữ liệu", en: "Data", color: "--s-done", agents: ["nova"], wip: 1, wipLimit: 2 },
    { id: "vh", code: "VH-05", name: "Trung tâm Vận hành", en: "Operations", color: "--amber", agents: ["orbit", "echo"], wip: 1, wipLimit: 2 },
    { id: "qc", code: "QC-06", name: "Trạm Kiểm định", en: "Quality / Review", color: "--s-review", agents: ["sage", "lens"], wip: 2, wipLimit: 3 }
  ],

  // presence: online | stale | offline ; activity: doing | idle | waiting | cooldown | meeting
  agents: [
    { id: "atlas", code: "AT", name: "ATLAS-01", dept: "kt", model: "claude-opus (khai báo)", runtime: "rt-atlas-7f2", presence: "online", activity: "doing", task: "T-1042", lease: 0.72, fence: 18, caps: ["code", "test", "refactor"] },
    { id: "forge", code: "FG", name: "FORGE-02", dept: "kt", model: "gpt-5 (khai báo)", runtime: "rt-forge-a19", presence: "online", activity: "doing", task: "T-1047", lease: 0.31, fence: 4, caps: ["code", "migrate"] },
    { id: "bolt", code: "BL", name: "BOLT-10", dept: "kt", model: "gemini-pro (khai báo)", runtime: "rt-bolt-03c", presence: "online", activity: "idle", task: null, lease: 0, fence: 0, caps: ["code", "lint"] },
    { id: "vega", code: "VG", name: "VEGA-03", dept: "nc", model: "claude-sonnet (khai báo)", runtime: "rt-vega-551", presence: "online", activity: "waiting", task: "T-1039", lease: 0, fence: 7, caps: ["research", "summarize"] },
    { id: "kite", code: "KI", name: "KITE-09", dept: "nc", model: "Not reported", runtime: "rt-kite-0e8", presence: "online", activity: "doing", task: "T-1051", lease: 0.55, fence: 2, caps: ["research", "browse"] },
    { id: "muse", code: "MU", name: "MUSE-04", dept: "nd", model: "claude-sonnet (khai báo)", runtime: "rt-muse-2b0", presence: "online", activity: "meeting", task: null, lease: 0, fence: 0, caps: ["write", "translate"] },
    { id: "pixel", code: "PX", name: "PIXEL-08", dept: "nd", model: "imagen (khai báo)", runtime: "rt-pixel-9d4", presence: "stale", activity: "idle", task: null, lease: 0, fence: 0, caps: ["image", "layout"] },
    { id: "nova", code: "NV", name: "NOVA-07", dept: "dl", model: "gpt-5-mini (khai báo)", runtime: "rt-nova-c71", presence: "online", activity: "doing", task: "T-1044", lease: 0.88, fence: 11, caps: ["sql", "etl", "chart"] },
    { id: "orbit", code: "OR", name: "ORBIT-05", dept: "vh", model: "Not reported", runtime: "rt-orbit-e3e", presence: "online", activity: "cooldown", task: null, lease: 0, fence: 0, caps: ["deploy", "monitor"] },
    { id: "echo", code: "EC", name: "ECHO-11", dept: "vh", model: "claude-haiku (khai báo)", runtime: "rt-echo-1aa", presence: "offline", activity: "idle", task: null, lease: 0, fence: 0, caps: ["notify", "triage"] },
    { id: "sage", code: "SG", name: "SAGE-12", dept: "qc", model: "claude-opus (khai báo)", runtime: "rt-sage-404", presence: "online", activity: "doing", task: "T-1036", lease: 0.18, fence: 3, caps: ["review", "test"] },
    { id: "lens", code: "LN", name: "LENS-06", dept: "qc", model: "gemini-flash (khai báo)", runtime: "rt-lens-77b", presence: "online", activity: "meeting", task: null, lease: 0, fence: 0, caps: ["review", "a11y"] }
  ],

  // states: backlog ready doing waiting review done failed cancelled
  tasks: [
    { id: "T-1042", title: "Tách module xác thực thành service riêng", dept: "kt", state: "doing", agent: "atlas", fence: 18, retry: "0/2", pri: "P1" },
    { id: "T-1047", title: "Migrate bảng runs sang schema v3", dept: "kt", state: "doing", agent: "forge", fence: 4, retry: "1/2", pri: "P1" },
    { id: "T-1051", title: "Khảo sát 5 thư viện queue cho Workers", dept: "nc", state: "doing", agent: "kite", fence: 2, retry: "0/1", pri: "P2" },
    { id: "T-1044", title: "Dựng báo cáo tỉ lệ lease hết hạn theo tuần", dept: "dl", state: "doing", agent: "nova", fence: 11, retry: "0/2", pri: "P2" },
    { id: "T-1039", title: "Gửi email khảo sát tới 240 khách hàng beta", dept: "nc", state: "waiting", agent: "vega", fence: 7, retry: "0/0", pri: "P1", decision: "Gửi email ra bên ngoài · hết hạn 16:30" },
    { id: "T-1053", title: "Xoá 1.204 artifact staged quá 7 ngày", dept: "vh", state: "waiting", agent: "orbit", fence: 2, retry: "0/0", pri: "P2", decision: "Thao tác xoá không hoàn tác · hết hạn 18:00" },
    { id: "T-1036", title: "Viết test hồi quy cho luồng claim tranh chấp", dept: "kt", state: "review", agent: "bolt", reviewer: "sage", fence: 9, retry: "0/2", pri: "P1" },
    { id: "T-1040", title: "Bản dịch tài liệu HTTP API sang tiếng Việt", dept: "nd", state: "review", agent: "muse", reviewer: "hu-ha", fence: 3, retry: "0/1", pri: "P3" },
    { id: "T-1055", title: "Chuẩn hoá nhãn trạng thái trên board", dept: "nd", state: "ready", agent: null, fence: 0, retry: "0/1", pri: "P2" },
    { id: "T-1056", title: "Thêm chỉ số outbox backlog vào bảng điều khiển", dept: "dl", state: "ready", agent: null, fence: 0, retry: "0/2", pri: "P2" },
    { id: "T-1057", title: "Rà soát quyền token runtime sắp hết hạn", dept: "vh", state: "ready", agent: null, fence: 0, retry: "0/1", pri: "P1" },
    { id: "T-1058", title: "Phác thảo bộ icon trạng thái mới", dept: "nd", state: "ready", agent: null, fence: 0, retry: "0/1", pri: "P3" },
    { id: "T-1060", title: "Đề xuất chính sách retry cho webhook", dept: "nc", state: "backlog", agent: null, fence: 0, retry: "0/2", pri: "P3" },
    { id: "T-1061", title: "Tối ưu truy vấn danh sách sự kiện", dept: "dl", state: "backlog", agent: null, fence: 0, retry: "0/2", pri: "P3" },
    { id: "T-1033", title: "Sửa lỗi heartbeat gia hạn run đã hết hạn", dept: "kt", state: "backlog", agent: null, fence: 6, retry: "2/2", pri: "P1", flag: "Hết lượt retry" },
    { id: "T-1029", title: "Tạo bộ fixture cho kịch bản human-decision", dept: "qc", state: "done", agent: "lens", reviewer: "hu-ha", fence: 2, retry: "0/1", pri: "P2" },
    { id: "T-1031", title: "Viết runbook khôi phục R1", dept: "vh", state: "done", agent: "orbit", reviewer: "hu-qd", fence: 5, retry: "0/1", pri: "P2" },
    { id: "T-1027", title: "Đồng bộ nhãn profile delivery-demo", dept: "nd", state: "cancelled", agent: null, fence: 1, retry: "0/1", pri: "P3" }
  ],

  stateLabel: {
    backlog: "Backlog", ready: "Ready", doing: "Doing", waiting: "Waiting",
    review: "Review", done: "Done", failed: "Failed", cancelled: "Cancelled"
  },
  stateVi: {
    backlog: "Chờ lên lịch", ready: "Sẵn sàng nhận", doing: "Đang làm", waiting: "Chờ quyết định",
    review: "Chờ nghiệm thu", done: "Hoàn tất", failed: "Thất bại", cancelled: "Đã huỷ"
  },
  activityVi: { doing: "Đang làm", idle: "Rảnh", waiting: "Chờ người", cooldown: "Hồi quota", meeting: "Đang họp" }
};
