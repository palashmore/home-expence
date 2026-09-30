# Deploying to Vercel

Login will not work until `JWT_SECRET` is set, and push notifications will not
survive a cold start until the VAPID keys are set. Both are explained below.

---

## 1. Generate the secrets

Run this once, on your own machine, in the repo root:

```bash
npm run keys
```

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

That fallback is gone. The app now **refuses to start in production** if
`JWT_SECRET` is missing, is shorter than 32 characters, or is still the old
hardcoded value. Outside production it falls back to a random per-process secret
and warns — sessions then stop working across restarts, which is intended.

If a deployment crashes on boot with *"Refusing to start: JWT_SECRET is not
set"*, that is this check doing its job.

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

## 4. Checking it worked

1. Open the deployment and sign in. If login fails, `JWT_SECRET` is missing or
   the deployment was not redeployed after adding it.
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
- [ ] Decide on Gist sync: set `CLOUD_SYNC_DISABLED=1`, or set your own `GIST_ID`
      and `GITHUB_TOKEN`. The built-in default gist id is public
- [ ] Note that Tailwind is loaded from the Play CDN, which warns that it is not
      intended for production
