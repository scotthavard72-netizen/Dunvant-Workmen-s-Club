// Shared way to show a staff notification that works on phones as well as
// desktops.
//
// Desktop browsers accept `new Notification(...)` straight from a page, but
// Chrome on Android and installed iPhone home-screen apps refuse it — they
// only show notifications that come through the site's service worker
// (sw.js). So this tries the service worker first and only falls back to
// the page-level version if there isn't one (e.g. desktop before sw.js has
// finished registering).
//
// options: { body, url, tag }
//   url — page to open when the notification is tapped (default Staff Hub)
//   tag — notifications with the same tag replace each other instead of piling up
(function(){
  const ICON = 'assets/dw-staff-icon-192.png';

  function viaPage(title, opts, url){
    try{
      const n = new Notification(title, opts);
      n.onclick = () => { window.focus(); if(url) window.location.href = url; };
      return true;
    } catch(e){
      return false;
    }
  }

  // Use the service worker if it's already running. If it's registered but
  // still starting up (first visit), give it a few seconds; if there isn't
  // one at all, don't wait.
  function getRegistration(){
    if(!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration().then(reg => {
      if(!reg) return null;
      if(reg.active) return reg;
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));
      return Promise.race([navigator.serviceWorker.ready, timeout]);
    }).catch(() => null);
  }

  window.showStaffNotification = function(title, options){
    options = options || {};
    if(!('Notification' in window) || Notification.permission !== 'granted') return Promise.resolve(false);
    const url = options.url || 'staff-hub.html';
    const opts = { body: options.body || '', icon: ICON, badge: ICON, data: { url } };
    if(options.tag) opts.tag = options.tag;
    return getRegistration().then(reg => {
      if(reg && typeof reg.showNotification === 'function'){
        return reg.showNotification(title, opts).then(() => true, () => viaPage(title, opts, url));
      }
      return viaPage(title, opts, url);
    });
  };
})();
