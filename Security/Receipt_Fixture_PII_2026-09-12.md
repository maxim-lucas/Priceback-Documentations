# A real delivery postal code in three Costco fixtures — known, measured, deferred

**Status: 🟡 DEFERRED BY DECISION, not an oversight.** Recorded here so it stays
visible instead of being rediscovered — and re-declined — once a session.

**Decision:** Maxim, 2026-09-12. Leave the fixtures as they are; write this down.

> **A note on this document's own hygiene.** The last three characters of the
> value are masked below (`K1J ●●●`). The finding is findable by its forward
> sortation area and by the reproduction command, so there is no reason to copy
> a complete personal postal code into a fourth file. The full value is in the
> three fixtures and in the scrubber's own dry-run output.

## The finding

`npm run scrub:receipts` — the repo's own PII pass, dry run by default — reports
three fixtures still carrying an unmasked postal code:

```
__tests__/fixtures/receipts/Screenshot_20260525-004525.vision.json
__tests__/fixtures/receipts/Screenshot_20260525-004545.vision.json
__tests__/fixtures/receipts/Screenshot_20260525-004615.vision.json

  - "at Gloucester | Delivering to K1J ●●●"
  + "at Gloucester | Delivering to X9X 9X9"

3 fixture(s) would change, 61 already clean.
```

These are screenshots of Costco's **Orders & Purchases** screen, captured
2026-05-25.

## Why it is personal data — and why the line under it is not

The two lines sit one above the other in the same capture, and only the first is
personal:

```
at Gloucester | Delivering to K1J ●●●     ← the account holder's DELIVERY code
GLOUCESTER BUS CTR #802
1900 CYRVILLE RD
GLOUCESTER, ON K1B 1A5                    ← the STORE's own code, public
```

**They are different postal codes.** `K1B 1A5` is the warehouse's address and is
ordinary public business information. `K1J ●●●` is where the order was going.
That distinction is the whole reason the scrubber flags one line and ignores the
other, and it is worth knowing before anyone concludes "it's just the store
address" and closes the finding — which is the obvious wrong turn here.

## The blast radius, measured

Applied locally with `-- --write`, run, and reverted. **Only the header digest
moves, in exactly three snapshots:**

```
-   "headerOcrDigest": "fnv1a:c24c4967:len101"
+   "headerOcrDigest": "fnv1a:65478b8f:len101"
```

| Thing | Effect |
| --- | --- |
| Item lines, prices, totals, tax, dates, store attribution | **unchanged** — byte-identical output |
| `headerOcrDigest` | changes in 3 golden snapshots; `len101` identical, because `X9X 9X9` is the same length as the real value |
| Costco **source** hashes in `costcoPathImmutability.test.js` | untouched — no source file changes |
| The frozen fixture digest (`FIXTURE_DIGEST`) | **not affected.** It covers `__tests__/fixtures/receipts/Costco Receipts PDF`; these three files live one directory above it |
| `npx jest costco receiptGolden receiptParserRegistry` with the scrub applied | 615 of 618 pass; the 3 failures are precisely the 3 snapshots above |

So the change is cosmetic with respect to parsing behaviour. It is still a
rewrite of committed Costco corpus data, which is a reviewed act under the
standing freeze — that is why it is a decision and not a chore.

## A different thing that shares the same string

Five test files contain `"Gloucester, ON K1J ●●●"`:

```
__tests__/ocrCleanup.test.js           (3 occurrences)
__tests__/receiptGeometry.test.js      (3, one inside a regex assertion)
__tests__/ocrService.test.js           (2)
__tests__/receiptPipeline.live.test.js (1)
```

These are **not** captured data. They sit inside `FR_RECEIPT` and friends —
hand-written synthetic receipts — where the value is used as a *store address*
line for a fictional `Gloucester #1362, 1405 Blair Place`. Whoever wrote them
appears to have copied a real postal code to make the fixture look plausible.

The scrubber does not see them: it walks `.vision.json` captures in four fixture
directories and never reads test sources. They are listed here so that a future
`grep` finds this note and does not mistake eight synthetic assertions for the
same three-file finding. Changing them is a separate, wider edit across shared
parsing tests, and was explicitly not chosen.

## Why it was deferred

- **Both repositories are private.** There is no external exposure today.
- **The Costco corpus is frozen.** Rewriting it is deliberate, reviewed work, and
  the behavioural payoff here is nil — the parser reads the same numbers either
  way.
- The cost of leaving it is bounded and now written down.

## 🔴 Re-evaluate if either repository becomes public

That is the trigger. If it fires, the fix is five minutes:

1. `npm run scrub:receipts -- --write`
2. `npx jest receiptGolden -u`
3. Confirm the snapshot diff contains **only** `headerOcrDigest` lines — if
   anything else moved, stop; the assumption above has expired.
4. `npx jest costco receiptParserRegistry` — the Costco freeze must still pass
   untouched.
5. Its own PR, whose message says it is a privacy scrub and that no Costco
   behaviour changed.

Decide separately, and say so in that PR, whether the five synthetic test files
should stop borrowing a real postal code.
