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
//   • Rota published      → push to every member of staff, listing their shifts
//   • 6pm every evening   → push a reminder to anyone working tomorrow
//   • Function room request → push + email to managers
//   • Ticket / issue report → push to Site Admins and managers
//   • Member suggestion   → push to committee, managers and Site Admins
//   • Cash-up out by £5+  → push + email to managers
//   • Rota not confirmed after a day → one nudge to those who haven't, list to managers
//   • Monday 9am          → summary email of the week to Site Admins
//
// Push goes to every device that turned notifications on in Staff Hub
// (saved in pushTokens). Email is the backup, sent from a Gmail account
// set up with two secrets (see README in this folder).
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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

// ---------------------------------------------------------------------------
// Login management, called from the staff app (a web page can't delete
// someone else's login itself — only the server can).
// ---------------------------------------------------------------------------
const { onCall, HttpsError } = require('firebase-functions/v2/https');

async function rolesOf(uid) {
  if (!uid) return [];
  const doc = await db.collection('staff').doc(uid).get();
  return doc.exists ? (doc.data().roles || []) : [];
}

async function removeEverything(uid) {
  // Their login first, then everything that points at them.
  try { await admin.auth().deleteUser(uid); }
  catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  const tokens = await db.collection('pushTokens').where('uid', '==', uid).get();
  const batch = db.batch();
  batch.delete(db.collection('staff').doc(uid));
  batch.delete(db.collection('staffPins').doc(uid));
  batch.delete(db.collection('staffSignupRequests').doc(uid));
  tokens.forEach((t) => batch.delete(t.ref));
  await batch.commit();
}

// Site Admin: every login, and whether it has staff access.
exports.listLogins = onCall(async (request) => {
  if (!(await rolesOf(request.auth && request.auth.uid)).includes('admin')) {
    throw new HttpsError('permission-denied', 'Only a Site Admin can do this.');
  }
  const [users, staff, requests] = await Promise.all([
    admin.auth().listUsers(1000),
    db.collection('staff').get(),
    db.collection('staffSignupRequests').get()
  ]);
  const staffIds = new Set(staff.docs.map((d) => d.id));
  const requestIds = new Set(requests.docs.map((d) => d.id));
  return users.users.map((u) => ({
    uid: u.uid,
    email: u.email || '',
    created: u.metadata.creationTime || '',
    lastSignIn: u.metadata.lastSignInTime || '',
    hasStaffAccess: staffIds.has(u.uid),
    awaitingApproval: requestIds.has(u.uid)
  }));
});

// Site Admin: delete someone completely (login, staff record, PIN, alerts).
exports.deleteLogin = onCall(async (request) => {
  const me = request.auth && request.auth.uid;
  if (!(await rolesOf(me)).includes('admin')) {
    throw new HttpsError('permission-denied', 'Only a Site Admin can delete logins.');
  }
  const uid = String((request.data && request.data.uid) || '');
  if (!uid) throw new HttpsError('invalid-argument', 'No account given.');
  if (uid === me) throw new HttpsError('failed-precondition', "You can't delete your own login.");
  await removeEverything(uid);
  logger.info('Login deleted', { by: me, uid });
  return { ok: true };
});

// Managers and Site Admins: declining a sign-up also removes the login it
// made — but only for people who were never given staff access.
exports.declineSignup = onCall(async (request) => {
  const me = request.auth && request.auth.uid;
  const roles = await rolesOf(me);
  if (!roles.includes('admin') && !roles.includes('mgmt')) {
    throw new HttpsError('permission-denied', 'Only a manager or Site Admin can do this.');
  }
  const uid = String((request.data && request.data.uid) || '');
  if (!uid) throw new HttpsError('invalid-argument', 'No account given.');
  if ((await db.collection('staff').doc(uid).get()).exists) {
    throw new HttpsError('failed-precondition', 'That person already has staff access.');
  }
  await removeEverything(uid);
  logger.info('Sign-up declined and login deleted', { by: me, uid });
  return { ok: true };
});

