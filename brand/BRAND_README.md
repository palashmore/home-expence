# GharKhata: new name and logo

Preview: `brand-preview.png`. Everything here is a drop-in for your repo's existing file names.

## 1. Name suggestions

Your current name, "Home Expence", has a spelling mistake ("Expense"). It also only says "expenses", but the app does payroll,
reimbursement, budgets and multiple households.

| Name | Meaning | Why / why not |
|---|---|---|
| **GharKhata** (my pick) | Ghar = home, Khata = ledger / account book | Short, easy to say, instantly understood in India, covers more than expenses. Works in English letters |
| GharHisaab | "home accounts" (hisaab-kitaab) | Friendly and everyday. Slightly harder to spell for some |
| KharchaKhata | "expense ledger" | Very literal, good for search, less room to grow |
| ParivarKhata | "family ledger" | Warm, family feel. Longer |
| HomeLedger | English only | Neutral and international, but generic and harder to protect as a brand |
| Home Expense | fixed spelling | Safest if you do not want to rename anything |

Before you commit to a name, check: a domain (for example `gharkhata.in` / `.app`), Play Store and App Store search,
and an Indian trademark search (ipindia.gov.in). I could not check availability from here, so treat all names as unchecked.

## 2. The logo

A white house with a rupee sign cut into it (you see the gradient through the ₹). Colors are your app's own indigo and violet
(`#6366f1`, `#4f46e5`, `#7c3aed`). Why it replaces the old one:

- The old icon said "money" but not "home". The new one says both in one shape.
- The old `icon-512.png` had a dark square baked around the rounded icon and was marked `maskable`, so Android would crop it and show a small icon in a dark frame. The new set has a proper transparent icon AND a separate full-bleed maskable icon.
- It still reads at 16 px (browser tab) and inside Android's circle mask.
- The header logo in the app is a different tiny drawing today. Using one logo everywhere makes it look like one product.
- The wordmark is converted to outlines from your app's own font (Plus Jakarta Sans), so it looks the same everywhere with no font to install.

## 3. Files

| File | Use |
|---|---|
| `icon.svg` | Browser tab icon, in-app header logo (replaces the existing file) |
| `icon-192.png`, `icon-512.png` | PWA icons, "any" purpose (replace the existing files) |
| `icon-maskable-512.png` | **New.** Android adaptive icon (safe-zone padded, full bleed) |
| `apple-touch-icon.png` | iPhone home screen (180 px, full bleed, iOS rounds it) |
| `favicon.ico` | **New.** Stops the `/favicon.ico` 404 |
| `manifest.json` | Drop-in manifest (name set to GharKhata, icons split into any / maskable) |
| `logo-lockup.svg/png`, `logo-lockup-dark.svg/png` | Icon + name + tagline for the login screen, README, WhatsApp / social share |

## 4. Install: exact edits

Copy all icon files into the repo root (same folder as `index.html`). Then make these edits. **The first two are required** or the new
files will not load, because the server only serves files on an allow-list and the service worker only caches listed files.

1. **`server.js`**: add to the `staticFiles` array: `'icon-maskable-512.png'`, `'favicon.ico'`, `'logo-lockup.svg'`, `'logo-lockup-dark.svg'`, `'og-image.png'`. Also add `'.ico': 'image/x-icon'` to `mimeTypes` if it is not there.
2. **`sw.js`**: add `'/icon-maskable-512.png'` to `STATIC_ASSETS` and change `CACHE_NAME` from `homeexpenses-v11` to `homeexpenses-v12`, so phones drop the old cached icons.
3. **`manifest.json`**: replace with the file from this folder. If you choose a different name, edit `name` and `short_name` only.
4. **`index.html`** `<head>`: change `<link rel="apple-touch-icon" href="/icon-192.png">` to `href="/apple-touch-icon.png"`, and add `<link rel="icon" href="/favicon.ico" sizes="any">`.
5. **`index.html` header logo** (around line 82): replace the small gradient box with its inline `<svg>` by
   `<img src="/icon.svg" alt="GharKhata" class="w-8 h-8 sm:w-10 sm:h-10 rounded-2xl shrink-0">`.
