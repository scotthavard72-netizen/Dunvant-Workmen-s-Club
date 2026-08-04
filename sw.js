const CACHE_NAME = 'dunvant-staff-v1';
const URLS_TO_CACHE = [
  "admin/backup-reminder.html",
  "admin/content-quick-edit.html",
  "admin/edit-site-files.html",
  "admin/facebook-page-admin.html",
  "admin/full-admin-dashboard.html",
  "admin/google-analytics.html",
  "admin/hosting-status.html",
  "admin/manage-staff-logins.html",
  "admin/overall-changelog.html",
  "admin/shift-cover-form-responses.html",
  "admin/site-changelog.html",
  "admin/site-todos.html",
  "admin/tickets.html",
  "bar-staff/closing-checklist.html",
  "bar-staff/current-rota.html",
  "bar-staff/incident-report.html",
  "bar-staff/price-list.html",
  "bar-staff/shift-cover-request.html",
  "bar-staff/this-weeks-rota.html",
  "bar-staff/till-card-lookup.html",
  "bar-staff/whats-on-this-week.html",
  "committee/agm-planning.html",
  "committee/club-constitution.html",
  "committee/finances-accounts.html",
  "committee/funding-opportunities.html",
  "committee/membership-numbers.html",
  "keyholder/alarm-fault.html",
  "keyholder/fire-safety.html",
  "keyholder/first-aid.html",
  "keyholder/out-of-hours-contact.html",
  "keyholder/till-discrepancy.html",
  "keyholder/weather-closure.html",
  "management/entertainment-tracker.html",
  "management/expense-requests.html",
  "management/licensing-compliance.html",
  "management/membership-till-system.html",
  "management/new-starter-checklist.html",
  "management/pending-bookings.html",
  "management/shift-cover-requests-mgmt.html",
  "management/supplier-contacts.html",
  "management/weekly-rota-builder.html",
  "shared/staff-faq.html",
  "shared/staff-rota.html",
  "staff-area.html"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE).catch(() => {
        // If a file is missing, don't fail the whole install
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle same-origin GET requests for our own pages
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
      // Serve cached immediately if we have it, update cache in background
      return cached || fetchPromise;
    })
  );
});
