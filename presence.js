// Shared "someone else is in here too" indicator for admin tools where two
// people working on the same thing at once could overwrite each other's
// work (the rota builder, editing a site content file).
//
// Include this AFTER Firebase has been initialized on the page, then call:
//   Presence.start('weekly-rota-builder', 'building the rota');
// and Presence.stop() if you leave that context without navigating away
// (e.g. finish and go idle). It also cleans up on page unload, and even
// without that running (closed tab, lost connection), a stale entry stops
// being shown to others after a minute of no heartbeat.
window.Presence = (function(){
  const HEARTBEAT_MS = 20000;
  const STALE_MS = 60000;
  let heartbeatTimer = null;
  let watchTimer = null;
  let currentKey = null;
  let currentLabel = '';

  function sessionId(){
    let id = sessionStorage.getItem('presenceSessionId');
    if(!id){
      id = 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('presenceSessionId', id);
    }
    return id;
  }

  function myName(){
    return localStorage.getItem('staffUserName') || 'Someone';
  }

  function fsdb(){
    return firebase.firestore();
  }

  function ensureBanner(){
    let banner = document.getElementById('shared-presence-banner');
    if(banner) return banner;
    banner = document.createElement('div');
    banner.id = 'shared-presence-banner';
    banner.style.cssText = 'display:none; align-items:center; justify-content:center; gap:10px; padding:8px 16px; font-family:"Inter", sans-serif; font-size:0.78rem; font-weight:600; text-align:center; position:sticky; top:0; z-index:9997; background:#c9a05e; color:#181614;';
    banner.innerHTML = '<span></span>';
    document.body.insertBefore(banner, document.body.firstChild);
    return banner;
  }

  function showBanner(text){
    const banner = ensureBanner();
    banner.querySelector('span').textContent = text;
    banner.style.display = 'flex';
  }

  function hideBanner(){
    const banner = document.getElementById('shared-presence-banner');
    if(banner) banner.style.display = 'none';
  }

  async function heartbeat(){
    if(!currentKey) return;
    try{
      await fsdb().collection('editingPresence').doc(sessionId()).set({
        pageKey: currentKey, name: myName(), label: currentLabel, lastPingMs: Date.now()
      });
    } catch(e){ /* best-effort — a missed heartbeat just means we check in again next cycle */ }
  }

  async function checkOthers(){
    if(!currentKey) return;
    try{
      const snap = await fsdb().collection('editingPresence').where('pageKey', '==', currentKey).get();
      const mine = sessionId();
      const others = snap.docs
        .filter(d => d.id !== mine)
        .map(d => d.data())
        .filter(d => (Date.now() - (d.lastPingMs || 0)) < STALE_MS)
        .sort((a, b) => (b.lastPingMs || 0) - (a.lastPingMs || 0));
      if(others.length > 0){
        const other = others[0];
        showBanner(`👀 ${other.name} is also here right now${other.label ? ' — ' + other.label : ''} — check with them before you publish.`);
      } else {
        hideBanner();
      }
    } catch(e){ /* leave whatever was last shown rather than flash it away on a network hiccup */ }
  }

  function cleanupOnUnload(){
    try{ fsdb().collection('editingPresence').doc(sessionId()).delete(); } catch(e){}
  }

  function start(key, label){
    stop();
    currentKey = key;
    currentLabel = label || '';
    heartbeat();
    checkOthers();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    watchTimer = setInterval(checkOthers, HEARTBEAT_MS);
    window.addEventListener('beforeunload', cleanupOnUnload);
  }

  function stop(){
    if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if(watchTimer){ clearInterval(watchTimer); watchTimer = null; }
    if(currentKey) cleanupOnUnload();
    currentKey = null;
    hideBanner();
    window.removeEventListener('beforeunload', cleanupOnUnload);
  }

  return { start, stop };
})();
