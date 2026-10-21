# Security model & test report

## Permission matrix (enforced in Postgres)

| Object | anon | npp | rare_disease | admin |
|---|---|---|---|---|
| `shipments` select | ✗ | NPP rows | RARE_DISEASE rows | all (incl. archived) |
| `shipments` insert | ✗ | NPP only (RLS `with check`) | RARE only | any |
| `shipments` update | ✗ | own dept; stage/hold/archive/POD/code/department blocked by trigger | same | same |
| `shipments` delete | ✗ | ✗ (privilege revoked) | ✗ | ✗ (archive instead) |
| `shipment_updates` | ✗ | read own dept; write only via RPC; never update/delete | same | same |
| `payments` | ✗ | read own dept; write only via `record_payment` (idempotent) | same | same |
| `medicine_stock` | ✗ | own dept; quantities only via `record_stock_movement` | same | all |
| `audit_logs` | ✗ | ✗ | ✗ | read only |
| `profiles` | ✗ | own row | own row | read all; change others via `admin_update_profile` (not self) |
| `app_settings` | ✗ | read | read | update via `update_settings` |
| Storage `shipment-documents` (private) | ✗ | objects under a shipment they can access | same | + delete |

Identity is always `auth.uid()` inside the database. `created_by`, `updated_by`, `recorded_by`, `actor_id` are set server-side; client values are overwritten or ignored. Inactive profiles get no access.

## Controls

* **Secrets:** only the publishable key is shipped to the browser. `.env*` is git-ignored; `.env.example` holds placeholders. Legacy exports (`raw/`, `out/`) containing patient data are git-ignored.
* **Functions:** all `SECURITY DEFINER` functions use `set search_path = ''` and check department access themselves. The "via RPC" bypass flag is transaction-local and single-use.
* **Input validation:** Zod in the UI; enums, CHECK constraints (non-negative money/quantities, ISO currency, hold needs reason, correction needs reason, code prefix matches department) and length checks in Postgres.
* **Search:** PostgREST filter metacharacters are stripped from search text; all queries are parameterised.
* **XSS:** notes are rendered as plain text (React escaping); no `dangerouslySetInnerHTML`.
* **Uploads:** PDF/PNG/JPEG/WEBP only, ≤10 MB (bucket-level limits) and path pattern `<shipment-uuid>/<timestamp>-<safe-name>.<ext>` enforced by storage policy; downloads via 60-second signed URLs; no upsert/overwrite.
* **Errors:** UI shows friendly messages; raw database errors are never displayed.
* **Headers:** CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (`vercel.json`). Source maps disabled in production builds.
* **Auth:** Supabase Auth with session persistence; password reset gives the same response whether or not the email exists.

## Tests executed (21 Oct 2026, against the live database, each in a rolled-back transaction)

| Test | npp | rare_disease | admin |
|---|---|---|---|
| Rows visible | 149 NPP / 0 Recordati ✅ | 0 NPP / 234 Recordati ✅ | 149 / 257 ✅ |
| Audit log visible | 0 ✅ | 0 ✅ | all ✅ |
| Profiles visible | own only ✅ | own only ✅ | all ✅ |
| Add note to other department's shipment | blocked ✅ | blocked ✅ | allowed ✅ |
| Create shipment in other department | blocked by RLS ✅ | blocked by RLS ✅ | allowed ✅ |
| Self-promote to admin (`update profiles`) | permission denied ✅ | permission denied ✅ | permission denied ✅ |
| Delete history | permission denied ✅ | permission denied ✅ | permission denied ✅ |
| Backward stage move without reason | rejected ✅ | rejected ✅ | rejected ✅ |

Finding fixed during testing: the RPC bypass flag persisted for the rest of a transaction, so a direct stage `UPDATE` issued *after* an RPC in the same transaction was accepted. Through the REST API each request is its own transaction, so this was not reachable from the app, but the flag is now consumed by the single row the RPC updates (migration `…0004`).

## Outstanding items (need configuration or follow-up)

1. **Disable public sign-up** in Supabase Auth settings (not settable from code). Until then, a self-registered user has no profile and therefore no data access, but should not exist.
2. Set Auth **Site URL** to the production domain for reset emails; consider custom SMTP.
3. Rotate the initial passwords handed over at setup (users should reset them on first login).
4. Malware scanning of uploads is not implemented.
5. Rate limiting relies on Supabase Auth defaults; no custom limits on RPCs.
6. Re-run the rolled-back RLS test after the single-use-flag fix (the second run was cancelled before it executed).
