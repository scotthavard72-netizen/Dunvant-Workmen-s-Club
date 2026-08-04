const CACHE_NAME = 'dunvant-site-v3';
const URLS_TO_CACHE = [
  "agm-planning.html",
  "alarm-fault.html",
  "backup-reminder.html",
  "closing-checklist.html",
  "club-constitution.html",
  "club-website.html",
  "content-quick-edit.html",
  "current-rota.html",
  "edit-site-files.html",
  "entertainment-tracker.html",
  "expense-requests.html",
  "facebook-page-admin.html",
  "finances-accounts.html",
  "fire-safety.html",
  "first-aid.html",
  "full-admin-dashboard.html",
  "funding-opportunities.html",
  "google-analytics.html",
  "hosting-status.html",
  "incident-report.html",
  "licensing-compliance.html",
  "manage-staff-logins.html",
  "member-suggestions.html",
  "membership-numbers.html",
  "membership-renewal.html",
  "membership-till-system.html",
  "new-starter-checklist.html",
  "out-of-hours-contact.html",
  "overall-changelog.html",
  "pending-bookings.html",
  "price-list.html",
  "publish-file-update.html",
  "shift-cover-form-responses.html",
  "shift-cover-request.html",
  "shift-cover-requests-mgmt.html",
  "site-changelog.html",
  "site-todos.html",
  "staff-area.html",
  "staff-faq.html",
  "staff-rota.html",
  "supplier-contacts.html",
  "this-weeks-rota.html",
  "tickets.html",
  "till-card-lookup.html",
  "till-discrepancy.html",
  "weather-closure.html",
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
