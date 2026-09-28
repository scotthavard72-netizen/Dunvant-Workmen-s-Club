# Automated Firestore backups — setup

A GitHub Actions workflow (`.github/workflows/firestore-backup.yml`) runs
every day at 03:00 UTC and triggers Firestore's own built-in export, which
writes a full snapshot of every collection into Cloud Storage **inside your
own Firebase project** — no external repo or service involved.

This uses Google's native export/import feature, so restoring later is a
single command rather than replaying JSON files by hand.

⚠️ **This requires the Blaze (pay-as-you-go) plan.** Cloud Storage for
Firebase — and the export feature — isn't available on the free Spark plan.
For a club site this size, the actual monthly cost of storing nightly
backups should only be a few pence, but you do need a billing account
attached to the project. You won't be charged anything extra for Firestore
or Hosting usage just by being on Blaze — it only bills for what goes over
the (generous) free quota, same as now.

I can't upgrade the plan, create IAM roles, or generate keys myself — three
one-time steps below need you.

## 1. Upgrade to the Blaze plan

[Firebase Console](https://console.firebase.google.com/) → `dunvantwmc-36de5`
→ bottom-left **"Spark" plan badge** → **Upgrade** → **Blaze** → attach a
billing account (a card, even if you expect to stay within the free tier).

## 2. Get a service account key

Same project → gear icon → **Project settings** → **Service accounts** tab →
**Generate new private key**. This downloads a `.json` file.

## 3. Grant it the two extra permissions it needs

The key from step 2 already has admin rights over your Firestore *data*, but
running an *export* needs two extra project-level roles. In the
[Google Cloud Console IAM page](https://console.cloud.google.com/iam-admin/iam?project=dunvantwmc-36de5)
(same project):

- Find the service account (its email ends in
  `@dunvantwmc-36de5.iam.gserviceaccount.com`) → pencil/edit icon → **Add
  another role** → add both:
  - **Cloud Datastore Import Export Admin**
  - **Storage Admin**
- Save.

## 4. Add the secret to this repo

**Settings** → **Secrets and variables** → **Actions** → **New repository
secret** named `FIREBASE_SERVICE_ACCOUNT` → paste the *entire contents* of
the JSON file from step 2. Then delete that file from your computer.

## 5. Run it once to check it works

**Actions** tab (top of this repo) → **Firestore backup** workflow →
**Run workflow** → **Run workflow**. After a minute it should go green. To
see the result: [Cloud Storage browser](https://console.firebase.google.com/project/dunvantwmc-36de5/storage)
→ open the `firestore-backups/` folder → there should be a new dated
subfolder.

After that it runs on its own every night — nothing more to do unless
GitHub emails you that a scheduled run failed (usually a permission or
billing issue — re-check steps 1 and 3).

## Restoring from a backup

Each dated folder is a complete Firestore export in Google's native format.
To restore it:

```
gcloud firestore import gs://dunvantwmc-36de5.firebasestorage.app/firestore-backups/<the-dated-folder>/ --project=dunvantwmc-36de5
```

This **merges** the backup's documents back into whatever's currently in
Firestore (it doesn't wipe anything first) — run it from the
[Google Cloud Shell](https://console.cloud.google.com/) if you don't have
`gcloud` installed. Restoring should be a deliberate, reviewed action, so
this isn't wired up as a one-click button anywhere on the site.

## Keeping storage costs down (optional)

Nightly exports build up over time. To auto-delete old ones after, say, 60
days: Cloud Storage browser → bucket settings → **Lifecycle** → add a rule
that deletes objects under `firestore-backups/` older than 60 days. Not
required, just tidy.
