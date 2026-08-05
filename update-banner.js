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
              document.getElementById('shared-update-banner').style.display = 'flex';
            }
          });
        });
      }).catch(() => {});
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
