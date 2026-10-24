# Gemini receipt reading — privacy disclosure (2026-10-23)

**Why this page exists.** Priceback #484 makes Google Gemini the first reader of Costco receipts, switchable from
Admin · Receipt reading (Maxim, 2026-10-21). **Both switches ship OFF.** This page lists what Gemini receives,
under which terms, and what has to be published **before either switch is turned on in production**.

Maxim's decision (2026-10-22): **keep the free key as a backup, and disclose it.** The paid key reads first.

Related: `Security/Security_Roadmap.md` **R3-3**, `Publishing-Compliance/Play_Data_Safety_Answers.md`,
`Technical/Receipt_Parser_Design_Rules.md` §7.

---

## 1. What Gemini receives

| | |
|---|---|
| **What** | The **text** recognized on a receipt by Google Cloud Vision, never the photo. The item text is denoised first: the payment and card block, the member line, approvals, tender and footers are removed (`backend/lib/receiptLlmRules.denoiseReceiptText`). The header OCR (store name, warehouse, address) is sent as printed. |
| **Which receipts** | Costco **in-warehouse** receipts scanned with the camera or a photo (Vision-sourced). Never an online order, a refund, a US receipt, or a **receipt imported from Gmail**: Gmail receipts never leave the phone (Google API *Limited Use*, guarded by a test). |
| **When** | **Gemini reads first** on: at scan time, from the app (build after 3.1.3). **Gemini re-reads** on: on the server, within 30 min of an upload, for every app build. The admin's *Fix automatically* button and Plan A (`/api/ocr-llm`) already did this before #484, on request. |
| **Who it identifies** | The request carries no name, email or account id, only the receipt text. The text itself is a purchase history (what was bought, where, when and for how much). |
| **Which key** | `GEMINI_API_KEY` (**paid** Gemini API, billing on): Google does not use the content to improve its products. When it fails (no credit, quota), `GEMINI_API_KEY_FREE` (**free** tier) answers instead: under Google's terms for unpaid services, Google **may use the submitted text to improve its products, including human review.** |

## 2. What must be published before a switch goes on in production

1. **Website privacy policy** (separate repo, Maxim's): a paragraph in the AI / service providers section, EN and FR,
   e.g.:

   > **Reading receipts with Google Gemini.** To read your Costco receipts accurately, PriceBack sends the text
   > recognized on the receipt (never the photo) to Google's Gemini service, which returns the items, prices and
   > totals. Payment details are removed before sending. We use a paid Gemini plan, under which Google does not use
   > this text to improve its products. If that plan is unavailable, we may use Google's free Gemini plan, under
   > which Google may use the text, including through human review, to improve its products. Receipts imported
   > from Gmail are never sent.

   > **Lecture des reçus avec Google Gemini.** Pour lire vos reçus Costco avec précision, PriceBack envoie le texte
   > reconnu sur le reçu (jamais la photo) au service Gemini de Google, qui en extrait les articles, les prix et les
   > totaux. Les informations de paiement sont retirées avant l'envoi. Nous utilisons une offre Gemini payante, avec
   > laquelle Google n'utilise pas ce texte pour améliorer ses produits. Si cette offre n'est pas disponible, nous
   > pouvons utiliser l'offre gratuite de Gemini, avec laquelle Google peut utiliser ce texte, y compris par une
   > relecture humaine, pour améliorer ses produits. Les reçus importés de Gmail ne sont jamais envoyés.

2. **Play Data Safety** (`Play_Data_Safety_Answers.md`): Gemini is listed as a processor ("not sharing"). That holds
   for the **paid** key only. Under the free tier Google uses the data for its own purposes, which is
   **sharing** by Google's definition. As long as `GEMINI_API_KEY_FREE` is set in production, *Purchase history* must
   be declared **Shared** (purpose: App functionality). Removing the free key from production keeps the current
   answers true.
3. **App Store privacy label:** the same logic. *Purchases* is already declared as collected; with the free key,
   review whether Apple's "third-party partner" definition applies.

## 3. Checks owed before turning a switch on

- [ ] Look at a sample of production `receipts.header_ocr` values and confirm **no membership number** is in the
      header text. The header is sent as printed; if a member line appears there, strip it before it goes to Gemini
      (a one-line change in `receiptAutoFix.proposeReceiptFix`'s prompt).
- [ ] The privacy policy paragraph above is live on priceback.ca (EN `/privacy`, FR `/privacy-fr`).
- [ ] Data Safety and the App Store label updated, **or** `GEMINI_API_KEY_FREE` removed from production.
- [ ] `Security/Security_Roadmap.md` R3-3 closed with the date and the option taken.
