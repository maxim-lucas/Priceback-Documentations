# R2 object storage — env split

One Cloudflare R2 bucket (`R2_BUCKET`, default `priceback-receipts`) serves
every environment. Objects are namespaced under a root folder per
environment, each carrying the same two subfolders:

```
<bucket>/
  prod/
    receipts/<userSub>/<receiptId>.jpg
    price-tags/<deviceHash>/<reviewId>.jpg
  preview/
    receipts/...
    price-tags/...
  dev/
    receipts/...
    price-tags/...
  local/
    receipts/...
    price-tags/...
```

## Implementation

`backend/storage/storageEnv.js` resolves the current env slug and builds
namespaced keys via `storageKey(folder, ...parts)`. Every call site in
`backend/server.js` that mints an object key (receipt image upload,
price-tag review image upload) goes through this helper, as do the two
ownership/ownership-shape checks (`/api/receipts/:id/image-uploaded`,
`/api/observations/tag/image-uploaded`) so a key from one env can never be
confirmed against another env's row.

Resolution order:

1. `R2_ENV` — explicit override, one of `prod` / `preview` / `dev` / `local`.
   Set this on every Railway service; it's the only fully reliable signal.
2. `RAILWAY_ENVIRONMENT_NAME` — Railway's built-in var. `"production"` →
   `prod`, `"development"` → `dev`, anything else (a PR/preview environment)
   → `preview`.
3. `NODE_ENV=production` → `prod`.
4. Default `local` (dev machines, CI, tests).

## Rollout state (2026-08-05)

- Code merged: keys are now env-prefixed for all *new* uploads.
- `R2_ENV` is **not yet set** on either Railway service — until it is, both
  `priceback-production` and `priceback-development` fall back to
  `RAILWAY_ENVIRONMENT_NAME` inference (should resolve to `prod` and `dev`
  respectively; verify against the actual Railway env name before relying on
  it, and set `R2_ENV` explicitly instead of trusting the inference).
- Objects uploaded **before** this change live at the old, unprefixed keys
  (`receipts/<sub>/...`, `tag-reviews/<hash>/...`). They are not migrated —
  the legacy `tag-reviews` shape-only regex fallback in
  `/api/observations/tag/image-uploaded` still exists but now requires an env
  prefix, so it only matches *new-style* legacy-hash rows, not the very old
  unprefixed ones. Old objects are left in place at bucket root; nothing
  currently deletes or reads them by an env-scoped path, so they're inert
  clutter rather than a correctness risk. A one-off migration script (list +
  copy + delete under the new prefix) is the natural follow-up if bucket
  hygiene matters later — not done as part of this change.
