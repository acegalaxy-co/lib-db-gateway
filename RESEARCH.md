# lib-db-gateway research — nguồn, phát hiện, hướng cải tiến

Snapshot 2026-09-24. Cách research: đọc code nguồn của chính repo này (factory
`createDbGateway` trong `index.ts`, layer authz/rate-limit/identity/audit,
3 adapter `notion`/`postgres`/`sqlite`), git history của repo (7 commit,
`git log`), `README.md` của repo Nexus gốc `commons/db-gateway/` (sơ đồ
5-layer), `src/app/dao/_internal/db-shadow.ts` (consumer shadow-mode duy nhất
hiện tại), rule Nexus có nhắc `db-gateway` (`system-ai-gateway.md`,
`system-ott.md`), và blackboard task-graph
`.claude/state/plan-commons-libs.md` (spec khoá cho #64-#68). Không đọc file
`.env` nào. Các fact về version/commit dưới đây là snapshot tại thời điểm
research — repo có thể đã đổi tiếp sau ngày này.

## Nguồn research

**Nội bộ:**
- Code repo này tại HEAD: `index.ts` (factory + legacy `query()`), `types.ts`,
  `authz/engine.ts` (`check`/`checkPolicy`), `identity/resolver.ts`,
  `rate-limit/limiter.ts`, `audit/logger.ts`,
  `adapters/{notion,postgres,sqlite,adapter-interface}.ts`.
- `git log --oneline` của chính repo này — 7 commit, không commit nào về
  extract-lib (repo được `gh repo clone` từ `acegalaxy-co/ace_commons-db-
  gateway-nodejs` rồi thay working-tree tại chỗ theo addendum wave 10 của
  plan file, chưa commit).
- Nexus `commons/db-gateway/README.md` — bản gốc trước khi tách lib, sơ đồ
  ASCII 5-layer `Caller → L2 identity → L3 policy → L4 rate-limit+pool → L5
  audit-log → L1 adapter`, ghi rõ "In-repo gateway — KHÔNG cài qua npm".
- `src/app/dao/_internal/db-shadow.ts` — consumer thật duy nhất: chạy song
  song `commons/db-gateway` bên cạnh `notion-helpers` cũ, chỉ log mismatch
  (`[db-shadow]`), bật qua `DB_GATEWAY_SHADOW_ENABLED=true`, luôn nuốt lỗi —
  xác nhận lý do legacy `query()` phải giữ nguyên semantics "dryRun +
  notion-only".
- `.claude/rules/project/system-ai-gateway.md` (dòng 49, 99) — ghi rõ
  "db-gateway + ott-gateway VẪN in-repo... mỗi project tự implement, KHÔNG
  require gateway project khác" và dẫn tiền lệ "ott/db từng npm rồi rollback
  in-repo"; `.claude/rules/project/system-ott.md` xác nhận tiền lệ đó (Phase 1
  ott-gateway "không còn npm `@acegalaxy/ott-gateway`" — quay lại in-repo).
- `.claude/state/plan-commons-libs.md` — spec khoá của task-graph #64-#68:
  cấu trúc package (`private:true`, `dist/` committed, exports map), API
  factory `createDbGateway(opts)`, phạm vi #64 (core) vs #65 (notion) vs
  #66 (postgres), addendum wave 10 (target = clone lại repo GH cũ, không
  tạo repo mới), quyết định REST fetch thay `@notionhq/client`.

**Ngoài** (đã tra cứu qua search, không fetch URL cụ thể — chỉ tên nguồn,
không bịa link): Prisma / Knex / Kysely (query builder Postgres/SQL đa-
dialect), `pg-format` (quote identifier chuyên dụng Postgres), mẫu
API-gateway default-deny (Kong/Envoy-style), `@notionhq/client` (SDK chính
thức Notion).

## Đã tham khảo gì

### Bài toán gốc trong Nexus — vì sao tách lib

`commons/db-gateway` từng cố ý ở in-repo (không phải quên tách) — rule
`system-ai-gateway.md` ghi "mỗi project tự implement, KHÔNG require gateway
project khác", và có tiền lệ thật: ott/db-gateway "từng npm rồi rollback
in-repo" (`system-ott.md`, lý do chi tiết không còn truy được, chỉ còn kết
luận). Khác biệt lần tách này: package `private: true` + git-dependency pin
theo tag (`github:acegalaxy-co/lib-db-gateway#v<ver>`), không phải npm
public như lần thử trước — giảm đúng loại rủi ro "drift" mà rollback cũ lo
ngại, đồng thời văn bản hoá lại 5-layer + 3 primitive bảo mật
(audit/caller-validator/rate-limit) từng bị inline riêng trong cả
`db-gateway` lẫn `ott-gateway` (2 gateway share byte-identical
`audit-log`/`rate-limit`, xem `lib-security-utils/RESEARCH.md`). Consumer
duy nhất hiện tại là `db-shadow.ts` — chạy song song, không throw, chỉ so
sánh outcome với `notion-helpers` cũ; vẫn là Phase 2a (log-only), chưa
cut-over.

### Ý tưởng thiết kế chính

