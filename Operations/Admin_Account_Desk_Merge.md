# The account desk absorbs the shopper report

**2026-09-21, `feat/admin-account-desk` off `main`.** Admin · Accounts, Shopper
report and Manage credits were three screens about the same person. They are now
one desk with three ways into one account.

Related: `Operations/Admin_Console_Triage_Rework.md` (what the console *says*),
`Operations/Admin_Console_And_Data_Cleanup.md` (the routes and the cleanup
registry — unchanged by this), `Operations/Credit_Management_Audit.md`.

---

## The problem, stated as a ticket

A shopper writes in: *"I paid for credits last week and they're gone."*

Before this change, answering that took **three screens and three searches for
the same person**:

| Screen | Answers | What it could not do |
| --- | --- | --- |
| Admin · Accounts | Who they are; suspend, restore, flag | Show a single thing that had *happened* to them |
| Shopper report | Ledger, receipts, devices, sessions, sign-in failures | Change anything |
| Manage credits | Move a balance | Show the ledger the balance came from |

Nothing carried the account across. The operator typed `sara@` into three
different search boxes, and the failure mode of that is not slowness — it is
**answering a ticket about the wrong shopper**, because the third search
returned a different Sara and nothing on the screen said so.

The row's affordance made it worse: a chevron that expanded into a panel
offering exactly two actions and no history at all.

---

## What a row looks like now

The chevron is gone. Every row carries three ways in:

```
┌──────────────────────────────────────────────┐
│ sara@example.com                             │
│ ACTIVE  UNLIMITED            74 cr  📄 💳 ⋯ │
└──────────────────────────────────────────────┘
```

| Icon | Opens | Why it earned a place on the row |
| --- | --- | --- |
| 📄 `reader-outline` | **AdminAccountDetail** — the actions and the entire report, for that shopper | The commonest question is "what happened to them", and it used to be a second screen and a second search |
| 💳 `wallet-outline` | The credit form, **inline on the row** | Adjusting a balance is what a support conversation most often ends in |
| ⋯ `ellipsis-horizontal` | The action sheet: suspend/restore, flag/clear, email the shopper, copy the summary | Everything that acts on the account but is not worth its own icon |

Tapping the row itself lands where 📄 does. It is the gesture people try first,
and a row that does nothing when pressed reads as a broken list.

### The new screen

`AdminAccountDetail` is the merge itself — identity and badges, then the actions,
then the whole report body underneath:

```
┌ Account · sara@example.com ───────────────┐
│ ACTIVE  UNLIMITED  ·  joined 2026-06-01   │
│ Ref google-oauth2|1…                      │
│ [Copy summary]        [Email shopper]     │
│ ACCOUNT ACCESS   ▸ Suspend account        │
│ REVIEW FLAG      ▸ Flag for review        │
│ ADJUST CREDITS   ▾ balance 74             │
│ Credits 74       ▾ Ledger           (12)  │
│ Purchases        ▾ Store top-ups     (2)  │
│ Receipts         ▾                   (3)  │
│ Access           ▾ Sessions          (2)  │
└───────────────────────────────────────────┘
```

**Deletion is deliberately not on it.** Suspending is reversible and belongs
here; erasing an account is not, and stays on the cleanup console behind its own
typed confirmation.

---

## The one genuinely new action: *Email the shopper*

The other sheet rows existed somewhere already. This one did not.

It opens a `mailto:` draft addressed to the shopper, with a greeting by first
name and **their own account facts already in the body** — status, plan, balance,
review flag, join date. Without it an operator switches app, retypes the address
off the row, and answers from memory; with it the reply is written against what
the account actually says.

It is **disabled with a reason rather than hidden** when the account has no
address on file — an Apple private relay withdrawn, or a provider that gave
nothing. A row that vanishes teaches an operator nothing. And a `mailto:` with an
empty recipient opens a blank compose window that looks exactly like the feature
being broken.

