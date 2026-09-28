# Automated Firestore backups — setup

A GitHub Actions workflow (`.github/workflows/firestore-backup.yml`) runs
every day at 03:00 UTC, exports every Firestore collection to JSON, and
pushes it into a **separate private repo** you create (this site's repo is
public, so backups can't live here).

You need to do four things once, in the GitHub UI. I can't do any of these
myself — they involve creating credentials and a new repo.

## 1. Create the private backup repo

On GitHub: **New repository** → name it something like `dunvant-wmc-backups`
→ set visibility to **Private** → tick "Add a README" → Create.

Note the full name, e.g. `scotthavard72-netizen/dunvant-wmc-backups` — you'll
need it in step 4.

## 2. Get a Firebase service account key

In the [Firebase Console](https://console.firebase.google.com/) →
`dunvantwmc-36de5` project → gear icon → **Project settings** → **Service
accounts** tab → **Generate new private key**. This downloads a `.json`
file — keep it safe, and delete it once step 3 is done.

## 3. Add secrets to this repo

In this repo: **Settings** → **Secrets and variables** → **Actions**:

- **New repository secret** named `FIREBASE_SERVICE_ACCOUNT` — paste the
  *entire contents* of the JSON file from step 2.
- **New repository secret** named `BACKUP_REPO_TOKEN` — a GitHub personal
  access token that can push to the backup repo. Easiest: go to
  [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new),
  set **Repository access** to only the backup repo from step 1, and under
  **Permissions** grant **Contents: Read and write**. Copy the token value
  in as the secret.

Then, still under **Secrets and variables** → **Actions**, switch to the
**Variables** tab:

- **New repository variable** named `BACKUP_REPO` — the full name from
  step 1, e.g. `scotthavard72-netizen/dunvant-wmc-backups`.

## 4. Run it once to check it works

**Actions** tab (top of this repo) → **Firestore backup** workflow →
**Run workflow** → **Run workflow**. After a minute or two it should go
green, and the backup repo will have a new dated folder full of `.json`
files (one per collection, plus `_summary.json` with row counts).

After that it just runs on its own every night — nothing more to do unless
GitHub ever emails you that a scheduled run failed (usually means a secret
expired or was rotated).

## Restoring from a backup

Each dated folder has one JSON file per collection: `{ "docId": { ...fields
... } }`. To restore a collection, write a small script with `firebase-admin`
that reads the file and calls `.doc(id).set(data)` for each entry. This
isn't automated on purpose — restoring should be a deliberate, reviewed
action, not a one-click button.

## Security notes

- The backup repo must stay **private** — it contains real staff and member
  data (chat messages, cash-up figures, suggestions, etc).
- Delete the downloaded service-account JSON file from your computer once
  it's saved as a secret.
- If the token or key ever leaks, revoke it immediately (Firebase Console
  for the service account, GitHub token settings for the PAT) and generate
  fresh ones.
