// Dunvant WMC staff alerts.
//
// Runs on Firebase when something is added to the database, and tells the
// right people straight away — even if nobody has the staff app open:
//   • New staff sign-up  → push + email to managers and Site Admins
//   • Incident reported  → push + email to managers and Site Admins
//   • Announcement posted → push to all staff
//
// Push goes to every device that turned notifications on in Staff Hub
// (saved in pushTokens). Email is the backup, sent from a Gmail account
// set up with two secrets (see README in this folder).
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();
const db = admin.firestore();

// The database lives in eur3 (Belgium/Netherlands), so run next to it.
setGlobalOptions({ region: 'europe-west1', maxInstances: 2 });

const GMAIL_USER = defineSecret('ALERT_GMAIL_USER');
const GMAIL_PASS = defineSecret('ALERT_GMAIL_APP_PASSWORD');
const SITE = 'https://dunvant-staff.web.app/';

const isMgr = (s) => (s.roles || []).some((r) => r === 'mgmt' || r === 'admin');

async function staffList() {
  const snap = await db.collection('staff').get();
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() || {}) }));
}

async function sendPush(uids, { title, body, page, tag }) {
  const wanted = new Set(uids);
  if (!wanted.size) return 0;
  const snap = await db.collection('pushTokens').get();
  const docs = snap.docs.filter((d) => wanted.has((d.data() || {}).uid));
  if (!docs.length) return 0;
  const res = await admin.messaging().sendEachForMulticast({
    tokens: docs.map((d) => d.id),
    data: { title, body: body || '', url: page || 'staff-hub.html', tag: tag || '' },
    webpush: { headers: { Urgency: 'high', TTL: '86400' } }
  });
  // Forget devices that have uninstalled / switched notifications off.
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' || code === 'messaging/invalid-argument') {
      dead.push(docs[i].ref.delete());
    }
  });
  await Promise.all(dead);
  return res.successCount;
}

async function sendEmail(toList, subject, text) {
  const user = (GMAIL_USER.value() || '').trim();
  const pass = (GMAIL_PASS.value() || '').replace(/\s+/g, '');
  const to = [...new Set(toList.filter(Boolean))];
  if (!user || !pass || !to.length) return false;
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transport.sendMail({ from: `"Dunvant WMC Staff" <${user}>`, to: user, bcc: to.join(','), subject, text });
  return true;
}

// Push and email are independent: if one fails the other still goes.
async function both(label, pushFn, emailFn) {
  const [p, e] = await Promise.allSettled([pushFn(), emailFn ? emailFn() : Promise.resolve(null)]);
  if (p.status === 'rejected') logger.error(`${label}: push failed`, p.reason);
  else logger.info(`${label}: push sent to ${p.value} device(s)`);
  if (e.status === 'rejected') logger.error(`${label}: email failed`, e.reason);
  else if (emailFn) logger.info(`${label}: email ${e.value ? 'sent' : 'skipped (no Gmail set up or no addresses)'}`);
}

exports.alertNewSignup = onDocumentCreated(
  { document: 'staffSignupRequests/{uid}', secrets: [GMAIL_USER, GMAIL_PASS] },
  async (event) => {
    const d = event.data ? event.data.data() : {};
    const name = d.name || 'Someone';
    const managers = (await staffList()).filter(isMgr);
    await both('Sign-up',
      () => sendPush(managers.map((m) => m.uid), {
        title: 'New staff sign-up', body: `${name} wants access — tap to approve.`, page: 'staff-signups.html', tag: 'signups'
      }),
      () => sendEmail(managers.map((m) => m.email), `New staff sign-up: ${name}`,
        `${name} (${d.email || 'no email given'}) has signed up for the Dunvant WMC staff app.\n\n` +
        `Approve or decline them here:\n${SITE}staff-signups\n\n` +
        `They can't see anything until a manager or Site Admin approves them.`)
    );
  }
);

exports.alertNewIncident = onDocumentCreated(
  { document: 'incidents/{id}', secrets: [GMAIL_USER, GMAIL_PASS] },
  async (event) => {
    const d = event.data ? event.data.data() : {};
    const where = d.where || 'Somewhere in the club';
    const by = d.reportedByName || 'a member of staff';
    const managers = (await staffList()).filter(isMgr).filter((m) => m.uid !== d.reportedByUid);
    // Details (names, injuries) stay on the report page, not in alerts.
    await both('Incident',
      () => sendPush(managers.map((m) => m.uid), {
        title: '⚠️ Incident reported', body: `${where} — reported by ${by}. Tap to read.`, page: 'incident-report.html', tag: 'incident'
      }),
      () => sendEmail(managers.map((m) => m.email), `Incident reported — ${where}`,
        `${by} has filed an accident / incident report (${where}).\n\n` +
        `Read it and mark it reviewed here:\n${SITE}incident-report`)
    );
  }
);

exports.alertAnnouncement = onDocumentCreated(
  { document: 'staffChat/{id}' },
  async (event) => {
    const d = event.data ? event.data.data() : {};
    if (d.channel !== 'announcements') return;
    const everyone = (await staffList()).filter((s) => s.uid !== d.authorUid);
    await both('Announcement',
      () => sendPush(everyone.map((s) => s.uid), {
        title: `📢 Announcement from ${d.authorName || 'Someone'}`,
        body: (d.text || '').slice(0, 180),
        page: 'staff-chat.html?channel=announcements',
        tag: 'announcement'
      })
    );
  }
);