---

## What moved, and why it moved rather than being copied

Three surfaces now render the same account. Copying the wording across would
have been the smaller change today and the wrong one by the second copy, because
**the wording is the product**: "Suspend" and "Delete" are one careless sentence
apart, and an operator who reads the wrong one on one of three screens takes an
action they did not mean to take.

| New file | Holds | Rendered by |
| --- | --- | --- |
| `src/services/adminAccountActions.js` | Badges, status wording, the support summary, the confirm copy, the action list, the email draft — all pure | Accounts, the sheet, AdminAccountDetail |
| `src/components/AdminAccountReport.js` | The eight report sections + `reportSummary` | AdminAccountDetail, Shopper report |
| `src/components/AdminCreditAdjuster.js` | The give/take-back form, its confirm and its clamped message | Accounts (inline), AdminAccountDetail, Manage credits |
| `src/screens/AdminAccountDetailScreen.js` | The merged screen | — |

`AdminUserReportScreen` keeps the thing the desk does not offer: **free-text
search across every account**, for when you have a name or an id and no row to
tap. It renders the same body, and now offers a way through to the desk.

### The adapter that is easy to get wrong

`/api/admin/users` returns a flat row with `scanCredits` and `subscriptionTier`
on it. `/api/admin/users/:sub/report` nests the same two facts as
`credits.balance` and `subscription.tier`. Every helper reads the flat shape.

So a detail screen built straight from a report renders **"0 credits" and a FREE
badge for a paying shopper who has a balance** — the numbers are not missing,
they are one level down. `accountFromReport(report, fallback)` merges the two,
lets the report win field by field, and keeps a real `0` rather than treating it
as absent. It is pure and directly tested, including the zero case.

---

## Decisions worth not relitigating

1. **A full screen, not an inline expansion.** The report has eight collapsible
   sections; expanding it inside a list of up to 200 rows buries the list.
2. **Three icons, not two.** Credits is frequent enough to deserve one tap;
   everything else sits behind ⋯ where it can grow without crowding the row.
3. **The ⋯ sheet closes after a write, and the list re-reads.** Holding a row
   open after it changed meaning is how a sheet ends up offering "Suspend" on an
   account the previous tap already suspended.
4. **The inline credit form patches only its own row.** A full reload would
   re-fetch 200 accounts and collapse the form the operator is still using.
5. **The detail screen re-reads the whole report after every write.** Suspending
   also cancels a pending deletion server-side, and an adjustment also appends a
   ledger row — a balance that moved without its row appearing is precisely the
   drift this screen exists to make visible.
6. **The flag reason lives beside the button that writes it**, in the sheet and
   on the detail screen. An empty reason is recorded as `manual`, never as `""`.

---

## Backend

**None.** Every route this uses already existed and was already admin-gated:
`GET /api/admin/users`, `GET /api/admin/users/:sub/report`,
`POST /api/admin/users/:sub/status`, `POST /api/admin/users/:sub/review-flag`,
`POST /api/admin/users/:sub/credits`. No migration, no new endpoint, no change to
the admin allow-list.

---

## Tests

| Suite | Covers |
| --- | --- |
| `__tests__/adminAccountActions.test.js` | The pure wording: the confirm copy, the action list matching the dialog it leads to, the report adapter, the email draft |
| `__tests__/adminAccountsScreen.test.js` | The three row icons reaching the right account, the inline form moving one balance, the sheet's two writes behind confirms |
| `__tests__/adminAccountDetailScreen.test.js` | Reading the account it was sent, the nested balance, both writes re-reading, a failed load that still names the shopper |
| `__tests__/adminCreditsScreen.smoke.test.js` | Unchanged — it passed against the extracted form without edits, which is the evidence the extraction preserved behaviour |

The row icons carry no text, so the tests address them by `accessibilityLabel`.
That finder failing is a real defect: an icon button without one is also
unreachable with VoiceOver.
