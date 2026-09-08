# 9Drive

Pools several Google Drive accounts into a single storage volume. Files are
routed to whichever account has room; the app stores only pointers and quota,
never the bytes.

A Next.js rebuild of [9drive-desktop](https://github.com/Vall-Here/9drive-desktop),
which was itself a fork of [zenhosta/9drive](https://github.com/zenhosta/9drive).

## One codebase

There is no separate backend. Everything — API, database access, Google OAuth,
the routing engine, and the UI — lives in this single Next.js app and deploys
to Vercel as one unit. The original project's Express server and Vite SPA were
merged; `src/app/api/*` replaces the former, `src/app/(app)/*` the latter.

## How it works

Three layers:

- **Virtual** — folders, files, and one merged quota bar. What you interact with.
- **Broker** — the Postgres database. Maps each file to `(account, providerFileId)`,
  holds AES-256-GCM encrypted OAuth tokens, a quota ledger, and the routing policy.
- **Physical** — your Google accounts. Each gets a `9drive/` folder at its Drive root.

Nine free accounts is 135 GB. Nothing hard-codes nine — the routing engine
works with any number.

### Where the bytes go

Uploads never pass through the server. `/api/uploads/init` picks a destination
account and asks Google to open a resumable session; the session URI it returns
carries its own authorisation. The browser then PUTs 8 MiB chunks straight to
`googleapis.com`, and `/api/uploads/complete` records the result.

That is what makes this deployable on Vercel, where a request body is capped at
4.5 MB and a function cannot stay open for the length of a 4 GB upload.

Downloads do pass through `/api/files/[id]/content`, which pipes the body and
forwards `Range` headers so video seeking produces a real 206. The response is
streamed, never buffered — a 4 GB file costs the same memory as a 4 KB one.

## Drive bays

The array is a chassis of nine bays. Bay 1 holds your first Google account;
each additional drive fills the next bay and extends the same volume, so the
total capacity on the dashboard grows as you install drives. Nothing else
about how you use the app changes.

Bays unlock in order — you fill bay 1, which opens bay 2. That keeps the
first-run screen to a single decision rather than nine identical empty slots.

### Credentials per bay

A single Google Cloud OAuth client can authorise all nine accounts, so
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on their own are enough — every
bay falls back to them.

Give a bay its own client by setting a numbered pair:

```bash
GOOGLE_CLIENT_ID_3="..."
GOOGLE_CLIENT_SECRET_3="..."
```

Bay 3 will then use that client for consent and for every token refresh
afterwards. Worth doing if you want each drive on a separate Google Cloud
project so they don't share an API quota. The bay rack marks any bay running on
the shared client.

Raise or lower the chassis size with `MAX_DRIVE_BAYS` (default 15, ceiling 64).

### Routing

`src/lib/server/routing/select-account.ts` is the heart of it. For each file:

1. Refresh any quota reading older than five minutes.
2. Filter to accounts with room, minus a configurable headroom slice.
3. If the target folder is pinned to an account, use it — a folder's contents
   never scatter. If that account is full, the upload fails rather than
   silently landing elsewhere.
4. Otherwise apply the policy: most free space, round robin, priority order,
   or fill-one-at-a-time.

A batch shares one reservation ledger, so five 3 GB files cannot each claim the
same 4 GB of free space.

## Browsing a drive

The dashboard presents the pool as one disk, but sometimes you need to see a
single physical drive as it actually is. Clicking a row on the Drives page
opens `/drives/[accountId]`, which lists that Google account live — folders,
files 9Drive uploaded, and files that predate 9Drive or arrived by other means,
all of it read from Google rather than from the File table.

Rows the pool already tracks are marked `POOLED`; everything else is simply
what is in the account. Files preview in place — video streams through the
same Range-forwarding content route, so seeking works without downloading the
file first. MKV, AVI and MOV say so instead of showing a dead player; browsers
decode MP4, WebM and Ogg and nothing else, and no transcoding happens here.

## The vault

`/vault` is a section for documents that should be neither readable by Google
nor visible in Drive. Those are two different problems and it solves both
separately.

**Hidden.** Files go to the account's `appDataFolder` — a per-app folder Google
keeps out of the Drive interface and away from every other app. Three
constraints come with it, and the app respects all three: its files cannot be
trashed, so deletion is immediate and permanent; nothing can be moved in or
out, so a file has to be uploaded straight into the vault; and it still
consumes quota, so vault files remain part of the volume's used total.

**Encrypted.** Hiding is a visibility measure, not a security one — a hidden
folder is invisible to a UI, not to anyone holding the account password. So
contents *and* filenames are AES-256-GCM ciphertext produced in the browser
before a byte is uploaded. The passphrase becomes a key via PBKDF2-SHA256 at
600,000 iterations over a per-user salt; each file gets its own random 256-bit
key, wrapped with that derived key, so the passphrase can change later without
re-encrypting anything. The name Google sees is an opaque id. A verifier blob
makes a wrong passphrase fail immediately rather than produce garbage.

The derived key is held in memory only — never localStorage, never a cookie —
so a refresh loses it and the passphrase is re-entered. It also clears after
fifteen idle minutes. There is no recovery mechanism, because any recovery
mechanism would defeat the encryption: forget the passphrase and the files are
gone. So are they if you remove 9Drive from a Google account's permissions,
which makes Google delete the app data folder outright. Both warnings appear
before the passphrase form, not after.

Uploads are capped at 100 MB. Encrypting in browser memory holds the whole
file at once, and past that the tab dies; streaming encryption is possible and
out of scope. Downloads fetch ciphertext and decrypt locally, so there is no
preview and no video player in the vault — GCM authenticates the whole message
and decryption needs every byte.

Secret files live in their own table, absent from `/api/files`, from search,
and from the Contents breakdown by construction rather than by a filter.

> The `drive.appdata` scope was added after the first drives were connected, so
> existing drives must be reconnected to grant it. The vault detects the
> missing scope and asks, rather than failing with a raw Google error.

## Setup

### 1. Database

Any Postgres works — Neon, Supabase, and Vercel Postgres are all fine.

```bash
cp .env.example .env
# fill in DATABASE_URL, then:
npx prisma db push
```

### 2. Secrets

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # TOKEN_ENCRYPTION_KEY
```

`TOKEN_ENCRYPTION_KEY` encrypts every stored OAuth token. Lose it and every
connected account has to be reconnected; change it and the same applies.

### 3. Google Cloud

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com/)
   and enable the **Google Drive API**.
2. Under **OAuth consent screen**, add these scopes:
   - `.../auth/drive`
   - `.../auth/drive.appdata`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
3. Under **Credentials → Create OAuth client ID → Web application**, set the
   authorised redirect URI to exactly:
   ```
   http://localhost:3000/api/auth/google/callback
   ```
   Add your production URL as a second entry when you deploy.
4. Copy the client ID and secret into `.env`.

While the consent screen is in Testing, add each Google account you plan to
connect under **Test users** — otherwise Google refuses the consent, and
refresh tokens expire after seven days.

### 4. Run

```bash
npm install
npm run dev
```

The first account created claims the instance. Set `ALLOWED_EMAIL` to keep it
that way.

## Deploying to Vercel

Push to a repo, import it, and set the same environment variables. Set
`APP_URL` to your production origin and add
`https://your-app.vercel.app/api/auth/google/callback` to the Google client's
redirect URIs.

The three streaming routes — `/api/files/[id]/content`,
`/api/drives/[accountId]/content/[fileId]` and `/api/vault/files/[id]/content`
— declare `maxDuration = 60`, which is the Hobby ceiling. Vercel *rejects the
deployment* if a function asks for more than the plan allows, so this is set
low deliberately. On Pro, raise all three to 300: at 60 seconds a download of
a very large file over a slow connection is cut off mid-stream.

## Notes on what changed from the original

Three things in the original were ported deliberately differently:

- **Uploads no longer make files world-writable.** The original ran
  `permissions.create({ role: 'writer', type: 'anyone' })` on every upload,
  leaving every file readable *and editable* by anyone holding its Drive file
  id, permanently and outside the app's own sharing. Files here stay private.
- **The whole file is no longer buffered in memory.** The original collected
  every chunk into an array before forwarding to Drive.
- **Refresh tokens rotate,** and a replayed token revokes the session family.

## The dashboard

Pooled storage is presented as **one disk**. The capacity bar is a single
continuous volume; each contributing drive is a segment within it, separated by
a hairline, so hovering identifies the physical drive without breaking the
illusion the product exists to create.

Below it, the bay rack reports each slot the way a real chassis would — status
LED, bay number, fill, and which one is currently taking writes.

File lists deliberately **do not** show which account holds what. The point of
pooling is that you shouldn't have to care. Every row carries an ⓘ instead:
hover or focus it to see the drive, bay number, size, and date.

## Layout

```
src/
  app/
    (auth)/login            sign-in
    (app)/                  panel, files, accounts, routing, drives, vault
    api/
      auth/                 register, login, logout, me, google/{url,callback}
      array/                the whole array in one reading
      accounts/             list, disconnect, sync
      storage/              summary, routing-policy
      uploads/              init, complete
      files/                list, detail, content stream
      folders/
      drives/               live per-drive browse and content stream
      vault/                state, setup, uploads, content, delete
  lib/
    server/
      routing/              the account selection engine
      bays.ts               slot allocation and chassis state
      providers/google.ts   Drive over plain fetch
      crypto.ts             AES-256-GCM envelopes, scrypt passwords
      download.ts           Range-forwarding stream, shared by both routes
      session.ts            cookie sessions with rotation
    client/
      uploader.ts           browser-to-Drive chunked upload
      vault.ts              browser-side vault crypto (Web Crypto only)
  components/
prisma/schema.prisma
```

## Not built yet

Public share links, trash auto-purge, drift reconciliation against Drive, S3
accounts, API keys, and the activity log all exist in the original and are
scoped out of this first build.



1
Create a project
Go to console.cloud.google.com and sign in with any Google account — it doesn't have to be one of the drives you'll connect. Click the project dropdown in the top bar, then "New Project". Name it something like "9drive" and create it. Make sure that project is selected in the dropdown before you continue; picking the wrong project is the most common way this goes sideways.
2
Enable the Google Drive API
In the left menu go to APIs & Services → Library, search for "Google Drive API", open it, and click Enable. Without this every Drive call returns a 403, even with valid credentials. You only need this one API — ignore the others.
3
Configure the consent screen
Go to Google Auth Platform (formerly "OAuth consent screen") and click Get started. Enter an app name and pick your own address as the support email. For Audience choose External — Internal only exists if you pay for Google Workspace. Add your email again as the developer contact, accept the policy, and create.
4
Add the Drive scopes
Under Data access, click "Add or remove scopes". You need four: .../auth/drive, .../auth/drive.appdata, .../auth/userinfo.email, and .../auth/userinfo.profile. The drive scope is filtered as "sensitive" so you may need to use the manual-entry box at the bottom to paste it; drive.appdata is non-sensitive and powers the vault. Save.
5
Create the OAuth client
Go to Clients → Create client. Set Application type to Web application and give it a name. Leave Authorized JavaScript origins empty. Under Authorized redirect URIs, add exactly: http://localhost:3000/api/auth/google/callback — this must match character for character, including the http and the port, or Google rejects the sign-in. Click Create.
6
Copy both values
Google shows the Client ID and Client Secret in a dialog. Copy both now — the secret cannot be viewed again, and losing it means creating a new client. Paste them into your .env as GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
7
Add your drives as test users
This is the step everyone skips. Go to Audience → Test users → Add users, and enter every Google account you plan to install into a bay — one line each, up to 100. A project in Testing mode refuses any account not on this list. Save.