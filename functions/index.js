// Dunvant WMC staff alerts.
//
// Runs on Firebase when something is added to the database, and tells the
// right people straight away — even if nobody has the staff app open:
//   • New staff sign-up  → push + email to managers and Site Admins
//   • Incident reported  → push + email to managers and Site Admins
//   • Announcement posted → push to all staff
//   • Shift cover needed  → push to all other staff (and managers)
//   • Shift covered       → push to the person who asked, and managers
//   • Shift swap asked    → push to the colleague asked
//   • Swap accepted/declined → push to the person who asked
//
// Push goes to every device that turned notifications on in Staff Hub
// (saved in pushTokens). Email is the backup, sent from a Gmail account
// set up with two secrets (see README in this folder).
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
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

const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

// "2026-10-09" → "Fri 9 Oct"
function niceDate(iso) {
  if (!iso) return 'a shift';
  const d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}

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

exports.alertCoverNeeded = onDocumentCreated(
  { document: 'shiftCoverRequests/{id}' },
  async (event) => {
    const d = event.data ? event.data.data() : {};
    const who = d.name || 'Someone';
    const everyone = (await staffList()).filter((s) => !sameName(s.name, who));
    await both('Cover needed',
      () => sendPush(everyone.map((s) => s.uid), {
        title: d.urgent ? '🚨 Urgent: shift cover needed' : '🙋 Shift cover needed',
        body: `${who} needs cover on ${niceDate(d.date)}. Can you take it?`,
        page: 'shift-cover-request.html',
        tag: 'cover'
      })
    );
  }
);

exports.alertCoverTaken = onDocumentUpdated(
  { document: 'shiftCoverRequests/{id}' },
  async (event) => {
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};
    if (before.status === 'covered' || after.status !== 'covered') return;
    const staff = await staffList();
    const by = after.coveredBy || 'Someone';
    const asker = staff.filter((s) => sameName(s.name, after.name));
    const managers = staff.filter(isMgr).filter((m) => !sameName(m.name, by) && !asker.some((a) => a.uid === m.uid));
    const body = `${by} is covering ${after.name || 'the'}'s shift on ${niceDate(after.date)}.`;
    await both('Cover taken', () => Promise.all([
      sendPush(asker.map((s) => s.uid), { title: '✅ Your shift is covered', body, page: 'shift-cover-request.html', tag: 'cover' }),
      sendPush(managers.map((s) => s.uid), {
        title: '✅ Shift covered',
        body: body + (after.rotaUpdated ? ' Rota updated.' : ' Check the rota.'),
        page: 'shift-cover-requests-mgmt.html',
        tag: 'cover'
      })
    ]).then((n) => n[0] + n[1]));
  }
);

exports.alertSwapAsked = onDocumentCreated(
  { document: 'shiftSwaps/{id}' },
  async (event) => {
    const d = event.data ? event.data.data() : {};
    const colleague = (await staffList()).filter((s) => sameName(s.name, d.colleagueName));
    await both('Swap asked',
      () => sendPush(colleague.map((s) => s.uid), {
        title: `🔁 Swap request from ${d.requesterName || 'a colleague'}`,
        body: `${d.shiftLabel || 'A shift'}${d.message ? ' — ' + String(d.message).slice(0, 120) : ''}`,
        page: 'shift-swap.html',
        tag: 'swap'
      })
    );
  }
);

exports.alertSwapAnswered = onDocumentUpdated(
  { document: 'shiftSwaps/{id}' },
  async (event) => {
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};
    if (before.status === after.status || !['accepted', 'declined'].includes(after.status)) return;
    const asker = (await staffList()).filter((s) => sameName(s.name, after.requesterName));
    const ok = after.status === 'accepted';
    await both('Swap answered',
      () => sendPush(asker.map((s) => s.uid), {
        title: ok ? '✅ Shift swap accepted' : '❌ Shift swap declined',
        body: `${after.colleagueName || 'Your colleague'} ${ok ? 'accepted' : 'declined'}: ${after.shiftLabel || 'your swap'}`,
        page: 'shift-swap.html',
        tag: 'swap'
      })
    );
  }
);
