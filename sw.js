const CACHE_NAME = 'dunvant-site-v26';
const URLS_TO_CACHE = [
  "agm-planning.html",
  "backup-reminder.html",
  "bookings.html",
  "cash-up-log.html",
  "closing-checklist.html",
  "club-constitution.html",
  "current-rota.html",
  "edit-site-content.html",
  "emergency-procedures.html",
  "entertainment-tracker.html",
  "facebook-page-admin.html",
  "finances-accounts.html",
  "full-admin-dashboard.html",
  "funding-opportunities.html",
  "google-analytics.html",
  "hosting-status.html",
  "incident-report.html",
  "manage-staff-logins.html",
  "member-suggestions-review.html",
  "membership-numbers.html",
  "membership-till-system.html",
  "new-starter-checklist.html",
  "price-list.html",
  "qr-code-generator.html",
  "shift-cover-request.html",
  "shift-cover-requests-mgmt.html",
  "shift-handover-notes.html",
  "shift-swap.html",
  "site-status.html",
  "staff-area.html",
  "staff-availability.html",
  "staff-chat.html",
  "staff-directory.html",
  "staff-faq.html",
  "staff-hub.html",
  "staff-rota.html",
  "staff-signups.html",
  "submit-ticket.html",
  "supplier-contacts.html",
  "team-activity.html",
  "this-weeks-rota.html",
  "tickets.html",
  "till-card-lookup.html",
  "weekly-rota-builder.html",
  "whats-on-this-week.html"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE.map((u) => new Request(u, { cache: 'reload' }))).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Deploy stamp checked by the admin update banner — must never come from cache.
  if (new URL(event.request.url).pathname.endsWith('/version.json')) return;

  // Page loads (including a plain refresh): always try the network first,
  // so a normal refresh shows the latest content immediately — no more
  // needing a second refresh or a close-and-reopen. Only fall back to the
  // cached copy if there's no connection.
  if (event.request.mode === 'navigate') {
    // cache: 'no-cache' makes the browser check with the server every time,
    // instead of reusing a copy it saved earlier.
    event.respondWith(
      fetch(new Request(event.request, { cache: 'no-cache' }))
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else (scripts, styles, etc.): serve from cache instantly for
  // speed, and refresh the cache in the background for next time.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(new Request(event.request, { cache: 'no-cache' })).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Push alerts from the server (functions/index.js via Firebase Cloud
// Messaging) — these arrive even when the staff app is closed. FCM wraps
// our fields in "data"; plain web-push payloads are handled too.
self.addEventListener('push', (event) => {
  let p = {};
  try {
    const j = event.data ? event.data.json() : {};
    p = j.data || j.notification || j;
  } catch (e) {
    p = { body: event.data ? event.data.text() : '' };
  }
  const opts = {
    body: p.body || '',
    icon: 'assets/dw-staff-icon-192.png',
    badge: 'assets/dw-staff-icon-192.png',
    data: { url: p.url || 'staff-hub.html' }
  };
  if (p.tag) opts.tag = p.tag;
  event.waitUntil(self.registration.showNotification(p.title || 'Dunvant WMC Staff', opts));
});

// Tapping a staff notification (shown via showStaffNotification in
// staff-notify.js) opens the page it's about — reusing an open Staff tab or
// installed app window if there is one, rather than opening a second copy.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || 'staff-hub.html';
  const target = new URL(path, self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => 'focus' in w);
      if (existing) {
        return existing.focus().then((w) => (w && 'navigate' in w) ? w.navigate(target) : w);
      }
      return self.clients.openWindow(target);
    })
  );
});
