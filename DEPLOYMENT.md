# Deploying to Vercel

Login will not work until `JWT_SECRET` is set, and push notifications will not
survive a cold start until the VAPID keys are set. Both are explained below.

---

## 1. Generate the secrets

Run this once, on your own machine, in the repo root:

```bash
npm run keys
```

**On Windows PowerShell**, `npm run keys` may fail with *"npm.ps1 cannot be
loaded because running scripts is disabled on this system"*. That is PowerShell's
execution policy blocking npm's `.ps1` shim, not a problem with this repo. Use
either of these instead:

```powershell
node scripts/generate_keys.js      # simplest - skips npm entirely
npm.cmd run keys                   # or call the .cmd shim directly
```

To fix it for good (per-user, no admin rights needed):

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

The same applies to `npm test` and `npm run audit` — use `npm.cmd`, or run
`bash ./run_tests.sh` and `bash ./run_audit.sh` directly.

It prints three values:

```
JWT_SECRET=...
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

Keep the output somewhere safe. **Never commit it**, never paste it into a chat,
an issue, or a screenshot. If a value is ever exposed, generate a new one and
replace it — rotating `JWT_SECRET` signs everybody out, which is the correct
outcome after an exposure.

<details>
<summary>Doing it without the npm script</summary>

```bash
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# VAPID pair
node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys(),null,2))"
```
</details>

---

## 2. Add them to Vercel

**Dashboard:** your project → **Settings** → **Environment Variables**. Add each
one for **Production**, **Preview** and **Development**, then **Redeploy** —
environment variables are read at build/boot time, so an existing deployment
will not pick them up on its own.

| Name | Value | Required |
|---|---|---|
| `JWT_SECRET` | the generated secret, 32+ characters | **Yes — login fails without it** |
| `VAPID_PUBLIC_KEY` | from the generated pair | Only for push notifications |
| `VAPID_PRIVATE_KEY` | from the generated pair | Only for push notifications |
| `VAPID_SUBJECT` | `mailto:you@example.com` | Optional |
| `CLOUD_SYNC_DISABLED` | `1` | Optional — turns off the GitHub Gist sync |
| `GIST_ID` | your own gist id | Optional — overrides the built-in default |
| `GITHUB_TOKEN` | a gist-scoped token | Only if you want Gist writes to work |

**CLI equivalent:**

```bash
vercel env add JWT_SECRET production
vercel env add VAPID_PUBLIC_KEY production
vercel env add VAPID_PRIVATE_KEY production
vercel --prod            # redeploy so the new values are picked up
```

---

## 3. Why each one matters

### `JWT_SECRET` — required

Session tokens are `base64url(payload) + "." + HMAC-SHA256(payload)` signed with
this value. It used to fall back to a string committed to this repository, which
meant anyone who read the source could forge a token for any household and any
role, including `SYSTEM_ADMIN`.

That fallback is gone. In production, if `JWT_SECRET` is missing, shorter than
32 characters, or still the old hardcoded value, the app **signs with a random
secret and disables sign-in**: `/api/auth` returns **503** with
`SESSION_SECRET_NOT_CONFIGURED` and a message saying what to do. The rest of the
deployment keeps serving, so you see the app and a clear reason rather than a
blank error page.

Outside production it falls back to a random per-process secret and warns —
sessions then stop working across restarts, which is intended.

> **Note:** an earlier version *threw* on boot instead. On serverless that runs
> at import time and kills the function before it exports its handler, so the
> platform reported `No exports found in module "/var/task/index.cjs"` and
> **every** route returned 500, including `/` and static files, with nothing
> pointing at the real cause. `test_boot_suite.js` now guards against that.

Changing `JWT_SECRET` later invalidates every existing session, so everyone has
to sign in again.

### VAPID keys — required for push notifications

Each browser's push subscription is bound to the public key it saw when it
subscribed. The keys were previously read from `data/vapid_keys.json` and
generated on the fly if that file was missing.

On Vercel the filesystem is read-only, so the write failed silently and **a new
key pair was generated on every cold start**. Every subscription made against the
previous key became invalid, and notifications stopped arriving with no error
anywhere. Setting the two variables pins one pair for the life of the deployment.

Where the keys came from is logged at boot:

```
[Push] VAPID keys loaded from environment.
```

If you instead see a warning that keys were generated in memory and could not be
saved, the variables are not set.

Changing the VAPID keys invalidates existing subscriptions; each device has to
re-enable notifications.

---

## 3b. Data persistence on Vercel — read this before relying on it

Vercel's filesystem is **read-only**, apart from `/tmp`, which is per-instance
and wiped when the function goes cold. `writeJsonFile` writes to `/tmp` first and
then tries the repo's `data/` directory, which fails silently on Vercel.

That leaves the GitHub Gist as the only durable store, and it has two limits:

1. **Gist writes need a token.** Without `GITHUB_TOKEN`, `patchToGist` returns
   early and nothing is saved anywhere durable. Every expense you add will
   survive only until that instance goes cold, then disappear.
2. **Only household `H001` syncs.** The cloud-sync calls in `api/_storage.js` are
   guarded by `cleanHId === 'H001'`. Any household created after that — `H002`
   and up — has **no durable storage on Vercel at all**.

So for a working Vercel deployment of H001:

```
GITHUB_TOKEN=<a token with the "gist" scope>
GIST_ID=<your own gist id>
```

Create the token at **GitHub → Settings → Developer settings → Personal access
tokens**, with only the `gist` scope. Create a **secret** gist seeded with the
five files the app actually syncs — copy each from your local `data/`:

| File | Contents |
|---|---|
| `expenses.json` | the H001 ledger |
| `config.json` | categories, staff, bills, budget, members |
| `staff_attendance.json` | attendance marks |
| `audit_log.json` | change history |
| `push_subscriptions.json` | device push registrations |

Then set `GIST_ID` to that gist's id (the hex string at the end of its URL).

### Seeding the gist in one command

Rather than creating each file by hand, build and upload the whole set straight
from `data/`:

```powershell
$env:GITHUB_TOKEN = "<token with the gist scope>"
$env:GIST_ID      = "<the id from your gist URL>"
node scripts/upload_gist_seed.js          # or: npm.cmd run seed-gist
```

Add `--dry-run` to see exactly what would be sent without uploading. The token is
read from the environment, never printed and never written to disk. It uploads
all seven files, then reads the gist back to confirm each one arrived and warns
if the gist is public.

### What the Gist holds: one file

Everything lives in a single JSON document, `gharkhata.json`. Adding a household
or a user never adds a Gist file.

```json
{
  "updatedAt": "2026-10-02T...",
  "users":      [ ... ],          // authoritative user directory
  "households": [ ... ],          // authoritative household directory
  "pushSubscriptions": [ ... ],
  "data": {
    "H001": {
      "users":      [ { "userId": "U001", "role": "OWNER" } ],
      "config":     { "masterConfig": {}, "categories": [], "budgets": [], "settings": {} },
      "expenses":   [ ... ],
      "attendance": { "staff": [], "records": [] },
      "auditLog":   [ ... ]
    },
    "H002": { "...the same five keys..." }
  }
}
```

`users`, `households` and `pushSubscriptions` stay at the root and remain the
source of truth. Everything household-specific is a slice under
`data.<householdId>`. `data.<id>.users` is a membership index derived from the
user directory on every write, so it cannot drift. **`data.SYSTEM` is never
created** - SYSTEM is a pseudo-household for the administrator account.

The stored shapes for `config` and `attendance` are organised, while the
application keeps reading and writing the shapes it always has. `api/_cloud_store.js`
translates between them, and the translation is exactly reversible:

| Stored | Native (what the app sees) |
|---|---|
| `config.masterConfig` | `staff`, `recurringBills`, `familyMembers`, `paymentMethods`, `splitRules`, and any field added later |
| `config.categories` | `categories` |
| `config.budgets` | `monthlyBudgetLimit` |
| `config.settings` | `householdCycle`, `householdId`, `updatedAt` |
| `attendance.staff[]` + `attendance.records[]` | attendance keyed by staff name, with `months` |

Writes are a read-modify-write of the whole document, **serialised** in process
and always awaited, so a serverless instance cannot be frozen before the write
lands and two concurrent writes cannot discard each other.

**Not in the Gist:** `vapid_keys.json` or anything secret - those are
environment variables. Receipts and backups are not synced.

Migration from the old seven-file layout runs once, is validated before it is
trusted, and never deletes or modifies the originals. To build and check the
document yourself before uploading:

```bash
node scripts/build_gharkhata.js <folder-of-old-gist-files> gharkhata.json
```

It refuses to write unless every record count matches and the records are
byte-identical to the source.

---|---|---|
| `expenses.json` | H001 | the ledger |
| `config.json` | H001 | categories, staff, bills, budget, members, split rules |
| `staff_attendance.json` | H001 | attendance marks |
| `audit_log.json` | H001 | change history |
| `<id>_expenses.json` | H002+ | that household's ledger |
| `<id>_config.json` | H002+ | that household's settings |
| `<id>_staff_attendance.json` | H002+ | that household's attendance |
| `<id>_audit_log.json` | H002+ | that household's history |
| `directory_users.json` | global | every user account (versioned snapshot) |
| `directory_households.json` | global | every household (versioned snapshot) |
| `push_subscriptions.json` | global | device push registrations |

**Deliberately not in the Gist:** `vapid_keys.json` and anything holding a
secret - those are environment variables. Receipts and backups are not synced
either; they stay local and do not survive a cold start on Vercel.

The two `directory_*` files are versioned snapshots rather than merged
record-by-record, so a deletion is never undone by a stale copy, and an empty
cloud snapshot can never wipe a populated directory.

`npm run seed-gist` builds and uploads this entire set from `data/`, including a
per-household set for every household it finds.

---|---|
| `directory_users.json` | every user account |
| `directory_households.json` | every household |

They are versioned snapshots rather than merged record-by-record, so a deletion
is never undone by a stale copy, and an empty cloud snapshot can never wipe a
populated directory.

**Still H001-only:** expenses, config and attendance for `H002` and above are
not synced. A second household can be created and will persist as a record, but
its ledger lives only in `/tmp`.

---

## 4. Checking it worked

1. Open the deployment and sign in. If sign-in returns **503** with
   `SESSION_SECRET_NOT_CONFIGURED`, `JWT_SECRET` is missing or invalid, or the
   deployment was not redeployed after adding it.
   Check quickly with:
   ```bash
   curl -s -X POST https://<your-app>/api/auth      -H 'Content-Type: application/json'      -d '{"action":"login","username":"x","password":"y"}'
   ```
   A 503 with that code means the variable still is not in effect; a 401 means
   the secret is fine and only the credentials were wrong.
2. Check the Vercel function logs for `[Push] VAPID keys loaded from environment.`
3. `GET /api/notifications?action=vapid_key` should return the same public key
   you set, and should keep returning it after the function goes cold.

---

## 5. Local development

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored.

```bash
cp .env.example .env
npm run keys        # paste the output into .env
npm start
```

For running the test suites you do not need any of this — `run_tests.sh` and
`run_audit.sh` set their own throwaway secret, point the app at a scratch copy of
`data/`, and disable cloud sync.

---

## 6. Before going live

- [ ] `JWT_SECRET` set, 32+ characters, generated randomly
- [ ] VAPID keys set, if you want push notifications
- [ ] Redeployed after adding the variables
- [ ] **Seeded passwords changed.** `admin`, `palash`, `pallavi` and `sanjay`
      still use the default `Admin@123` / `Household123!` pattern, which also
      appears in the test files
- [ ] **`GITHUB_TOKEN` and `GIST_ID` set**, or accept that nothing you enter on
      Vercel survives a cold start (see section 3b). The built-in default gist id
      is public
- [ ] Note that Tailwind is loaded from the Play CDN, which warns that it is not
      intended for production
