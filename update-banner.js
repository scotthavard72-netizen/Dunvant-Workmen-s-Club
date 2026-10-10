// Shared "update available" banner — include this on any page with:
// <script src="update-banner.js"></script>
// Handles registering the service worker AND showing a banner when a new
// version is detected, so every page behaves the same way with one line.

// This repo, hardcoded — matches the same OWNER/REPO used elsewhere on the
// site (Staff Hub, Site Status, etc.) for its own GitHub API calls.
const GH_OWNER = 'scotthavard72-netizen';
const GH_REPO = 'Dunvant-Workmen-s-Club';

(function(){
  // Admin-only, based on the roles Staff Area/Staff Hub already save to
  // localStorage at login (and clear at logout) — good enough for "am I
  // signed in as someone who'd care about a deploy" without wiring this
  // generic, every-page script into Firebase auth itself.
  function isAdmin(){
    try{
      const roles = JSON.parse(localStorage.getItem('staffUserRoles') || '[]');
      return Array.isArray(roles) && roles.includes('admin');
    } catch(e){ return false; }
  }

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
      #shared-offline-banner{
        display:none; align-items:center; justify-content:center; gap:10px;
        padding:10px 16px; font-family:'Inter', sans-serif; font-size:0.82rem; font-weight:600;
        text-align:center; position:sticky; top:0; z-index:9999;
        background:#8a2f2f; color:#fff;
      }
      #shared-deploy-progress-banner{
        display:none; align-items:center; justify-content:center; gap:10px;
        padding:8px 16px; font-family:'Inter', sans-serif; font-size:0.78rem; font-weight:600;
        text-align:center; position:sticky; top:0; z-index:9998;
        background:#2d4a35; color:#fff;
      }
      #shared-deploy-progress-banner.errored{ background:#8a2f2f; }
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

  // Admin-only — a small persistent strip that tracks an in-progress site
  // update (queued → building → done) wherever they happen to be on the
  // site, rather than only finding out after the fact from the "new version
  // available" banner above (which everyone gets).
  function injectDeployProgressBannerHTML(){
    if(!isAdmin()) return;
    const banner = document.createElement('div');
    banner.id = 'shared-deploy-progress-banner';
    banner.innerHTML = `<span id="shared-deploy-progress-text"></span>`;
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function showDeployProgress(message, isError){
    const banner = document.getElementById('shared-deploy-progress-banner');
    if(!banner) return; // not admin — this banner was never injected
    banner.querySelector('span').textContent = message;
    banner.classList.toggle('errored', !!isError);
    banner.style.display = 'flex';
  }

  function hideDeployProgress(){
    const banner = document.getElementById('shared-deploy-progress-banner');
    if(banner) banner.style.display = 'none';
  }

  // Only add this if the page doesn't already have its own offline-banner —
  // a handful of older pages built theirs by hand before this existed.
  function injectOfflineBannerHTML(){
    if(document.getElementById('offline-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'shared-offline-banner';
    banner.innerHTML = `<span>📡 You're offline — showing the last saved version. Anything that needs a live connection (forms, the rota, live lists) won't work until you're back online.</span>`;
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function updateOfflineStatus(){
    const banner = document.getElementById('shared-offline-banner');
    if(!banner) return;
    banner.style.display = navigator.onLine ? 'none' : 'flex';
  }

  function init(){
    injectBannerStyles();
    injectBannerHTML();
    injectDeployProgressBannerHTML();
    injectOfflineBannerHTML();
    updateOfflineStatus();
    window.addEventListener('online', updateOfflineStatus);
    window.addEventListener('offline', updateOfflineStatus);

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

  // Admin-only. Two checks, every 45s:
  //  1. Progress — the "Deploy to Firebase Hosting" GitHub Action (queued →
  //     building → done/failed). Best-effort: once the repo is private,
  //     GitHub won't answer without a login and this just stays quiet.
  //  2. What's actually live — version.json, which that Action stamps onto
  //     the site with every deploy. This is the real "it's live now" signal
  //     and keeps working whatever happens to the repo.
  // Everyone else just gets the plain "new version available" banner once
  // the service worker spots an update (handled above).
  const DEPLOY_WORKFLOW = 'firebase-hosting-merge.yml';
  function startDeploymentPolling(){
    if(!isAdmin()) return;

    const checkProgress = async () => {
      try{
        const res = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${DEPLOY_WORKFLOW}/runs?per_page=1`);
        if(!res.ok) return;
        const data = await res.json();
        const run = data.workflow_runs && data.workflow_runs[0];
        if(!run) return;
        if(['queued', 'requested', 'waiting', 'pending'].includes(run.status)){
          showDeployProgress('⏳ Site update queued — about to start building…');
          return;
        }
        if(run.status === 'in_progress'){
          showDeployProgress('🔧 Site update building — usually live within a minute or two.');
          return;
        }
        if(run.status === 'completed' && ['failure', 'timed_out', 'startup_failure'].includes(run.conclusion)){
          showDeployProgress('⚠️ The last site update failed to deploy — check the Actions tab on GitHub.', true);
          return;
        }
        hideDeployProgress();
      } catch(e){
        // Quietly skip this round — not worth surfacing a network hiccup as an error
      }
    };

    const checkLive = async () => {
      try{
        const res = await fetch('version.json', { cache: 'no-store' });
        if(!res.ok) return;
        const live = await res.json();
        const currentId = String(live.sha || live.deployedAt || '');
        if(!currentId) return;
        const lastSeen = localStorage.getItem('lastSeenDeployId');
        if(lastSeen && lastSeen !== currentId){
          hideDeployProgress();
          showBanner('🟢 The site was just updated — tap to see the latest.');
        }
        localStorage.setItem('lastSeenDeployId', currentId);
      } catch(e){}
    };

    const check = () => { checkProgress(); checkLive(); };
    check();
    setInterval(check, 45000);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
