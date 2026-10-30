# Home hero card — "To claim" carousel

Decided by Maxim, 2026-10-30. Code: `src/screens/HomeScreen.js` (hero), `src/components/HeroPager.js`
(carousel), `src/services/dropTotals.js` (`openDropTotals`, `splitClaimTotals`).

`hero_lime_vs_champagne.html` — standalone mockup (open in a browser; each card swipes). Both options
are kept for future edits.

| Option | Accent | Soft (cents, $) | Status |
|---|---|---|---|
| **A · Lime** | `#bef264` | `#d9f99d` | **Shipped** |
| B · Champagne | `#f5e6b8` | `#fbf3dc` | Kept as alternative |

Card background stays the brand green gradient (`COLORS.ink` `#0d3d28` → `COLORS.inkDeep` `#062a1a`).

## Layout rules
- Title "TO CLAIM" top-left (no arrow); carousel bars top-right, level with the title.
- Amount 56pt, `$` and cents 24pt in the soft accent.
- **Some drops locked:** line 1 `✓ $X ready · N drops` (omitted when nothing is ready), line 2
  `🔒 $Y locked · N drops`. No "unlock with credits" link (Maxim: removed).
- **Nothing locked:** one line `✓ N drops · on M receipts`.
- Footer: one small line `⏱ 3d left · Tap for more details` — the nearest deadline, never a
  product name.
- The four stat tiles (Alerts / Watching / Claimed / Receipts) were removed: Alerts repeated the hero.
- Carousel: one page per swipe (snap, fast deceleration, no multi-page fling), `nestedScrollEnabled`
  for Android inside Home's vertical scroll, 120 ms press delay so a swipe is never a tap.