- **Factory thay module-level singleton** — bản Nexus cũ export thẳng
  `query()` module-level dùng 1 config cố định; `createDbGateway(opts)` cho
  phép nhiều instance độc lập, đồng thời **giữ nguyên `query()` cũ** làm
  default instance `dryRun:true, adapters:{notion:{}}` để `db-shadow.ts`
  không phải sửa gì khi Nexus migrate sang package (#68).
- **`L1_adapter` deny khi store hợp lệ nhưng chưa configure** — default-deny
  tới tận layer cuối: adapter tồn tại về mặt tên (`"postgres"`) nhưng
  caller không truyền `opts.adapters.postgres` vẫn deny, tránh
  silent-fallback không mong muốn.
- **`dryRun` chạy hết L2-L4 + `adapter.validate()`, dừng trước I/O thật** —
  tách "request hợp lệ/được phép" khỏi "request có thực thi". Đây là cơ chế
  giữ shadow-mode an toàn tuyệt đối, không cần nhánh code riêng.
- **`IDBAdapter.validate()` là single source of truth, `execute()` gọi lại
  nó** (`postgres.ts` dòng 221, `notion.ts` dòng 114) — logic chặn
  injection/identifier chỉ viết 1 chỗ, không lệch giữa dryRun và real path.
- **Identifier allowlist thay vì escape** cho Postgres — `IDENTIFIER_REGEX`
  chặn table/column/where-key/archiveColumn trước khi quote bằng
  `quoteIdent()`; giá trị luôn qua `$n` placeholder. `rawSql` deny cứng.
- **Notion 429 retry-once có `Retry-After`** (`_fetchWithRetry`) — đọc header
  `Retry-After` nếu có, mặc định 1s, tối đa 1 lần retry. `_errorCode()` chỉ
  trích `code` từ body lỗi, không echo nguyên body — tránh rò rỉ dữ liệu.
- **`SHADOW_TARGET_REGEX` hợp lệ cho `validate()` nhưng bị `execute()` từ
  chối** — cho `db-shadow.ts` validate target rút gọn `notion:databases:
  <8hex>` trong dryRun, fail rõ ràng nếu ai đó gọi `execute()` thật với nó.
- **Audit log không bao giờ throw** — `_finalize()` bọc `auditLogger.record()`
  trong try/catch nuốt lỗi, kế thừa nguyên tắc "audit logging không được là
  single point of failure" từ `lib-security-utils`.
- **Rate-limit đọc env lazy tại thời điểm gọi** (`_envMaxRequests()`) — set
  `DB_GATEWAY_QPS_PER_MIN` sau khi module đã `require()` vẫn có hiệu lực.

### Prior art & vì sao tự viết

- **Prisma/Knex/Kysely** — query builder mạnh hơn nhiều nhưng giải quyết bài
  toán khác: không có khái niệm authz/policy/rate-limit/audit theo caller,
  đó là lớp phải tự viết thêm trên chúng. `lib-db-gateway` không cạnh tranh
  vai trò query builder (where đơn giản, `rawSql` deny cứng); mục tiêu là
  **security funnel** trước khi chạm driver, nên viết layer riêng nhỏ thay
  vì kéo theo 1 ORM đầy đủ.
- **`pg-format`** — làm đúng việc quote identifier, nhưng thêm 1 dependency
  ngoài cho hàm `quoteIdent()` ~5 dòng đã đủ dùng kết hợp `IDENTIFIER_REGEX`
  allowlist (pg-format cũng không tự làm allowlist thay mình). Không dùng.
- **API-gateway default-deny (Kong/Envoy-style)** — đúng pattern L2/L3 ở đây
  (default-deny khi thiếu field/entry) nhưng các gateway đó chạy như proxy
  network riêng biệt, quá nặng cho "1 factory function trong process
  Node.js". Lấy nguyên tắc, không lấy implementation.
- **`@notionhq/client`** — SDK chính thức, nhưng `notion-helpers` cũ mà
  `db-shadow.ts` đang so sánh đã dùng raw REST fetch trực tiếp — giữ nguyên
  cách đó ở `notion.ts` để hành vi khớp 1-1 với baseline shadow mode và
  tránh 1 dependency chỉ để wrap `fetch`; quyết định đã khoá sẵn trong plan
  file, không phải tự chọn lại.

## Hướng cải tiến

**Đã áp dụng:**
- Tách factory `createDbGateway(opts)` khỏi singleton `query()` cũ, giữ
  `query()` làm default instance tương thích ngược 100% với
  `db-shadow.ts` — theo spec #64 trong plan file.
- Thêm layer `L3_policy` optional (`checkPolicy`, per-service store/op/table
  ACL wildcard `"*"`) — không bắt buộc, không phá consumer chưa truyền
  `policies`.
- Notion adapter real `execute()` qua REST fetch + retry-once 429 (#65);
  Postgres adapter real `execute()` qua parameterized SQL + identifier
  allowlist, `pg` optional lazy-require (#66) — thay phần trước chỉ là stub.
- Đóng gói private git-dependency (`private: true`, `dist/` committed, không
  `prepare` script) thay vì pattern in-repo copy-paste giữa db-gateway/
  ott-gateway — quyết định khoá 2026-09-24, supersede rollback-in-repo cũ.

**Deferred / chưa implement:**
- SQLite adapter vẫn là Phase 1 stub (`execute()` throw "not implemented"),
  chưa nằm trong scope #64-#66 của đợt này; chỉ `validate()` đã có.
- `rawSql` deny cứng ở cả layer schema lẫn Postgres adapter — chưa có cơ chế
  allowlist-per-service cho raw SQL nếu tương lai cần.
- Nexus migration thật (#68: đổi `db-shadow.ts` require sang package name,
  xoá `commons/db-gateway`) vẫn pending — repo này đã chuẩn bị xong nhưng
  chưa consumer nào trỏ vào ngoài shadow-mode cũ.
- Chưa có test tích hợp Postgres thật ("skipped unless `PG_TEST_URL` set"
  theo plan file) — hiện chỉ mock `pool.query`.
- CI build/test qua nested private git-dependency
  (`@acegalaxy/lib-security-utils`) chưa xác nhận hoạt động — cần SSH/deploy
  key, còn lại ở bước push-gate theo plan file, chưa verify riêng repo này.
