# Part F — Backup, cleanup and the no-regression proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back up every product-related table, fold misread products into the real ones, remove junk warehouses, fill names, and prove on every production receipt that no paid price, quantity or total changed — Maxim approves any receipt that would.

**Architecture:** Three operator scripts under `backend/scripts/`, each read-only unless `--apply`, each refusing to touch a database whose project ref is not the one named on the command line (`--expect-ref`): `catalog-backup.mjs` (server-side `CREATE TABLE … AS`, a dated schema, plus `--restore <table>`), `catalog-cleanup.mjs` (plan → report → apply: warehouses, misread folds via the existing `catalogFixer` / `mergeProducts`, refreshes), `receipt-proof.mjs` (snapshot before, snapshot after, diff, classify). The apply runs the same plan the report showed; the proof is re-run after the apply.

**Tech Stack:** Node.js (ESM scripts + CommonJS repos), raw `sql`, PostgreSQL, `node:test`.

**Spec:** `Technical/Product_Catalog_Rebuild_Design.md` §5 (2, 3, 7, 13, 14), §6.6, §6.7, §6.8.

**Branch:** `hotfix/products-catalog-cleanup`, cut from `hotfix/products-catalog-model` (needs 0044 and the refreshes) → PR into `main` after #528 and the D–E PR.

## Global Constraints

- Dev first (`gnedluuylimjwdmtvswl`); prod (`xjfrlzwonyaorwktnkpj`) only on Maxim's explicit go, after migration 0044 is applied there by hand and the D–E code is deployed.
- Every script: dry run by default; `--apply` writes; `--expect-ref <ref>` must equal the URL's project ref or the script exits 3 before any query.
- Backup schema `backup_YYYYMMDD` (never exposed to the Data API: no grants), tables copied in full: `products`, `receipt_items`, `receipts`, `price_points`, `catalog_items`, `product_merges`, `pending_price_savings`, `savings`, `saving_warehouses`, `tag_scan_reviews`, `tag_credit_settlements`, `warehouses`, `watch_registrations`, `price_drop_review_queue`, `price_drop_notifications`, `price_drop_guarantees`, `product_regular_prices`. Kept until Maxim says drop.
- Folds only through `productCatalogRepo.mergeProducts` (aliases kept; old ids answered with the real product). Never delete a product with receipt lines; never re-create a product with a new id.
- Fee products (`lib/feeLines`) are never folded, renamed or priced (§6.8).
- Warehouses: a row with **no reference at all** (receipts, price points, saving links, regular prices) and no match in Same-Day's location lists is deleted; a referenced unknown is listed for Maxim, never deleted.
- Receipt root causes: one section per class in `Technical/Receipt_Parser_Root_Causes.md` with a case table (Maxim, decision 13); the run logged in `Operations/Bad_Scan_Receipt_Repair_Runbook.md`.
- No push, no charge, no notification is caused by the cleanup itself (drops stay behind the review queue: prod `PRICE_DROP_REVIEW_REQUIRED = true`).

## Review Focus

1. **A fold whose real product already has a price point for the same receipt line ref** — `mergeProducts` drops the twin; the proof must show the line's paid price unchanged (the receipt line keeps its own columns).
2. **A misread product that a shopper is watching** — the watch registration is re-pointed; the proof lists it as "better item number".
3. **A suspect one edit away from two real products** — never folded (the fixer's "no decision"), listed.
4. **An `ln:` placeholder whose printed text matches a real product's receipt name** — folded only with the price agreeing (§6.6 step 3); a fee placeholder never.
5. **A warehouse referenced only by a soft-deleted receipt** — still referenced: listed, not deleted.

---

### Task 1: `catalog-backup.mjs` — dated backup and per-table restore
Files: create `backend/scripts/catalog-backup.mjs`, `backend/lib/catalogBackup.js` (pure: `backupStatements(schema, tables) → string[]`, `restoreStatements(schema, table) → string[]`); test `backend/tests/catalogBackup.test.js` (statements pinned: `CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE <schema>.<t> AS TABLE priceback.<t>`, refuses an existing backup table) and `catalogBackupDb.test.js` (a fold on dev, then the restore, gives back the folded product, its lines' product links and its price points).
**Restore = undo the cleanup, never a table replace** (found while building it, 2026-11-03): deleting `products` cascades to price points, savings and tag reviews, and on prod shoppers keep writing during the cleanup — a whole-table copy back would erase everything filed after the backup. So: re-insert the rows the cleanup deleted (`INSERT … SELECT … ON CONFLICT (id) DO NOTHING`, parents first) and, for `receipt_items`, put back `product_id` / `sku_read` where a fold changed them. No `DELETE` / `TRUNCATE` ever. *Started:* `lib/catalogBackup.js` + its test exist on `hotfix/products-catalog-model` (untracked until the Part F branch).

### Task 2: `receipt-proof.mjs` — snapshot, diff, classify
Files: create `backend/lib/receiptProof.js` (pure: `classifyReceipt(before, after) → "unchanged" | "better_sku_or_label" | "price_changed" | "drop_eligible_changed"`, `diffSnapshots(a, b) → { receipts: [...], counts }`), `backend/scripts/receipt-proof.mjs` (`--snapshot <file>`; `--diff <before> <after> --out <report.md>`), tests `receiptProof.test.js`. Per line: id, receipt, position, product id, SKU, product name, printed name, quantity, unit price, line total, original price, claimed/claim source, watch, ignored, `sku_read`; per receipt: total, tax, warehouse; plus review-queue / notification / guarantee rows by receipt line. `price_changed` = any of quantity, unit price, line total, original price, receipt total or tax differs.

### Task 3: `catalog-cleanup.mjs` — plan, report, apply
Files: create `backend/scripts/catalog-cleanup.mjs`; modify `backend/repos/productCatalogRepo.js` (`junkWarehouses()`, `placeholderMatches()` — `ln:` placeholders on live lines whose printed text equals a real product's receipt name in the receipt's language and whose paid unit price is within 30 % of that product's usual price, fee placeholders excluded); tests `catalogCleanupDb.test.js` (Review Focus 3–5 on dev fixtures). Steps of a run: (1) junk warehouses → delete (apply) / list referenced unknowns; (2) `catalogFixer.planFixes` → merges (apply through `mergeProducts`, reason `sku_misread`) and suspects (listed); (3) placeholder matches → `mergeProducts`; (4) `refreshChannels`, `refreshReceiptNames`; report Markdown with every fold (from → to, evidence, receipts touched) and every suspect.

### Task 4: Dev rehearsal, then the prod run on Maxim's go
- Dev: backup → snapshot → cleanup dry run → cleanup `--apply` → snapshot → diff → restore one table and re-diff (the restore works) → report.
- Prod (only after Maxim's go, 0044 applied by hand, D–E deployed): same sequence with `--expect-ref xjfrlzwonyaorwktnkpj`; the diff report goes to Maxim; any `price_changed` receipt is held for his approval (restore from the backup if he refuses); root causes per class and the runbook log written the same day.
