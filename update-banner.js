// Shared "update available" banner — include this on any page with:
// <script src="update-banner.js"></script>
// Handles registering the service worker AND showing a banner when a new
// version is detected, so every page behaves the same way with one line.

(function(){
  function injectBannerStyles(){
    const style = document.createElement('style');
    style.textContent = `
      #shared-update-banner{
        display:none; align-items:center; justify-content:center; gap:14px;
        padding:10px 16px; font-family:'Inter', sans-serif; font-size:0.82rem; font-weight:600;
        text-align:center; position:sticky; top:0; z-index:9999;
        background:#b8873f; color:#181614;
      }
      #shared-update-banner button{
        font-family:'Inter', sans-serif; font-weight:700; font-size:0.78rem;
        background:#181614; color:#fff; border:none; border-radius:6px;
        padding:6px 14px; cursor:pointer;
      }
    `;
    document.head.appendChild(style);
  }

  function injectBannerHTML(){
    const banner = document.createElement('div');
    banner.id = 'shared-update-banner';
    banner.innerHTML = `<span>🔄 A new version is available.</span><button id="shared-update-refresh-btn">Refresh</button>`;
    document.body.insertBefore(banner, document.body.firstChild);
    document.getElementById('shared-update-refresh-btn').addEventListener('click', () => window.location.reload());
  }

  function init(){
    injectBannerStyles();
    injectBannerHTML();

    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('sw.js').then((registration) => {
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
              showBanner('🔄 A new version is available.');
            }
          });
        });
      }).catch(() => {});
    }

    startDeploymentPolling();
  }

  function showBanner(message){
    const banner = document.getElementById('shared-update-banner');
    banner.querySelector('span').textContent = message;
    banner.style.display = 'flex';
  }

  // Separately, poll GitHub's actual deployment status directly — this catches
  // a publish finishing even if it wasn't triggered from this device, since it's
  // checking the real, ground-truth state rather than just this browser's cache.
  function startDeploymentPolling(){
    const saved = JSON.parse(localStorage.getItem('ghConfig') || 'null');
    if(!saved || !saved.owner || !saved.repo) return;

    const check = async () => {
      try{
        const headers = saved.token ? { Authorization: `token ${saved.token}` } : {};
        const res = await fetch(`https://api.github.com/repos/${saved.owner}/${saved.repo}/pages/builds/latest`, { headers });
        if(!res.ok) return;
        const build = await res.json();
        if(build.status !== 'built') return;

        const lastSeen = localStorage.getItem('lastSeenDeployId');
        const currentId = String(build.id || build.updated_at);
        if(lastSeen && lastSeen !== currentId){
          showBanner('🟢 The site was just updated — tap to see the latest.');
        }
        localStorage.setItem('lastSeenDeployId', currentId);
      } catch(e){
        // Quietly skip this round — not worth surfacing a network hiccup as an error
      }
    };
    check();
    setInterval(check, 45000);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
