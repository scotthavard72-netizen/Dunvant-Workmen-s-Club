// The club's Facebook page, embedded — so anything posted on Facebook (events,
// updates, photos) shows up on the site without copying it across.
//
// Usage: <div class="fb-feed" data-tabs="events,timeline" data-height="700"></div>
//        <script src="fb-feed.js"></script>
//
// Facebook's embed sets Facebook cookies, so it only loads once the viewer
// taps "Show Facebook posts" (UK cookie rules want consent first). That
// choice is remembered on their device, so after the first tap it loads
// straight away.
(function(){
  const PAGE_URL = 'https://www.facebook.com/profile.php?id=61563877044858';
  const OK_KEY = 'fbFeedAllowed';

  function allowed(){
    try{ return localStorage.getItem(OK_KEY) === 'yes'; } catch(e){ return false; }
  }
  function remember(){
    try{ localStorage.setItem(OK_KEY, 'yes'); } catch(e){}
  }

  function injectStyles(){
    if(document.getElementById('fb-feed-styles')) return;
    const st = document.createElement('style');
    st.id = 'fb-feed-styles';
    st.textContent = `
      .fb-feed{width:100%; max-width:500px; margin:0 auto;}
      .fb-feed-gate{border:1px dashed var(--brass, #a67c3d); border-radius:12px; padding:22px 20px; text-align:center; background:var(--card, #faf4e8);}
      .fb-feed-gate p{font-size:0.86rem; color:var(--muted, #6b5d4f); margin:0 0 14px; line-height:1.5;}
      .fb-feed-gate button{font-family:'Inter', sans-serif; font-weight:600; font-size:0.9rem; background:#1877f2; color:#fff; border:none; border-radius:8px; padding:12px 18px; cursor:pointer;}
      .fb-feed-frame{display:block; border:none; overflow:hidden; border-radius:12px; background:#fff; margin:0 auto;}
      .fb-feed-link{display:block; text-align:center; margin-top:12px; font-size:0.84rem; font-weight:600; color:var(--brass, #a67c3d); text-decoration:none;}
    `;
    document.head.appendChild(st);
  }

  function load(el){
    const width = Math.max(180, Math.min(500, Math.floor(el.clientWidth || 500)));
    const height = parseInt(el.dataset.height || '700', 10);
    const params = new URLSearchParams({
      href: PAGE_URL,
      tabs: el.dataset.tabs || 'events,timeline',
      width: String(width),
      height: String(height),
      small_header: 'true',
      adapt_container_width: 'true',
      hide_cover: 'false',
      show_facepile: 'false'
    });
    el.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.className = 'fb-feed-frame';
    frame.title = "The club's Facebook page";
    frame.src = 'https://www.facebook.com/plugins/page.php?' + params.toString();
    frame.width = width;
    frame.height = height;
    frame.loading = 'lazy';
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('allow', 'encrypted-media; clipboard-write; web-share');
    el.appendChild(frame);
    el.appendChild(link());
  }

  function link(){
    const a = document.createElement('a');
    a.className = 'fb-feed-link';
    a.href = PAGE_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Open the club on Facebook →';
    return a;
  }

  function gate(el){
    el.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'fb-feed-gate';
    box.innerHTML = `<p>Events and updates are posted on the club's Facebook page. Showing them here loads content from Facebook, which may set Facebook cookies.</p>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Show Facebook posts';
    btn.addEventListener('click', () => { remember(); load(el); });
    box.appendChild(btn);
    el.appendChild(box);
    el.appendChild(link());
  }

  function init(){
    injectStyles();
    document.querySelectorAll('.fb-feed').forEach(el => allowed() ? load(el) : gate(el));
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
