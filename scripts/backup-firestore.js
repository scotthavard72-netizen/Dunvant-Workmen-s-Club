// Exports every known Firestore collection to JSON files.
// Run in GitHub Actions with FIREBASE_SERVICE_ACCOUNT (full service-account
// JSON) provided as an env var. See .github/workflows/firestore-backup.yml.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const COLLECTIONS = [
  'staff',
  'rota',
  'staffChat',
  'activityLog',
  'shiftHandoverNotes',
  'tickets',
  'availability',
  'adminAccessLog',
  'bookingRequests',
  'bookings',
  'cashUps',
  'diaryEntries',
  'memberSuggestions',
  'rotaConfirmations',
  'shiftCoverRequests',
  'shiftSwaps',
  'shoutouts',
  'shows',
  'staffSuggestions'
];

async function main() {
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT env var is not set.');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(keyJson);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const outDir = process.argv[2] || 'backup-out';
  fs.mkdirSync(outDir, { recursive: true });

  const summary = {};
  for (const name of COLLECTIONS) {
    try {
      const snap = await db.collection(name).get();
      const docs = {};
      snap.forEach(doc => { docs[doc.id] = doc.data(); });
      fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(docs, null, 2));
      summary[name] = snap.size;
      console.log(`  ${name}: ${snap.size} docs`);
    } catch (e) {
      console.error(`  ${name}: FAILED — ${e.message}`);
      summary[name] = `error: ${e.message}`;
    }
  }

  fs.writeFileSync(
    path.join(outDir, '_summary.json'),
    JSON.stringify({ exportedAt: new Date().toISOString(), counts: summary }, null, 2)
  );

  console.log('Backup export complete:', outDir);
}

main().catch(e => {
  console.error('Backup failed:', e);
  process.exit(1);
});
