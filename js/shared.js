/* ==========================================================================
   Shared behaviour for the EOR 2026 landing pages.
   No modules, no fetch: every page works from a double-click (file://).
   ========================================================================== */
(function(){
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];

/* ---- wordmark ---- */
$$('[data-logo]').forEach(el=>{el.innerHTML=window.BL_LOGO||'Borderless AI'});

/* ---- the scenes. Change a scene here and every page follows. ---- */
const ROOMS={
  /* label: what the scene is, for screen readers. Scenes are never tied to a named city. */
  rink:      {file:'room-rink.html',       label:'An outdoor skating rink', role:'Head office'},
  'streetcar-b':{file:'room-streetcar-b.html',label:'A streetcar stop',      role:''},
  azotea:    {file:'room-azotea.html',     label:'A rooftop garden',        role:'Product design'},
  seoul:     {file:'room-seoul.html',      label:'An animation studio',     role:'Motion design'},
  dock:      {file:'room-dock.html',       label:'A lakeside dock',         role:''},
  market:    {file:'room-market.html',     label:'A market stall',          role:''},
  greenhouse:{file:'room-greenhouse.html', label:'A greenhouse',            role:''},
  lighthouse:{file:'room-lighthouse.html', label:'A lighthouse watch room', role:''},
  'office-f1':{file:'room-office-f1.html',  label:'An office lobby',        role:''},
  'office-f2':{file:'room-office-f2.html',  label:'A payroll office',       role:''},
  'office-f3':{file:'room-office-f3.html',  label:'An open-plan team floor', role:''},
  'office-f4':{file:'room-office-f4.html',  label:'An office top floor',    role:''},
};
window.BL_ROOMS=ROOMS;
const base=(document.currentScript&&document.currentScript.src||'').replace(/js\/shared\.js.*$/,'');

function fmt(tz){
  try{return new Intl.DateTimeFormat('en-CA',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:tz}).format(new Date()).replace(/\s?([ap])\.?m\.?/i,(m,a)=>' '+a.toUpperCase()+'M')}
  catch(e){return ''}
}

/* <figure class="dio" data-room="rink" data-caption="clock|plate|none" data-role="…"> */
$$('.dio[data-room]').forEach(fig=>{
  const r=ROOMS[fig.dataset.room]; if(!r) return;
  const src=base+'dioramas/'+r.file;
  const f=document.createElement('iframe');
  f.src=src; f.title=r.label; f.loading='lazy'; f.setAttribute('tabindex','-1'); f.setAttribute('aria-hidden','true');
  fig.prepend(f);
  /* the room's own fit leaves generous paper; in a small tile, lean in a little.
     Same-origin only (served over http); on file:// it quietly keeps the default fit. */
  const k=parseFloat(fig.dataset.zoom||'1.22');
  f.addEventListener('load',()=>{try{
    const w=f.contentWindow, lean=()=>{const st=w.STAGE; if(st&&st.cam) st.cam.zoom*=k};
    setTimeout(lean,60); w.addEventListener('resize',()=>setTimeout(lean,0));
  }catch(e){}});
  fig.setAttribute('role','button'); fig.setAttribute('tabindex','0');
  fig.setAttribute('aria-label','Open the scene: '+r.label.toLowerCase());
  const mode=fig.dataset.caption||'clock';
  if(mode==='clock'){
    const cap=document.createElement('figcaption');
    const role=fig.dataset.role??r.role;
    cap.innerHTML=(role?`<span class="role">${role}</span>`:'');
    fig.append(cap);
  }
  const open=()=>openLightbox(src,r.label);
  fig.addEventListener('click',open);
  fig.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}});
});
setInterval(()=>$$('[data-tz]').forEach(el=>el.textContent=fmt(el.dataset.tz)),15000);

/* ---- lightbox: the one place a scene takes the mouse (drag to pan, wheel to zoom) ---- */
let lb=null;
function openLightbox(src,label){
  if(!lb){
    lb=document.createElement('div'); lb.className='dlb';
    lb.innerHTML='<div class="frame"><iframe title="scene"></iframe><span class="hint"></span><button class="x" aria-label="Close">×</button></div>';
    document.body.append(lb);
    lb.addEventListener('click',e=>{if(e.target===lb||e.target.classList.contains('x'))close()});
    addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  }
  const inl=window.BL_INLINE&&window.BL_INLINE.room(src);       // a single-file build makes the room page itself
  $('iframe',lb).src=inl||src; $('iframe',lb).title=label||'Scene'; $('.hint',lb).textContent='Drag to look around, scroll to zoom';
  lb.classList.add('open'); document.documentElement.style.overflow='hidden';
}
window.BL_openScene=openLightbox;
function close(){if(!lb)return; lb.classList.remove('open'); $('iframe',lb).src='about:blank'; document.documentElement.style.overflow=''}

/* ---- reveal on scroll ---- */
const io='IntersectionObserver' in window?new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{rootMargin:'0px 0px -8% 0px'}):null;
$$('.rv').forEach(el=>io?io.observe(el):el.classList.add('in'));

/* ---- countdown helpers: [data-days-left="2026-12-31"] ---- */
function daysLeft(iso){const end=new Date(iso+'T23:59:59');return Math.max(0,Math.ceil((end-new Date())/864e5))}
$$('[data-days-left]').forEach(el=>el.textContent=daysLeft(el.dataset.daysLeft));
window.BL_daysLeft=daysLeft;

/* ---- review notes: any element with data-note="…" is an open question ---- */
const notes=$$('[data-note]');
if(notes.length){
  notes.forEach((el,i)=>el.setAttribute('data-rn',i+1));
  const btn=document.createElement('button'); btn.className='rn-btn'; btn.type='button';
  btn.innerHTML=`Review notes <span class="n">${notes.length}</span>`;
  const panel=document.createElement('div'); panel.className='rn-panel';
  panel.innerHTML='<h4>Needs sign-off before launch</h4><ol>'+notes.map(n=>`<li>${n.dataset.note}</li>`).join('')+'</ol>';
  document.body.append(panel,btn);
  btn.addEventListener('click',()=>document.body.classList.toggle('rn'));
  if(/[?&]notes/.test(location.search)) document.body.classList.add('rn');
}
})();
