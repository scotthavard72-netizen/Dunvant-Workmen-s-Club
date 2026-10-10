// Tap-to-enlarge for photos and posters.
// Usage: <a href="assets/photos/x.jpg" data-lightbox="group" title="Caption"><img ...></a>
// Links in the same group can be stepped through with the arrows, arrow keys,
// or a swipe. Esc / tapping the background closes it. Without JS, the link
// simply opens the image.
(function(){
  let items = [], index = 0, overlay, imgEl, capEl, touchX = null;

  function build(){
    const st = document.createElement('style');
    st.textContent = `
      .lb-overlay{position:fixed; inset:0; z-index:1000; background:rgba(10,8,6,0.94); display:none; align-items:center; justify-content:center; flex-direction:column; padding:56px 12px 20px;}
      .lb-overlay.open{display:flex;}
      .lb-overlay img{max-width:100%; max-height:calc(100vh - 120px); object-fit:contain; border-radius:4px; box-shadow:0 10px 40px rgba(0,0,0,0.5);}
      .lb-cap{color:#e9dfcd; font-family:'Inter', sans-serif; font-size:0.88rem; margin-top:12px; text-align:center; max-width:640px; line-height:1.4;}
      .lb-btn{position:absolute; background:rgba(255,255,255,0.12); color:#fff; border:1px solid rgba(255,255,255,0.25); border-radius:50%; width:44px; height:44px; font-size:1.3rem; cursor:pointer; display:flex; align-items:center; justify-content:center;}
      .lb-close{top:calc(10px + env(safe-area-inset-top)); right:12px;}
      .lb-prev{left:10px; top:50%; transform:translateY(-50%);}
      .lb-next{right:10px; top:50%; transform:translateY(-50%);}
      .lb-count{position:absolute; top:calc(20px + env(safe-area-inset-top)); left:16px; color:#cfc3ae; font-family:'Inter', sans-serif; font-size:0.8rem;}
    `;
    document.head.appendChild(st);
    overlay = document.createElement('div');
    overlay.className = 'lb-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <span class="lb-count"></span>
      <button class="lb-btn lb-close" aria-label="Close">✕</button>
      <button class="lb-btn lb-prev" aria-label="Previous">‹</button>
      <img alt="">
      <div class="lb-cap"></div>
      <button class="lb-btn lb-next" aria-label="Next">›</button>`;
    document.body.appendChild(overlay);
    imgEl = overlay.querySelector('img');
    capEl = overlay.querySelector('.lb-cap');
    overlay.querySelector('.lb-close').onclick = close;
    overlay.querySelector('.lb-prev').onclick = e => { e.stopPropagation(); step(-1); };
    overlay.querySelector('.lb-next').onclick = e => { e.stopPropagation(); step(1); };
    overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
    overlay.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend', e => {
      if(touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if(Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
      touchX = null;
    });
    document.addEventListener('keydown', e => {
      if(!overlay.classList.contains('open')) return;
      if(e.key === 'Escape') close();
      if(e.key === 'ArrowLeft') step(-1);
      if(e.key === 'ArrowRight') step(1);
    });
  }

  function show(){
    const a = items[index];
    imgEl.src = a.getAttribute('href');
    // Photos added through Manage Gallery link to a small preview; swap in the
    // full-size copy once it arrives (only if they haven't moved on).
    if(a.dataset.fullId && window.LIGHTBOX_FULL){
      const want = index;
      window.LIGHTBOX_FULL(a.dataset.fullId).then(src => { if(src && index === want) imgEl.src = src; }).catch(() => {});
    }
    const img = a.querySelector('img');
    imgEl.alt = img ? img.alt : '';
    capEl.textContent = a.getAttribute('title') || (img ? img.alt : '');
    const many = items.length > 1;
    overlay.querySelector('.lb-prev').style.display = many ? 'flex' : 'none';
    overlay.querySelector('.lb-next').style.display = many ? 'flex' : 'none';
    overlay.querySelector('.lb-count').textContent = many ? `${index + 1} / ${items.length}` : '';
  }
  function step(d){ index = (index + d + items.length) % items.length; show(); }
  function close(){ overlay.classList.remove('open'); document.body.style.overflow = ''; }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-lightbox]');
    if(!a) return;
    e.preventDefault();
    if(!overlay) build();
    const group = a.dataset.lightbox;
    items = [...document.querySelectorAll(`a[data-lightbox="${group}"]`)].filter(x => x.offsetParent !== null || x === a);
    index = Math.max(0, items.indexOf(a));
    show();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
})();
