const CACHE_NAME = 'dunvant-site-v21';
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
  "expense-requests.html",
  "facebook-page-admin.html",
  "finances-accounts.html",
  "full-admin-dashboard.html",
  "funding-opportunities.html",
  "google-analytics.html",
  "hosting-status.html",
  "incident-report.html",
  "licensing-compliance.html",
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE).catch(() => {}))
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

  // Page loads (including a plain refresh): always try the network first,
  // so a normal refresh shows the latest content immediately — no more
  // needing a second refresh or a close-and-reopen. Only fall back to the
  // cached copy if there's no connection.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
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
      const fetchPromise = fetch(event.request).then((networkResponse) => {
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