// "18:00" → "6pm", "11:30" → "11:30am", "23:59" → "midnight"
function niceTime(t) {
  if (!t) return '';
  if (t === '23:59') return 'midnight';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ':' + String(m).padStart(2, '0') : ''}${suffix}`;
}
const shiftLabel = (s) => `${s.d || niceDate(s.fd)} ${niceTime(s.st)}–${niceTime(s.et)}${s.r === 'K' ? ' 🔑' : ''}`;

// Today's date in the UK, as "2026-10-11"
function ukDate(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

exports.alertRotaPublished = onDocumentWritten(
  { document: 'rota/{doc}' },
  async (event) => {
    if (event.params.doc !== 'current') return;
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    // Only a fresh publish — not an unpublish, and not a cover/swap name change.
    if (!after || !after.publishedTimestamp) return;
    if (before && before.publishedTimestamp === after.publishedTimestamp) return;
    const shifts = after.shifts || [];
    const staff = await staffList();
    let sent = 0;
    await Promise.all(staff.map(async (person) => {
      const mine = shifts.filter((s) => sameName(s.n, person.name)).sort((a, b) => (a.fd || '').localeCompare(b.fd || ''));
      const body = mine.length
        ? `You're on ${mine.length === 1 ? '1 shift' : mine.length + ' shifts'}: ${mine.map(shiftLabel).join(', ')}`
        : "You're not on this week's rota.";
      try {
        sent += await sendPush([person.uid], { title: '📅 New rota is out', body, page: 'current-rota.html', tag: 'rota' });
      } catch (e) { logger.error('Rota push failed for ' + person.uid, e); }
    }));
    logger.info(`Rota published: push sent to ${sent} device(s)`);
  }
);

exports.shiftReminders = onSchedule(
  { schedule: '0 18 * * *', timeZone: 'Europe/London' },
  async () => {
    const doc = await db.collection('rota').doc('current').get();
    if (!doc.exists) return;
    const tomorrow = ukDate(1);
    const shifts = (doc.data().shifts || []).filter((s) => s.fd === tomorrow && s.n);
    if (!shifts.length) { logger.info('Shift reminders: nobody on tomorrow'); return; }
    const staff = await staffList();
    let sent = 0;
    for (const person of staff) {
      const mine = shifts.filter((s) => sameName(s.n, person.name)).sort((a, b) => (a.st || '').localeCompare(b.st || ''));
      if (!mine.length) continue;
      try {
        sent += await sendPush([person.uid], {
          title: '⏰ Shift tomorrow',
          body: `You're on tomorrow, ${mine.map((s) => `${niceTime(s.st)}–${niceTime(s.et)}${s.r === 'K' ? ' (Keyholder)' : ''}`).join(' and ')}.`,
          page: 'current-rota.html',
          tag: 'shift-reminder'
        });
      } catch (e) { logger.error('Reminder push failed for ' + person.uid, e); }
    }
    logger.info(`Shift reminders: push sent to ${sent} device(s)`);
  }
);

// ---------------------------------------------------------------------------
// More alerts
// ---------------------------------------------------------------------------
const hasRole = (s, roles) => (s.roles || []).some((r) => roles.includes(r));
const money = (n) => '£' + Math.abs(Number(n) || 0).toFixed(2);
const CASH_ALERT_OVER = 5; // pounds either way

exports.alertBookingRequest = onDocumentCreated(
  { document: 'bookingRequests/{id}', secrets: [GMAIL_USER, GMAIL_PASS] },
  async (event) => {
    const d = event.data ? event.data.data() : {};
    const managers = (await staffList()).filter(isMgr);
    const what = d.eventName || 'A function room booking';
    const when = `${niceDate(d.date)}${d.startTime ? ', ' + niceTime(d.startTime) : ''}${d.endTime ? '–' + niceTime(d.endTime) : ''}`;
    await both('Booking request',
      () => sendPush(managers.map((m) => m.uid), {
        title: '🎉 New booking request', body: `${what} — ${when}${d.guests ? ', ~' + d.guests + ' guests' : ''}. Tap to approve.`, page: 'bookings.html', tag: 'pendingBookings'
      }),
      () => sendEmail(managers.map((m) => m.email), `Booking request: ${what} (${when})`,
        `A new function room request has come in from the website.\n\n` +
        `Event: ${what}\nWhen: ${when}\nGuests: ${d.guests || 'not given'}\n` +
        `Contact: ${d.contactName || ''} ${d.contactPhone || ''} ${d.contactEmail || ''}\n` +
        (d.notes ? `Notes: ${d.notes}\n` : '') +
        `\nApprove or decline it here:\n${SITE}bookings`)
    );
  }
);

exports.alertNewTicket = onDocumentCreated(
  { document: 'tickets/{id}' },
  async (event) => {
    const d = event.data ? event.data.data() : {};
    const isPublic = d.type === 'public';
    const people = (await staffList())
      .filter((s) => hasRole(s, ['admin', 'mgmt']))
      .filter((s) => isPublic || !sameName(s.name, d.authorName));
    await both('Ticket',
      () => sendPush(people.map((s) => s.uid), {
        title: isPublic ? '📮 Issue reported on the website' : `🔧 New ticket from ${d.authorName || 'a member of staff'}`,
        body: (d.description || '').slice(0, 140),
        page: 'tickets.html',
        tag: 'tickets'
      })
    );
  }
);

