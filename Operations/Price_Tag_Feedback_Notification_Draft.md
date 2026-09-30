# DRAFT — feedback push to the shopper who submitted six regular-price tags

**Status: NOT SENT. Maxim reviews and approves the wording first.** Nothing in the code sends this.

**Recipient:** the one account behind pending reviews #6–#11 (sub prefix `10385421`, has a push token, joined
2026-09-29). Re-resolve the sub from `tag_scan_reviews → devices.owner_sub` at send time.

**Goal:** thank them, make clear their tags were kept (they are useful), and explain — once, kindly — that only
*savings* tags earn free credits. No blame, no jargon, no promise of credit.

## Option A — warm (recommended)

| | en | fr |
|---|---|---|
| Title | Thanks for your price tags! | Merci pour vos étiquettes ! |
| Body | We kept all 6 — regular prices help everyone. Only tags with a savings (a discount and an end date) earn free credits. | Nous avons gardé les 6 — les prix courants aident tout le monde. Seules les étiquettes avec un rabais (et une date de fin) rapportent des crédits gratuits. |

## Option B — shorter

| | en | fr |
|---|---|---|
| Title | About your price tags | À propos de vos étiquettes |
| Body | Saved, thank you! Free credits go to SAVINGS tags only — look for a discount with an end date. | Enregistrées, merci ! Les crédits gratuits vont aux étiquettes de RABAIS — cherchez un rabais avec une date de fin. |

## Option C — most direct

| | en | fr |
|---|---|---|
| Title | Which tags earn credit? | Quelles étiquettes rapportent ? |
| Body | Only savings tags do — a discount with an end date on the tag. Your 6 regular-price tags are saved, but earn no credit. | Seulement les étiquettes de rabais — un rabais avec une date de fin. Vos 6 étiquettes à prix courant sont enregistrées, mais sans crédit. |

## Notes for the review

- The recipient's language is unknown from the users row (language lives in `user_preferences`); send in that
  language, English fallback — same as every other server push (`pushI18n`).
- Tapping it should open **Scan a price tag** (the intro screen carries the new "only savings earn credit" banner).
- Categories: a new `data.type` must be registered in `backend/shared/notificationCategories.js` (a push without a
  switchable category is refused by `sendUserPush`). It is a one-off service message, so it would sit in the
  transactional group, not the marketing-consent one. That wiring + a one-shot send script are **not built** —
  they wait for the wording sign-off, so nothing can be pushed by accident.