6. **Name text** (only if you pick a new name), replace "Home Expence": `<title>`, `apple-mobile-web-app-title`, the install banner ("Install Home Expence"), the header text, `manifest.json`, `README.md`, and any push notification titles. Find them with `git grep -n "Home Expence"`.
7. **Do NOT rename** internal keys: `homeexpenses_offline_queue`, `household_auth_token`, the `homeexpenses_tx_sync` channel, or other `localStorage` keys. Renaming them would log everyone out and lose queued offline entries.
8. Test on a phone: uninstall the old PWA, open the site, choose "Add to Home screen", and check the icon. Android needs a fresh install to show a new icon.

## 5. Paste-ready Copilot prompt (Agent mode)

> Rebrand the app from "Home Expence" to "GharKhata" using the files in the `brand/` folder I added. Do not touch `data/`.
> 1. Copy `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon.ico`, `logo-lockup.svg`, `logo-lockup-dark.svg` to the repo root, and replace `manifest.json` with `brand/manifest.json`.
> 2. In `server.js` add `icon-maskable-512.png`, `favicon.ico`, `logo-lockup.svg`, `logo-lockup-dark.svg` to `staticFiles` and `.ico` to `mimeTypes`.
> 3. In `sw.js` add `/icon-maskable-512.png` to `STATIC_ASSETS` and bump `CACHE_NAME` to `homeexpenses-v12`.
> 4. In `index.html` set `apple-touch-icon` to `/apple-touch-icon.png`, add `<link rel="icon" href="/favicon.ico" sizes="any">`, replace the header logo box at ~line 82 with `<img src="/icon.svg" alt="GharKhata" class="w-8 h-8 sm:w-10 sm:h-10 rounded-2xl shrink-0">`.
> 5. Replace the visible text "Home Expence" with "GharKhata" in `index.html`, `README.md` and notification titles. Do NOT rename any `localStorage` key, BroadcastChannel name, cache prefix other than the version bump, or file/API path.
> 6. Run `bash ./run_tests.sh` and make sure it passes. Commit as `feat(brand): new name and logo`. Do not push.

## 6. Full logo kit (GharKhata)

| File | When to use |
|---|---|
| `logo-lockup` (+ `-dark`) | Horizontal: icon + name + tagline. Login header, website, README, email |
| `logo-stacked` (+ `-dark`) | Icon above the name. Splash screen, login card, posters, presentation title |
| `logo-bilingual` (+ `-dark`) | Icon + GharKhata + घर खाता. Printed cards, stickers, anywhere the family or staff read Hindi |
| `mark-mono-black/white/indigo` (.svg + transparent .png) | One-colour house mark with no background: stamps, invoice/report header, watermark, WhatsApp stickers, embroidery or print |
| `og-image.png` (1200x630) | The preview card when the link is shared on WhatsApp, Telegram, Facebook, LinkedIn |
| `github-social-preview.png` (1280x640) | GitHub repo, then Settings, then Social preview |

Every wordmark is converted to outlines (your app's Plus Jakarta Sans and Noto Sans Devanagari), so the files look identical on any device with no fonts installed.

**Use the share image:** copy `og-image.png` to the repo root, add `'og-image.png'` to `staticFiles` in `server.js`, and add to the `<head>` of `index.html`:
```html
<meta property="og:title" content="GharKhata · Household Financial Command Center">
<meta property="og:description" content="Household expenses, staff payroll, reimbursements and budget in one place.">
<meta property="og:image" content="https://home-expence-pink.vercel.app/og-image.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```
(If you later change the web address, update the `og:image` URL.) WhatsApp caches previews, so an old link may keep showing the old card for a while.

**Hindi text check:** the tagline in the share image, "घर का हिसाब, एक जगह" (roughly "the home's accounts, in one place"), is my own translation. Have a Hindi speaker confirm the wording before you print or publish it.

**Colors:** Indigo `#4f46e5`, Violet `#7c3aed`, Light indigo `#a5b4fc`, Dark navy `#0f172a`, Slate `#64748b`. Font: Plus Jakarta Sans (700 / 800).
**Clear space:** keep at least the height of the roof peak free on all sides of the icon. **Minimum size:** 16 px for the icon alone, 120 px wide for any lockup.