exports.alertMemberSuggestion = onDocumentCreated(
  { document: 'memberSuggestions/{id}' },
  async (event) => {
    const d = event.data ? event.data.data() : {};
    const people = (await staffList()).filter((s) => hasRole(s, ['committee', 'admin', 'mgmt']));
    await both('Member suggestion',
      () => sendPush(people.map((s) => s.uid), {
        title: '💡 New member suggestion',
        body: (d.text || '').slice(0, 140),
        page: 'member-suggestions-review.html',
        tag: 'memberSuggestions'
      })
    );
  }
);

exports.alertCashUp = onDocumentCreated(
  { document: 'cashUps/{id}', secrets: [GMAIL_USER, GMAIL_PASS] },
  async (event) => {
    const d = event.data ? event.data.data() : {};
    if (d.tillReading === undefined || d.tillReading === null || isNaN(Number(d.tillReading))) return;
    const diff = Number(d.cashCounted || 0) - Number(d.floatKept || 0) - Number(d.tillReading);
    if (Math.abs(diff) < CASH_ALERT_OVER) return;
    const word = diff > 0 ? 'over' : 'short';
    const who = d.keyholderName || 'Someone';
    const managers = (await staffList()).filter(isMgr).filter((m) => !sameName(m.name, who));
    await both('Cash-up',
      () => sendPush(managers.map((m) => m.uid), {
        title: `💷 Till ${word} ${money(diff)}`, body: `${who}'s cash-up for ${niceDate(d.date)}${d.notes ? ' — "' + String(d.notes).slice(0, 80) + '"' : ''}`, page: 'cash-up-log.html', tag: 'cashup'
      }),
      () => sendEmail(managers.map((m) => m.email), `Till ${word} ${money(diff)} — ${niceDate(d.date)}`,
        `${who}'s cash-up for ${niceDate(d.date)} is ${word} by ${money(diff)}.\n\n` +
        `Cash counted: ${money(d.cashCounted)}\nFloat kept: ${money(d.floatKept)}\nTill reading: ${money(d.tillReading)}\n` +
        (d.notes ? `Notes: ${d.notes}\n` : '') + `\nSee the cash-up log:\n${SITE}cash-up-log`)
    );
  }
);

// Once per publish, a day later: nudge anyone on the rota who hasn't tapped
// "I've seen the rota", and tell managers who's still missing.
exports.rotaChaser = onSchedule(
  { schedule: '15 * * * *', timeZone: 'Europe/London' },
  async () => {
    const doc = await db.collection('rota').doc('current').get();
    if (!doc.exists) return;
    const rota = doc.data();
    const ts = rota.publishedTimestamp;
    if (!ts) return;
    const ageH = (Date.now() - new Date(ts).getTime()) / 3600000;
    if (!(ageH >= 24 && ageH < 24 * 6)) return;
    const stateRef = db.collection('serverState').doc('rotaChaser');
    const state = await stateRef.get();
    if (state.exists && state.data().publishedTimestamp === ts) return; // already chased this one
    await stateRef.set({ publishedTimestamp: ts, chasedAtMs: Date.now() });

    const names = [...new Set((rota.shifts || []).map((s) => s.n).filter(Boolean))];
    const confirmed = (await db.collection('rotaConfirmations').get()).docs
      .map((c) => c.data()).filter((c) => c.publishedTimestamp === ts);
    const staff = await staffList();
    const missing = names.filter((n) => !confirmed.some((c) => sameName(c.name, n)));
    if (!missing.length) { logger.info('Rota chaser: everyone has confirmed'); return; }
    const missingStaff = staff.filter((s) => missing.some((n) => sameName(n, s.name)));
    await both('Rota chaser', () => Promise.all([
      sendPush(missingStaff.map((s) => s.uid), {
        title: '👀 Have you seen the rota?', body: "Check your shifts and tap “I've seen the rota” so the managers know.", page: 'current-rota.html', tag: 'rota'
      }),
      sendPush(staff.filter(isMgr).map((s) => s.uid), {
        title: `⏳ ${missing.length} not confirmed the rota`, body: missing.join(', '), page: 'weekly-rota-builder.html', tag: 'rota-confirm'
      })
    ]).then((n) => n[0] + n[1]));
  }
);

