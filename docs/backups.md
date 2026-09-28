# Automated Firestore backups

**Status: set up and running.** A GitHub Actions workflow
(`.github/workflows/firestore-backup.yml`) runs every day at 03:00 UTC and
triggers Firestore's own built-in export, which writes a full snapshot of
every collection into a Cloud Storage bucket **inside the Firebase
project** — no external repo or service involved.

- Bucket: `dunvantwmc-36de5-firestore-backups`, region `europe-west2`
  (London). It has to be in an EU region because the Firestore database
  itself is EU-based — a bucket in the US region (like the project's
  default Storage bucket) is rejected by the export with a location-mismatch
  error.
- Auth: the `firebase-adminsdk-fbsvc@dunvantwmc-36de5.iam.gserviceaccount.com`
  service account, with two extra IAM roles beyond its normal Firestore
  access — **Cloud Datastore Import Export Admin** and **Storage Admin** —
  granted at the project level in
  [Google Cloud IAM](https://console.cloud.google.com/iam-admin/iam?project=dunvantwmc-36de5).
  Its key is stored as the `FIREBASE_SERVICE_ACCOUNT` secret on this repo
  (Settings → Secrets and variables → Actions).
- Requires the **Blaze** (pay-as-you-go) plan, already active on this
  project — Cloud Storage for Firebase isn't available on the free Spark
  plan.

Nothing more to do day-to-day. If GitHub emails that a scheduled run failed,
open **Actions** → **Firestore backup** → the failed run → the red step, and
check:

- Has the `FIREBASE_SERVICE_ACCOUNT` secret expired or been rotated? Re-issue
  a key (Firebase Console → Project settings → Service accounts → Generate
  new private key) and update the secret.
- Do the two IAM roles above still show on the service account in Cloud
  Console → IAM?
- Is the project still on the Blaze plan?

## Restoring from a backup

Each dated folder under `gs://dunvantwmc-36de5-firestore-backups/firestore-backups/`
is a complete Firestore export in Google's native format. To restore one:

```
gcloud firestore import gs://dunvantwmc-36de5-firestore-backups/firestore-backups/<the-dated-folder>/ --project=dunvantwmc-36de5
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
