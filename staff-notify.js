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

// ---- Real push alerts (arrive even when the staff app is closed) ----
// When someone allows notifications in Staff Hub, this registers the device
// with Firebase Cloud Messaging and saves its address in pushTokens, tagged
// with who's signed in. The server code in functions/ then sends alerts
// (new sign-ups, incidents, announcements) to the right people's devices.
(function(){
  const VAPID_KEY = 'BNeE7NKtFXBYA5uJeExJ_d_T6i084bdtJj-acHaM8E1CmTDlTlLe44nM9UczYzDeZjpNkaqaI7dnEfL8Yp3zrYY';
  const MESSAGING_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js';
  const SAVED_KEY = 'staffPushToken';

  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function withTimeout(p, ms){
    return Promise.race([p, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
  }
  function saved(){ try{ return JSON.parse(localStorage.getItem(SAVED_KEY) || 'null'); } catch(e){ return null; } }

  window.enableStaffPush = async function(db, uid){
    try{
      if(!uid || !window.firebase || !('Notification' in window) || Notification.permission !== 'granted') return false;
      if(!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
      if(!firebase.messaging) await loadScript(MESSAGING_SDK);
      if(firebase.messaging.isSupported && !(await firebase.messaging.isSupported())) return false;
      const reg = await withTimeout(navigator.serviceWorker.ready, 8000);
      if(!reg) return false;
      const token = await firebase.messaging().getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
      if(!token) return false;
      const last = saved();
      // Re-save at most weekly, or straight away if the token or person changed.
      if(last && last.token === token && last.uid === uid && Date.now() - last.at < 7 * 86400000) return true;
      await db.collection('pushTokens').doc(token).set({ uid, updatedAtMs: Date.now(), device: (navigator.userAgent || '').slice(0, 150) });
      localStorage.setItem(SAVED_KEY, JSON.stringify({ token, uid, at: Date.now() }));
      return true;
    } catch(e){
      console.warn('Push alerts not set up on this device:', e && e.message);
      return false;
    }
  };

  // On sign-out, stop this device getting that person's alerts.
  window.disableStaffPush = async function(db){
    const last = saved();
    if(!last || !db) return;
    try{ await withTimeout(db.collection('pushTokens').doc(last.token).delete(), 2500); } catch(e){}
    try{ localStorage.removeItem(SAVED_KEY); } catch(e){}
  };
})();