// Monday 9am: one email to Site Admins with the week at a glance.
async function buildWeeklySummary(nowMs) {
  const weekAgo = nowMs - 7 * 86400000;
  const today = new Date(nowMs).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const in7 = new Date(nowMs + 7 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const get = async (c) => (await db.collection(c).get()).docs.map((d) => d.data());
  const [log, incidents, covers, requests, bookings, cashUps, tickets, suggestions, rotaDoc, confirms, pending] = await Promise.all([
    get('activityLog'), get('incidents'), get('shiftCoverRequests'), get('bookingRequests'), get('bookings'),
    get('cashUps'), get('tickets'), get('memberSuggestions'), db.collection('rota').doc('current').get(), get('rotaConfirmations'), get('staffSignupRequests')
  ]);
  const recent = (arr, key) => arr.filter((x) => (x[key || 'createdAtMs'] || 0) >= weekAgo);
  const lines = [];
  const section = (title, items) => { lines.push(`\n${title}`); lines.push(items.length ? items.map((i) => '  • ' + i).join('\n') : '  • None'); };

  section('New staff approved', recent(log).filter((l) => l.action === 'New Staff Approved').map((l) => l.detail || 'someone'));
  if (pending.length) section('Still waiting for approval', pending.map((p) => p.name || p.email || 'someone'));
  const inc = recent(incidents);
  section('Incidents', inc.map((i) => `${i.where || 'Somewhere'} — ${i.reportedByName || 'staff'}${i.status === 'reviewed' ? ' (reviewed)' : ' (NOT reviewed yet)'}`));
  const cov = recent(covers);
  section('Shift cover requests', cov.map((c) => `${c.name} on ${niceDate(c.date)} — ${c.status === 'covered' ? 'covered by ' + (c.coveredBy || 'someone') : c.status === 'cancelled' ? 'cancelled' : 'STILL OPEN'}`));
  section('Booking requests waiting for a reply', requests.filter((r) => (r.status || 'pending') === 'pending').map((r) => `${r.eventName || 'Booking'} — ${niceDate(r.date)}`));
  section('Bookings in the next 7 days', bookings.filter((b) => b.date >= today && b.date <= in7).sort((a, b) => a.date.localeCompare(b.date)).map((b) => `${niceDate(b.date)} — ${b.eventName || 'Booking'}`));
  const cash = recent(cashUps).filter((c) => c.tillReading !== undefined && c.tillReading !== null)
    .map((c) => ({ ...c, diff: Number(c.cashCounted || 0) - Number(c.floatKept || 0) - Number(c.tillReading) }))
    .filter((c) => Math.abs(c.diff) >= 0.01);
  section('Cash-ups that didn’t match the till', cash.map((c) => `${niceDate(c.date)} — ${c.keyholderName || 'someone'}: ${c.diff > 0 ? 'over' : 'short'} ${money(c.diff)}`));
  if (rotaDoc.exists && rotaDoc.data().publishedTimestamp) {
    const r = rotaDoc.data();
    const names = [...new Set((r.shifts || []).map((s) => s.n).filter(Boolean))];
    const done = confirms.filter((c) => c.publishedTimestamp === r.publishedTimestamp);
    section(`Not confirmed the current rota (published ${r.publishedDate || ''})`, names.filter((n) => !done.some((c) => sameName(c.name, n))));
  }
  section('Open tickets', tickets.filter((t) => (t.status || 'open') !== 'resolved').map((t) => `${t.type === 'public' ? '[Public] ' : ''}${(t.description || '').slice(0, 80)}`));
  section('New member suggestions', recent(suggestions).map((m) => (m.text || '').slice(0, 100)));
  return `Here's the week at Dunvant WMC (last 7 days).\n` + lines.join('\n') + `\n\nStaff Hub: ${SITE}staff-hub`;
}
if (process.env.DUNVANT_TEST) module.exports._buildWeeklySummary = buildWeeklySummary; // tests only

exports.weeklySummary = onSchedule(
  { schedule: '0 9 * * 1', timeZone: 'Europe/London', secrets: [GMAIL_USER, GMAIL_PASS] },
  async () => {
    const admins = (await staffList()).filter((s) => hasRole(s, ['admin']));
    const text = await buildWeeklySummary(Date.now());
    const sent = await sendEmail(admins.map((a) => a.email), `Dunvant WMC — your week (${niceDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }))})`, text);
    logger.info(`Weekly summary: email ${sent ? 'sent' : 'skipped'}`);
  }
);
