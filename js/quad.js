/* ==========================================================================
   Diorama scenes on a page: the hero diamond, crops of single rooms, and the
   scroll-driven tour. One loop, one set of cached layers, one quality ladder.

     canvas[data-quad]        the hero diamond, over its still image
     canvas[data-room-view]   one room; camera on data-focus="i,j,z"; data-whole = whole room
     canvas[data-tour]        a second diamond, built from the [data-tour-step="room"]
                              elements in order (back, right, left, front), panning room
                              to room as those steps scroll past
     canvas[data-stack]       one building, its floors (data-floors="f1,f2,…") stacked at true
                              storey height. One floor is open at a time, from the top down:
                              the floors below are closed by a facade room (data-facade). When
                              the open floor's middle scrolls past the middle of the screen it
                              fades out and the next one's facade fades away. The open floor plays

   Loading, in order:
     1. The page paints a still image of the hero (assets/img/hero-diamond-*.webp),
        made by tools/build-poster.py from exactly the frame the canvas starts on.
     2. When the page is idle, fetch the engine + hero rooms (dioramas-bundle.js),
        and the tour's rooms (dioramas-tour.js) if the page has a tour.
     3. Bake each room's static layers one idle slice at a time, draw the still's
        moment, fade the canvas in over the still, and carry on animating.
   Visitors with reduced motion, data saver or a low-memory device stay on step 1.

   Time. Rooms animate at the ladder's rate (30 fps at best). The tour is also
   composited on every display frame, so its camera follows the scroll at the
   screen's own refresh rate: a pan is cheap (a few image copies), a room is not.

   Scale. The hero sets the scale of every view, except a tour with rooms of its own:
   it draws its room in focus as large as the space beside (or above) the cards
   allows, up to 1:1 with the room's own drawing, and bakes those rooms at that size.

   Memory. Each room's cached layers are ~30 MB on a retina laptop. Only rooms on
   or near the screen keep them: the hero's four while it is in reach, the tour's
   room in focus and the next one. The tour's other rooms are plain snapshots.
   Scroll back and the rooms re-bake in idle slices before they are needed.

   The ladder: if drawing the rooms takes more than ~45% of each frame, step to the
   first cheaper rung that should fit (fewer fps, 1x resolution, no shimmer,
   frozen). Force a rung with ?quad=still or ?quad=L0..L4; ?slow=25 burns 25 ms per
   frame to watch it work; BL_QUAD.status() in the console shows what it is doing.

   Layout: rooms sit on the engine's isometric grid, 12 units each with a GAP, so a
   composite is itself a diamond. A nearer room's inner walls rise toward the room
   behind; GAP keeps them off the farther floor, and anything drawn above an inner
   wall is clipped away, so each room paints whole, back to front.
   ========================================================================== */
(function(){
const me=document.currentScript;
const base=(me&&me.src||'').replace(/js\/quad\.js.*$/,'');
const BUNDLE=base+'js/dioramas-bundle.js',TOUR_BUNDLE=base+'js/dioramas-tour.js',OFFICE_BUNDLE=base+'js/dioramas-office.js';
const POSTER_T=5.4;                 // the still image is this moment; the live canvas continues from it
const TW=64,TH=32,TZ=32;            // the engine's projection, repeated so stills can be clicked before it loads
const isoX_=(i,j)=>(i-j)*TW/2, isoY_=(i,j,z)=>(i+j)*TH/2-(z||0)*TZ, P=(i,j,z)=>[isoX_(i,j),isoY_(i,j,z)];
const GAP=4,S=12+GAP;
/* where a room can sit in a diamond. inner = the wall that faces another room */
const SLOT={
  back: {oi:0,oj:0,inner:{nw:false,ne:false},depth:0},
  left: {oi:0,oj:S,inner:{nw:false,ne:true },depth:1},
  right:{oi:S,oj:0,inner:{nw:true, ne:false},depth:1},
  front:{oi:S,oj:S,inner:{nw:true, ne:true },depth:2},
};
const HERO=[['rink','back'],['azotea','left'],['streetcar-b','right'],['seoul','front']];
const TOUR_SLOTS=['back','right','left','front'];     // tour steps 1..4, in camera order
/* An inner side is cut just above its wall, and never above GAP: anything taller would
   paint over the floor of the room behind. STEPS lower the cut further along part of an
   inner side, as [from, height]: `from` is measured from the room's back corner.
     streetcar-b, nw (faces the rink): beyond 6.75 the cut drops to pavement level, taking
     the trolley pole and its lamp arm that stood against the rink's front edge. Nearer the
     corner it stays at GAP, so the car (3.7 tall), the street tree and the shops stay whole. */
const STEPS={'streetcar-b':{nw:[6.75,.4]}};
function clipFor(inner,w,d,wall,name){
  const cut=Math.min(wall+.3,GAP),hN=inner.nw?cut:wall+3.4, hE=inner.ne?cut:wall+3.4, m=10, zb=-1.6;
  const st=STEPS[name]||{},sN=inner.nw&&st.nw,sE=inner.ne&&st.ne;
  const left=sN?[[P(0,d,sN[1])[0]-m,P(0,d,sN[1])[1]],P(0,sN[0],sN[1]),P(0,sN[0],hN)]:[[P(0,d,hN)[0]-m,P(0,d,hN)[1]]];
  const right=sE?[P(sE[0],0,hE),P(sE[0],0,sE[1]),[P(w,0,sE[1])[0]+m,P(w,0,sE[1])[1]]]:[[P(w,0,hE)[0]+m,P(w,0,hE)[1]]];
  return [...left,P(0,0,hN),P(0,0,hE),...right,
          [P(w,0,zb)[0]+m,P(w,0,zb)[1]],P(w,d,zb),[P(0,d,zb)[0]-m,P(0,d,zb)[1]]];
}
function bbox(pts){let x0=1/0,y0=1/0,x1=-1/0,y1=-1/0;for(const [x,y] of pts){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}return {x0,y0,x1,y1}}
function pip_(Q,x,y){let c=false;for(let i=0,j=Q.length-1;i<Q.length;j=i++){const a=Q[i],b=Q[j];
  if(((a[1]>y)!==(b[1]>y))&&(x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]))c=!c}return c}
function path(c,pts,dx,dy){c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p[0]+dx,p[1]+dy):c.moveTo(p[0]+dx,p[1]+dy));c.closePath()}

/* ---- rooms are mounted once each, and shared by every view that shows them ---- */
const MOUNTS=new Map();
function mountRoom(name,rm){
  if(MOUNTS.has(name))return MOUNTS.get(name);
  rm=rm||(window.BL_QUAD_ROOMS||{})[name];if(!rm)return null;
  rm.__embed=true;
  const st=mount(rm,document.createElement('canvas'));
  globalThis.STAGE=undefined;       // the last mount claims it; it means nothing here
  const m={name,rm,st,w:rm.w||12,d:rm.d||12,wall:rm.wall??3.2,fps:rm.boilFps??7,baked:false,warming:null,lastWanted:0};
  MOUNTS.set(name,m);return m;
}
function composite(layout){
  const rooms=layout.map(([name,slot])=>{const m=mountRoom(name);if(!m)return null;const L=SLOT[slot];
    return {name,m,st:m.st,rm:m.rm,fps:m.fps,slot,depth:L.depth,
      clip:clipFor(L.inner,m.w,m.d,m.wall,name),floor:[P(0,0),P(m.w,0),P(m.w,m.d),P(0,m.d)],off:P(L.oi,L.oj)}})
    .filter(Boolean).sort((a,b)=>a.depth-b.depth);
  let bx0=1/0,by0=1/0,bx1=-1/0,by1=-1/0;
  for(const r of rooms)for(const [x,y] of r.clip){bx0=Math.min(bx0,x+r.off[0]);bx1=Math.max(bx1,x+r.off[0]);by0=Math.min(by0,y+r.off[1]);by1=Math.max(by1,y+r.off[1])}
  return {rooms,bx0,by0,BW:bx1-bx0,BH:by1-by0};
}
let COMP=null;const heroComp=()=>COMP||(COMP=composite(HERO));
/* A stack: floors bottom to top at real storey height (walls plus the concrete plate),
   so each floor's plate sits on the walls of the one below. Each is clipped just above
   its walls; the plate above covers the cut. The facade is one room, drawn over any
   floor that is closed. Only the ground floor casts a shadow. */
const STACK_PLATE=.55,STACK_FADE_MS=180,STACK_LINE=.5,STACK_SLACK=10;   // the plate under each floor; one floor's fade; the reading line (share of screen height) and its slack in px
function stackComposite(names,facade){
  const rooms=[];let lift=0;
  names.map(n=>mountRoom(n)).filter(Boolean).forEach((m,k)=>{
    rooms.push({name:m.name,m,st:m.st,rm:m.rm,fps:m.fps,k,clip:clipFor({nw:true,ne:true},m.w,m.d,m.wall),
      floor:[P(0,0),P(m.w,0),P(m.w,m.d),P(0,m.d)],off:[0,-lift],
      mid:(P(0,0,m.wall)[1]+P(m.w,m.d,0)[1])/2});                 // the middle of the floor as drawn, walls included
    lift+=(m.wall+STACK_PLATE)*TZ});
  const fm=facade?mountRoom(facade):null;
  const F=fm?{name:fm.name,m:fm,st:fm.st,rm:fm.rm,fps:fm.fps,clip:clipFor({nw:true,ne:true},fm.w,fm.d,fm.wall)}:null;
  let bx0=1/0,by0=1/0,bx1=-1/0,by1=-1/0;
  for(const r of rooms)for(const [x,y] of r.clip){bx0=Math.min(bx0,x+r.off[0]);bx1=Math.max(bx1,x+r.off[0]);by0=Math.min(by0,y+r.off[1]);by1=Math.max(by1,y+r.off[1])}
  return {rooms,facade:F,bx0,by0,BW:bx1-bx0,BH:by1-by0,ground:rooms.slice(0,1)};
}
/* how open each floor is when floor x (counted from the bottom, continuous) is the open one:
   alpha fades a floor above x out; walls fade a floor's facade out as it becomes x */
const floorAlpha=(k,x)=>Math.max(0,Math.min(1,1-(k-x))),facadeAlpha=(k,x)=>Math.max(0,Math.min(1,x-k));

/* Scale settings for a device scale k (device px per world px).
   bucket: bake the static layers at the size they are shown, not the engine's
   minimum (on a phone that minimum was 2.5x too many pixels).
   patK: draw halftone tiles at screen resolution so the dots don't alias. */
function scaleFor(k){
  const engineDpr=Math.min(2,window.devicePixelRatio||1);
  const bucket=Math.ceil(Math.min(4,k)/engineDpr*20)/20;           // rounded up to the next 5%
  const cell=(globalThis.DIORAMA_TEXTURE||{}).cell??1;              // a finer screen needs finer tiles
  const patK=Math.min(5,Math.max(1,Math.ceil(k*cell*2)/2));
  return {bucket,patK};
}
function applyPatK(patK){
  const T=globalThis.DIORAMA_TEXTURE||(globalThis.DIORAMA_TEXTURE={});
  if(T.patK===patK)return;
  T.patK=patK;
  if(typeof PATTERN_CANVAS!=='undefined')PATTERN_CANVAS.clear();   // tiles at the old scale are dead weight
}
/* soft contact shadows. A blur loses nothing at a quarter of the size: 1/16th the pixels */
const SH=.25;
function bakeShadow(C,k0,W,H){
  const sh=document.createElement('canvas');sh.width=Math.ceil(W*SH);sh.height=Math.ceil(H*SH);
  const c=sh.getContext('2d'),far=100000,k=k0*SH;
  c.setTransform(k,0,0,k,-C.bx0*k,-C.by0*k);
  c.shadowColor='rgba(11,46,33,.24)';c.shadowBlur=46*k;c.shadowOffsetX=far*k;c.shadowOffsetY=22*k;
  c.fillStyle='#000';
  for(const r of C.rooms){path(c,r.floor,r.off[0]-far,r.off[1]+10);c.fill()}
  return sh;
}
function drawAll(ctx,C,k,t,boilOn,bucket,shadow,patK){
  if(patK)globalThis.DIORAMA_TEXTURE.patK=patK;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  if(shadow)ctx.drawImage(shadow,0,0,ctx.canvas.width,ctx.canvas.height);
  for(const r of C.rooms){
    ctx.setTransform(k,0,0,k,(r.off[0]-C.bx0)*k,(r.off[1]-C.by0)*k);
    ctx.save();path(ctx,r.clip,0,0);ctx.clip();
    try{r.st.drawScene(ctx,t,boilOn?Math.floor(t*r.fps)%3:0,bucket)}catch(e){console.error('quad '+r.name+' '+e.message)}
    ctx.restore();
  }
}

/* one still frame of the hero into any canvas. Used by tools/build-poster.py and tools/texture-compare.html */
function renderStill(canvas,o={}){
  const C=heroComp(),cssW=o.cssWidth||1320,dpr=o.dpr||1,t=o.t??POSTER_T;
  if(o.tex){Object.assign(globalThis.DIORAMA_TEXTURE,o.tex);
    if(typeof PATTERN_CANVAS!=='undefined')PATTERN_CANVAS.clear();
    dispatchEvent(new Event('resize'))}                              // every room drops its bakes
  const k=cssW/C.BW*dpr,{bucket,patK}=scaleFor(k);
  if(!(o.tex&&'patK' in o.tex))applyPatK(patK);
  canvas.width=Math.round(C.BW*k);canvas.height=Math.round(C.BH*k);
  drawAll(canvas.getContext('2d'),C,k,t,o.boil!==false,bucket,bakeShadow(C,k,canvas.width,canvas.height));
  return {k,bucket,patK:globalThis.DIORAMA_TEXTURE.patK,width:canvas.width,height:canvas.height};
}
/* one whole room, floating on its own shadow, into any canvas. Used by tools/stills.html */
function renderRoomStill(canvas,name,rm,o={}){
  const m=mountRoom(name,rm),cssW=o.cssWidth||520,dpr=o.dpr||1,t=o.t??POSTER_T;
  /* tight: crop just above the walls, for rooms with nothing rising over them */
  const clip=clipFor(o.tight?{nw:true,ne:true}:{nw:false,ne:false},m.w,m.d,m.wall),floor=[P(0,0),P(m.w,0),P(m.w,m.d),P(0,m.d)];
  const b=bbox(clip);b.y1+=70;b.x0-=40;b.x1+=40;b.y0-=6;            // room for the shadow
  const W=b.x1-b.x0,k=cssW/W*dpr,{bucket,patK}=scaleFor(k);applyPatK(patK);
  canvas.width=Math.round(W*k);canvas.height=Math.round((b.y1-b.y0)*k);
  const c=canvas.getContext('2d'),far=100000;
  c.setTransform(k,0,0,k,-b.x0*k,-b.y0*k);
  c.save();c.shadowColor='rgba(11,46,33,.26)';c.shadowBlur=46*k;c.shadowOffsetX=far*k;c.shadowOffsetY=22*k;
  c.fillStyle='#000';path(c,floor,-far,10);c.fill();c.restore();
  c.save();path(c,clip,0,0);c.clip();m.st.drawScene(c,t,o.boil??0,bucket);c.restore();
  return {k,bucket,patK,width:canvas.width,height:canvas.height};
}
/* a close-up of one moment in a room: camera on (i,j,z), `zoom` CSS px per world px. Used by tools/stills.html */
function renderFocusStill(canvas,name,rm,o={}){
  const m=mountRoom(name,rm),W=o.cssWidth||440,Hh=o.cssHeight||300,dpr=o.dpr||1,t=o.t??POSTER_T,[fi,fj,fz]=o.focus||[6,6,1];
  const kk=(o.zoom||1.25)*dpr,{bucket,patK}=scaleFor(kk);applyPatK(patK);
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(Hh*dpr);
  const c=canvas.getContext('2d'),[fx,fy]=P(fi,fj,fz);
  c.setTransform(kk,0,0,kk,canvas.width/2-fx*kk,canvas.height/2-fy*kk);
  m.st.drawScene(c,t,o.boil??0,bucket);
  return {k:kk,bucket,patK,width:canvas.width,height:canvas.height};
}
/* the building as it first appears (top floor open, the rest closed), into any canvas.
   Used by tools/stack-poster.html, so the still and the live canvas match at the crossfade */
function renderStackStill(canvas,names,o={}){
  const C=stackComposite(names,o.facade),cssW=o.cssWidth||460,dpr=o.dpr||1,t=o.t??POSTER_T,n=C.rooms.length;
  const kk=cssW/C.BW*dpr,{bucket,patK}=scaleFor(kk);applyPatK(patK);
  canvas.width=Math.round(C.BW*kk);canvas.height=Math.round(C.BH*kk);
  const c=canvas.getContext('2d'),G={...C,rooms:C.ground};
  c.drawImage(bakeShadow(G,kk,canvas.width,canvas.height),0,0,canvas.width,canvas.height);
  const paint=(r,off)=>{c.setTransform(kk,0,0,kk,(off[0]-C.bx0)*kk,(off[1]-C.by0)*kk);c.save();path(c,r.clip,0,0);c.clip();
    r.st.drawScene(c,t,o.boil!==false?Math.floor(t*r.fps)%3:0,bucket);c.restore()};
  C.rooms.forEach((r,k)=>{paint(r,r.off);if(C.facade&&facadeAlpha(k,n-1)>0)paint(C.facade,r.off)});
  return {k:kk,bucket,patK,width:canvas.width,height:canvas.height};
}
window.BL_QUAD={renderStill,renderRoomStill,renderFocusStill,renderStackStill,POSTER_T,status:()=>({state:'poster'})};

/* ====================================================================== */
/*  Live views                                                             */
/* ====================================================================== */
const views=[];
const heroCv=document.querySelector('canvas[data-quad]');
if(heroCv)views.push({type:'quad',el:heroCv,wrap:heroCv.parentNode});
for(const el of document.querySelectorAll('canvas[data-room-view]'))
  views.push({type:'room',el,wrap:el.closest('.scene')||el.parentNode,room:el.dataset.roomView,
    focus:(el.dataset.focus||'6,6,1').split(',').map(Number),whole:el.hasAttribute('data-whole')});
const tourCv=document.querySelector('canvas[data-tour]');
if(tourCv)views.push({type:'tour',el:tourCv,wrap:tourCv.closest('[data-tour-wrap]')||tourCv.parentNode,
  steps:[...document.querySelectorAll('[data-tour-step]')],dots:[...document.querySelectorAll('[data-tour-dot]')],
  pos:-1,active:null,next:null,snaps:new Map(),liveCv:null,liveOf:null,dirty:true});
const stackCv=document.querySelector('canvas[data-stack]');
if(stackCv)views.push({type:'stack',el:stackCv,wrap:stackCv.closest('[data-stack-wrap]')||stackCv.parentNode,
  floors:(stackCv.dataset.floors||'').split(',').map(x=>x.trim()).filter(Boolean),facade:stackCv.dataset.facade||'',
  x:-1,active:null,next:null,snaps:new Map(),facadeSnap:null,liveCv:null,liveOf:null,dirty:true});
if(!views.length)return;
for(const v of views){v.ctx=v.el.getContext('2d');v.visible=false;v.near=false}
const hero=views.find(v=>v.type==='quad'),tour=views.find(v=>v.type==='tour'),stack=views.find(v=>v.type==='stack');

/* ---- clicks open a room on its own (drag, zoom, look around) ---- */
const open=name=>{const meta=window.BL_ROOMS&&window.BL_ROOMS[name];
  if(meta&&window.BL_openScene)window.BL_openScene(base+'dioramas/'+meta.file,meta.label)};
if(hero){
  const hitRooms=HERO.map(([name,slot])=>{const L=SLOT[slot];return {name,clip:clipFor(L.inner,12,12,3.4),off:P(L.oi,L.oj)}});
  const hb=(()=>{let x0=1/0,y0=1/0,x1=-1/0;
    for(const r of hitRooms)for(const [x,y] of r.clip){x0=Math.min(x0,x+r.off[0]);x1=Math.max(x1,x+r.off[0]);y0=Math.min(y0,y+r.off[1])}
    return {x0,y0,W:x1-x0}})();
  const roomAt=e=>{
    const b=hero.wrap.getBoundingClientRect(),x0=COMP?COMP.bx0:hb.x0,y0=COMP?COMP.by0:hb.y0,W=COMP?COMP.BW:hb.W;
    const z=b.width/W,x=(e.clientX-b.left)/z+x0,y=(e.clientY-b.top)/z+y0;
    const rs=COMP?COMP.rooms:hitRooms;
    for(let n=rs.length-1;n>=0;n--){const r=rs[n];
      if(pip_(r.clip.map(p=>[p[0]+r.off[0],p[1]+r.off[1]]),x,y))return r}
    return null};
  hero.wrap.addEventListener('mousemove',e=>{hero.wrap.style.cursor=roomAt(e)?'zoom-in':''});
  hero.wrap.addEventListener('click',e=>{const r=roomAt(e);if(r)open(r.name)});
}
for(const v of views)if(v.type==='room'){v.el.style.cursor='zoom-in';v.el.addEventListener('click',()=>open(v.room))}
if(tour){tour.el.style.cursor='zoom-in';tour.el.addEventListener('click',()=>{if(tour.active)open(tour.active.name)})}
if(stack){stack.el.style.cursor='zoom-in';stack.el.addEventListener('click',()=>{if(stack.active)open(stack.active.name)})}

/* ---- who gets what ---- */
const qs=new URLSearchParams(location.search),force=qs.get('quad')||'';
const nav=navigator,conn=nav.connection||{};
const reduce=!force&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowMem=nav.deviceMemory&&nav.deviceMemory<=2;
const stillOnly=force==='still'||(!force&&(conn.saveData||lowMem))||(reduce&&views.length===1&&hero);
if(stillOnly){
  for(const v of views)if(v!==hero)v.wrap.classList.add('scene-off');   // pages style a quiet placeholder
  window.BL_QUAD.status=()=>({state:'poster',why:force==='still'?'forced':reduce?'reduced motion':conn.saveData?'data saver':'low memory'});
  return;
}

/* The ladder. Each rung is cheaper than the last; we only ever step down.
   share = how much of each animation frame the rooms may spend drawing. Most of
   the cost is script (wobbly paths, figures), not pixels, so fps is the big lever
   and resolution a small one; memory is where resolution pays. */
const LEVELS=[
  {fps:30,hiDpr:true, boil:true, share:.45},   // L0: full quality
  {fps:20,hiDpr:true, boil:true, share:.45},   // L1: fewer frames
  {fps:20,hiDpr:false,boil:true, share:.45},   // L2: 1x resolution, a quarter of the pixels and memory on retina
  {fps:15,hiDpr:false,boil:false,share:.5},    // L3: no shimmer, one bake per room instead of three
  {fps:0, hiDpr:false,boil:false},             // L4: frozen (the tour still pans with the scroll)
];
const budget=l=>1000/LEVELS[l].fps*LEVELS[l].share;
const guess=(ms,from,to)=>ms*(LEVELS[from].hiDpr&&!LEVELS[to].hiDpr?.9:1)*(LEVELS[from].boil&&!LEVELS[to].boil?.9:1);
let level=/^L[0-4]$/.test(force)?+force[1]
  :((nav.deviceMemory&&nav.deviceMemory<=4)||(nav.hardwareConcurrency&&nav.hardwareConcurrency<=4))?2:0;

let HC=null,TC=null,k=1,zoom=1,dpr=1,bucket=.75,patKH=2,heroShadow=null,tourShadow=null;
let kT=1,tzoom=1,bucketT=.75,patKT=2,TOUR_OWN=new Set();   // the tour's own scale, for rooms only it shows
let SCM=null,kS=1,szoom=1,bucketS=.75,patKS=2,STACK_OWN=new Set(),stackShadow=null;   // and the stack's
let live=false,raf=0,lastAnim=0,tLive=0,tHold=POSTER_T,skip=0,busy=false,need=12;
const win=[],stats={bakesMs:[],steps:[],evictions:0,composites:0};
const now_=()=>performance.now();
const tNow=()=>LEVELS[level].fps&&!reduce&&raf?POSTER_T+(now_()-tLive)/1000:tHold;
const boilOn=()=>LEVELS[level].boil!==false&&!reduce;
const variants=()=>boilOn()?[0,1,2]:[0];

/* ---- scale: every view shares the hero's (or the page's, if there is no hero) ---- */
function size(){
  const L=LEVELS[level];dpr=L.hiDpr===false?1:Math.min(2,window.devicePixelRatio||1);
  const C0=HC||TC||SCM;if(!C0)return;
  const refW=hero?hero.wrap.clientWidth:Math.min(1320,document.documentElement.clientWidth);if(!refW)return;
  zoom=refW/C0.BW;k=zoom*dpr;
  const s=scaleFor(k);bucket=s.bucket;patKH=s.patK;
  if(TC){const fit=fitTour(tour);tzoom=TOUR_OWN.size?Math.min(TOUR_MAX,Math.max(zoom,fit)):zoom;
    kT=tzoom*dpr;const st=scaleFor(kT);bucketT=st.bucket;patKT=st.patK}
  if(SCM){const w=stack.wrap.clientWidth||460;szoom=STACK_OWN.size?Math.min(TOUR_MAX,w/SCM.BW):zoom;kS=szoom*dpr;
    const ss=scaleFor(kS);bucketS=ss.bucket;patKS=ss.patK;
    const sh=Math.round(SCM.BH*szoom);stack.el.style.height=sh+'px';        // the canvas is as tall as the building
    /* pinned travel: a third of a screen per floor (data-travel overrides), centred while pinned */
    const col=stack.wrap.parentNode,per=+(stack.el.dataset.travel||0)||innerHeight*.32;
    if(getComputedStyle(stack.wrap).position==='sticky'){
      stack.wrap.style.top=Math.max(24,Math.round((innerHeight-sh)/2))+'px';
      col.style.minHeight=Math.round(sh+per*Math.max(0,SCM.rooms.length-1))+'px'}
    else{stack.wrap.style.top='';col.style.minHeight=''}}
  if(typeof PATTERN_CANVAS!=='undefined')PATTERN_CANVAS.clear();   // halftone tiles at the old scale are dead weight
  for(const v of views){
    if(v.type==='quad'){v.el.width=Math.round(HC.BW*k);v.el.height=Math.round(HC.BH*k)}
    else if(v.type==='stack'){v.el.width=Math.round(SCM.BW*kS);v.el.height=Math.round(SCM.BH*kS)}
    else{v.el.width=Math.round(v.el.clientWidth*dpr);v.el.height=Math.round(v.el.clientHeight*dpr)}}
  if(HC)heroShadow=bakeShadow(HC,k,Math.round(HC.BW*k),Math.round(HC.BH*k));
  if(TC)tourShadow=bakeShadow(TC,kT,Math.round(TC.BW*kT),Math.round(TC.BH*kT));
  if(SCM)stackShadow=bakeShadow({...SCM,rooms:SCM.ground},kS,Math.round(SCM.BW*kS),Math.round(SCM.BH*kS));
  for(const m of MOUNTS.values())m.baked=false;   // the scale changed: every cached layer is the wrong size
  if(tour){tour.snaps.clear();tour.liveCv=null;tour.liveOf=null;tour.dirty=true}
  if(stack){stack.snaps.clear();stack.facadeSnap=null;stack.liveCv=null;stack.liveOf=null;stack.dirty=true}
  skip=6;
}

/* each room bakes at the scale of the view that shows it. The halftone tiles are cached
   per scale, so pointing the engine at one scale or the other costs nothing */
const bucketOf=m=>TOUR_OWN.has(m.name)?bucketT:STACK_OWN.has(m.name)?bucketS:bucket;
const usePat=m=>{const T=globalThis.DIORAMA_TEXTURE;if(T)T.patK=TOUR_OWN.has(m.name)?patKT:STACK_OWN.has(m.name)?patKS:patKH};

/* ---- residency: which rooms keep their cached layers ---- */
const idle=(ms=200)=>new Promise(r=>'requestIdleCallback' in window?requestIdleCallback(()=>r(),{timeout:ms}):setTimeout(r,16));
const scratch=(()=>{const c=document.createElement('canvas');c.width=c.height=1;return c.getContext('2d')})();
/* our own baking stretches the gaps between frames; the ladder must not read that as a slow device */
const hush=()=>{skip=Math.max(skip,4);win.length=0;lastAnim=0};
function wanted(){
  const w=new Set();
  for(const v of views){if(!v.near)continue;
    if(v.type==='quad')HC.rooms.forEach(r=>w.add(r.name));
    else if(v.type==='room')w.add(v.room);
    else if(v.type==='tour'||v.type==='stack'){if(v.active)w.add(v.active.name);if(v.next)w.add(v.next.name)}}
  return w;
}
/* bake a room: one shimmer variant per idle slice, so no single task is long */
function warm(m){
  if(m.baked)return Promise.resolve();
  if(m.warming)return m.warming;
  const b=bucketOf(m);
  return m.warming=(async()=>{
    for(const vr of variants()){await idle();const s0=now_();hush();usePat(m);
      try{m.st.drawScene(scratch,tHold,vr,b)}catch(e){}
      stats.bakesMs.push(Math.round(now_()-s0));if(stats.bakesMs.length>24)stats.bakesMs.shift()}
    if(b===bucketOf(m))m.baked=true;m.warming=null;
    if(tour)tour.dirty=true;
  })();
}
/* Residency runs on a memory budget. Rooms on screen (or about to be) are always
   kept. Beyond that, rooms stay cached while the total fits the budget, and the
   tour's rooms are pre-baked in idle time as it approaches, so nothing re-bakes
   mid-scroll. Over budget, the least recently used rooms let go first. On a phone
   every room fits; on a retina laptop the hero's rooms make way for the tour's. */
const BUDGET_MB=nav.deviceMemory?Math.min(160,nav.deviceMemory*20):110;
/* pre-bake only where it pays: rooms that are cheap to keep (phones, 1x screens) or a
   device whose bakes are slow enough to hitch a scroll. A fast retina laptop bakes a room
   in ~20-60 ms between frames, so it keeps just the rooms in reach and stays light. */
const avgBake=()=>stats.bakesMs.length?stats.bakesMs.reduce((a,b)=>a+b,0)/stats.bakesMs.length:0;
const worthPrefetching=m=>roomMB(m)<10||avgBake()>45;
function roomMB(m){const B=m.st.B,ratio=Math.min(bucketOf(m)*Math.min(2,window.devicePixelRatio||1),4);
  return (B.x1-B.x0)*ratio*(B.y1-B.y0)*ratio*4*variants().length*(1+(typeof m.rm.over==='function'?1:0))/1e6}
function prefetch(){                                // the tour's rooms, nearest stop first
  if(!tour||!tour.near||!TC)return [];
  const p=Math.max(0,tour.pos);
  return tourRooms().map((r,i)=>[Math.abs(i-p),r.m]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
}
let managing=false,again=false;
async function manage(){
  if(!live)return;if(managing){again=true;return}managing=true;
  try{
    const w=wanted(),t=now_(),pre=prefetch().filter(m=>!w.has(m.name)&&worthPrefetching(m));
    for(const m of MOUNTS.values())if(w.has(m.name))m.lastWanted=t;
    const resident=()=>[...MOUNTS.values()].filter(m=>m.baked).reduce((a,m)=>a+roomMB(m),0);
    for(const m of MOUNTS.values())if(w.has(m.name)&&!m.baked)await warm(m);
    /* make room: least recently wanted first, never a room on screen or queued to pre-bake */
    const need=pre.filter(m=>!m.baked).reduce((a,m)=>a+roomMB(m),0);
    const spare=[...MOUNTS.values()].filter(m=>m.baked&&!w.has(m.name)&&!pre.includes(m)&&t-m.lastWanted>1500)
      .sort((a,b)=>a.lastWanted-b.lastWanted);
    while(spare.length&&resident()+need>BUDGET_MB){const m=spare.shift();m.st.dropBakes();m.baked=false;stats.evictions++}
    for(const m of pre){if(m.baked)continue;if(resident()+roomMB(m)>BUDGET_MB)break;await warm(m)}
    if(tour&&tour.near)await tourSnaps();
    if(stack&&stack.near)await stackSnaps();
  }finally{managing=false}
  if(again){again=false;manage()}
}
setInterval(()=>{if(live)manage()},1000);

/* ---- one room, camera centred on a point in the room ---- */
const wholeClip=m=>m.wc||(m.wc=clipFor({nw:false,ne:false},m.w,m.d,m.wall));
function drawRoomView(v,t){
  const m=MOUNTS.get(v.room);if(!m||!m.baked)return;
  const c=v.ctx,W=v.el.width,H=v.el.height,[fx,fy]=P(v.focus[0],v.focus[1],v.focus[2]||0);
  const ox=W/2-fx*k,oy=H/2-fy*k;
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,W,H);
  c.setTransform(k,0,0,k,ox,oy);
  if(v.whole){c.save();path(c,wholeClip(m),0,0);c.clip()}
  usePat(m);
  try{m.st.drawScene(c,t,boilOn()?Math.floor(t*m.fps)%3:0,bucket)}catch(e){console.error('view '+v.room+' '+e.message)}
  if(v.whole)c.restore();
}

/* ---- the tour ---- */
const smooth=x=>x<=0?0:x>=1?1:x*x*(3-2*x);
const TOUR_MAX=1;                    // 1:1 with the room's own drawing: past this it is just bigger pixels
/* the room's floor and walls (plus a unit above them for whatever pokes over) */
const bodyOf=r=>r.body||(r.body=bbox([P(0,0,r.m.wall+1),P(r.m.w,0,r.m.wall+1),P(0,r.m.d,r.m.wall+1),P(r.m.w,r.m.d,0),P(0,r.m.d,0),P(r.m.w,0,0)]));
const centre=r=>{const b=bodyOf(r);return [r.off[0]+(b.x0+b.x1)/2,r.off[1]+(b.y0+b.y1)/2]};
/* How big the tour's room can be: the free space beside the cards (desktop) or above
   them (phone), below the chips. Sets the stage's anchor to the middle of that space. */
function fitTour(v){
  const stage=v.el.getBoundingClientRect(),W=stage.width,H=stage.height;if(!W||!H)return 0;
  const cards=v.steps.map(el=>el.querySelector('.card')||el);
  const dots=v.wrap.querySelector('.tour-dots'),top=dots?dots.getBoundingClientRect().bottom-stage.top:0;
  const pad=Math.max(16,Math.min(40,W*.03));
  let right=0,cardTop=H;
  const deck=v.wrap.querySelector('[data-deck]');     // a page can hold its cards in a stack inside the stage instead
  if(deck){const r=deck.getBoundingClientRect();right=r.right-stage.left;cardTop=r.top-stage.top}
  else for(const [i,c] of cards.entries()){const r=c.getBoundingClientRect();
    right=Math.max(right,r.left-stage.left+c.offsetWidth);
    cardTop=Math.min(cardTop,c.offsetTop-v.steps[i].offsetTop)}  // layout offsets: a card's entrance transform doesn't count
  const side=right<W*.62;
  const f=side?{x0:right+pad,x1:W-pad,y0:top+pad*.6,y1:H-pad}:{x0:pad*.6,x1:W-pad*.6,y0:top+8,y1:cardTop-pad*.6};
  v.el.dataset.anchorX=((f.x0+f.x1)/2/W).toFixed(4);v.el.dataset.anchorY=((f.y0+f.y1)/2/H).toFixed(4);
  let bw=0,bh=0;for(const r of tourRooms()){const b=bodyOf(r);bw=Math.max(bw,b.x1-b.x0);bh=Math.max(bh,b.y1-b.y0)}
  return bw&&bh?Math.max(0,Math.min((f.x1-f.x0)/bw,(f.y1-f.y0)/bh)):0;
}
function tourPos(v){
  /* the stage's whole pinned travel maps to cards 0..n-1, however tall the steps are
     (with full-screen steps this is exactly -top/vh, as before) */
  const b=v.wrap.getBoundingClientRect(),n=v.steps.length,vh=window.innerHeight;
  return Math.max(0,Math.min(n-1,-b.top/Math.max(1,b.height-vh)*(n-1)));
}
let TROOMS=null;
const tourRooms=()=>TROOMS||(TROOMS=tour.steps.map(el=>TC.rooms.find(r=>r.name===el.dataset.tourStep)).filter(Boolean));
/* a room at the tour's scale, clipped to its outline, into its own canvas */
function sizeRoomCanvas(r,cv,kk=kT){
  const b=r.bb||(r.bb=bbox(r.clip));
  const W=Math.ceil((b.x1-b.x0)*kk),H=Math.ceil((b.y1-b.y0)*kk);
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
  return b;
}
function renderRoomInto(r,cv,t,kk=kT){
  const b=sizeRoomCanvas(r,cv,kk),c=cv.getContext('2d');
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,cv.width,cv.height);
  c.setTransform(kk,0,0,kk,-b.x0*kk,-b.y0*kk);
  c.save();path(c,r.clip,0,0);c.clip();usePat(r.m);
  try{r.st.drawScene(c,t,boilOn()?Math.floor(t*r.fps)%3:0,bucketOf(r.m))}catch(e){}
  c.restore();
}
/* snapshots of every tour room, made once per scale. A snapshot needs one shimmer
   variant, not three: draw it in its own idle slice (which bakes just that one), and
   let the bake go again unless the room is resident anyway. */
let snapping=false;
async function tourSnaps(){
  if(snapping||!TC)return;snapping=true;
  try{for(const r of tourRooms()){
    if(tour.snaps.has(r.name))continue;
    await idle();hush();
    const cv=document.createElement('canvas');renderRoomInto(r,cv,tHold);tour.snaps.set(r.name,cv);tour.dirty=true;
    if(!r.m.baked&&!r.m.warming)r.m.st.dropBakes();
  }}finally{snapping=false}
}
function updateTourFocus(v){
  if(!TC)return;
  const raw=tourPos(v),rooms=tourRooms(),n=rooms.length;if(!n)return;
  if(Math.abs(raw-v.pos)>1e-4){v.pos=raw;v.dirty=true}
  const ai=Math.round(raw),a=rooms[ai];
  const dir=raw-ai,ni=Math.max(0,Math.min(n-1,ai+(dir>=0?1:-1)));
  const nx=Math.abs(dir)>.15&&ni!==ai?rooms[ni]:null;              // warm the room we are heading to
  if(nx!==v.next){v.next=nx;if(nx)manage()}
  if(a!==v.active){
    /* the room leaving focus keeps its last live pose as its snapshot */
    if(v.liveCv&&v.liveOf){const s=document.createElement('canvas');
      s.width=v.liveCv.width;s.height=v.liveCv.height;s.getContext('2d').drawImage(v.liveCv,0,0);v.snaps.set(v.liveOf.name,s)}
    v.active=a;v.liveOf=null;v.dirty=true;
    v.steps.forEach((el,i)=>el.classList.toggle('on',i===ai));
    v.dots.forEach((el,i)=>el.classList.toggle('on',i===ai));
    manage();
  }
}
function animateTour(v,t){
  const a=v.active;if(!a||!a.m.baked)return;
  if(!v.liveCv)v.liveCv=document.createElement('canvas');
  renderRoomInto(a,v.liveCv,t);v.liveOf=a;v.dirty=true;
}
function compositeTour(v){
  if(!v.dirty||!TC)return;v.dirty=false;stats.composites++;
  const c=v.ctx,W=v.el.width,H=v.el.height,rooms=tourRooms(),n=rooms.length;if(!n)return;
  const raw=Math.max(0,v.pos),i0=Math.min(n-1,Math.floor(raw)),f=reduce?Math.round(raw-i0):smooth((raw-i0-.2)/.6),pos=i0+f;
  const A=centre(rooms[i0]),B=centre(rooms[Math.min(n-1,i0+1)]);
  const camX=A[0]+(B[0]-A[0])*f,camY=A[1]+(B[1]-A[1])*f;
  const ax=+(v.el.dataset.anchorX||.5),ay=+(v.el.dataset.anchorY||.5);
  const ox=W*ax-camX*kT,oy=H*ay-camY*kT;
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,W,H);
  if(tourShadow){c.globalAlpha=.8;c.drawImage(tourShadow,ox+TC.bx0*kT,oy+TC.by0*kT,TC.BW*kT,TC.BH*kT);c.globalAlpha=1}
  for(const r of TC.rooms){
    let w=0;rooms.forEach((rr,i)=>{if(rr===r)w=Math.max(w,1-Math.abs(pos-i))});
    const img=(v.liveOf===r&&v.liveCv)?v.liveCv:v.snaps.get(r.name);if(!img)continue;
    const b=r.bb||(r.bb=bbox(r.clip));
    c.globalAlpha=.16+.84*smooth(w);
    c.drawImage(img,Math.round(ox+(r.off[0]+b.x0)*kT),Math.round(oy+(r.off[1]+b.y0)*kT));
  }
  c.globalAlpha=1;
  if(!v.ready&&v.snaps.size){v.ready=true;v.wrap.classList.add('live')}
}

/* ---- the stack ---- */
/* Which floor is open: the highest floor whose middle is still below the reading line (the
   middle of the screen). A floor closes when its own middle crosses the line, so every
   floor goes at the same height on screen, however far down the building it is. A few
   pixels of slack stop it flickering when a floor sits right on the line. */
function stackTarget(v){
  const rooms=SCM.rooms,n=rooms.length,b=v.el.getBoundingClientRect(),line=innerHeight*STACK_LINE;
  const cy=k=>b.top+(rooms[k].off[1]+rooms[k].mid-SCM.by0)*szoom;
  let t=0;for(let k=n-1;k>=0;k--)if(cy(k)>line){t=k;break}
  const cur=v.target;
  if(cur!==undefined&&t!==cur){
    if(t<cur&&cy(cur)>line-STACK_SLACK)t=cur;            // closing the open floor: it must be clearly past the line
    else if(t>cur&&cy(t)<line+STACK_SLACK)t=cur}         // reopening one above: clearly back below it
  return v.target=t;
}
function updateStackFocus(v){
  if(!SCM)return;
  const rooms=SCM.rooms,n=rooms.length;if(!n)return;
  /* the scroll picks the floor; the change itself is a short fade in time, whatever the
     scroll speed. A fast scroll past several floors fades through each in turn. */
  const target=n>1?stackTarget(v):n-1,now=now_(),dt=Math.min(100,now-(v.tLast||now));v.tLast=now;
  if(v.xt===undefined||v.x<0||reduce)v.xt=target;
  else if(v.xt!==target){const step=dt/STACK_FADE_MS;v.xt=v.xt<target?Math.min(target,v.xt+step):Math.max(target,v.xt-step)}
  const i0=Math.floor(v.xt),x=i0+smooth(v.xt-i0);                    // eased within each fade
  if(Math.abs(x-v.x)>1e-4){v.x=x;v.dirty=true}
  const ai=Math.round(x),a=rooms[ai],oi=x<ai?ai-1:x>ai?ai+1:-1;
  /* keep the next floor down baked while this one is open, so opening it never waits on a bake */
  const nx=Math.abs(x-ai)>.02&&oi>=0&&oi<n?rooms[oi]:ai>0?rooms[ai-1]:null;
  if(nx!==v.next){v.next=nx;if(nx)manage()}
  if(a!==v.active){
    if(v.liveCv&&v.liveOf){const s=document.createElement('canvas');                  // it holds its last live pose
      s.width=v.liveCv.width;s.height=v.liveCv.height;s.getContext('2d').drawImage(v.liveCv,0,0);v.snaps.set(v.liveOf.name,s)}
    v.active=a;v.liveOf=null;v.dirty=true;manage()}
}
function animateStack(v,t){
  const a=v.active;if(!a||!a.m.baked)return;
  if(!v.liveCv)v.liveCv=document.createElement('canvas');
  renderRoomInto(a,v.liveCv,t,kS);v.liveOf=a;v.dirty=true;
}
let stackSnapping=false;
async function stackSnaps(){
  if(stackSnapping||!SCM)return;stackSnapping=true;
  try{
    for(const r of SCM.rooms){
      if(stack.snaps.has(r.name))continue;
      await idle();hush();const s0=now_();
      const cv=document.createElement('canvas');renderRoomInto(r,cv,tHold,kS);stack.snaps.set(r.name,cv);stack.dirty=true;
      (stats.snapMs=stats.snapMs||[]).push(r.name+':'+Math.round(now_()-s0));
      if(!r.m.baked&&!r.m.warming)r.m.st.dropBakes()}
    if(SCM.facade&&!stack.facadeSnap){                                  // one facade, drawn over every closed floor
      await idle();hush();const s0=now_();
      const cv=document.createElement('canvas');renderRoomInto(SCM.facade,cv,tHold,kS);stack.facadeSnap=cv;stack.dirty=true;
      (stats.snapMs=stats.snapMs||[]).push('facade:'+Math.round(now_()-s0));
      SCM.facade.m.st.dropBakes()}
  }finally{stackSnapping=false}
}
function compositeStack(v){
  if(!v.dirty||!SCM)return;v.dirty=false;stats.composites++;
  const c=v.ctx,x=Math.max(0,v.x);c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,v.el.width,v.el.height);
  if(stackShadow)c.drawImage(stackShadow,0,0,v.el.width,v.el.height);
  const at=(r,off)=>{const b=r.bb||(r.bb=bbox(r.clip));return [Math.round((off[0]+b.x0-SCM.bx0)*kS),Math.round((off[1]+b.y0-SCM.by0)*kS)]};
  let drew=0;
  SCM.rooms.forEach((r,k)=>{const al=floorAlpha(k,x);if(al<=0){drew++;return}
    const img=(v.liveOf===r&&v.liveCv)?v.liveCv:v.snaps.get(r.name);if(!img)return;
    c.globalAlpha=al;c.drawImage(img,...at(r,r.off));drew++;
    const wa=facadeAlpha(k,x);
    if(wa>0&&SCM.facade&&v.facadeSnap){c.globalAlpha=al*wa;c.drawImage(v.facadeSnap,...at(SCM.facade,r.off))}});
  c.globalAlpha=1;
  if(!v.ready&&drew===SCM.rooms.length&&(!SCM.facade||v.facadeSnap)){v.ready=true;v.wrap.classList.add('live')}
}

/* ---- the frame ---- */
const SLOW=+qs.get('slow')||0;
function animate(t){
  const s0=now_();
  for(const v of views){if(!v.visible)continue;
    if(v.type==='quad'){if(HC.rooms.every(r=>r.m.baked))drawAll(v.ctx,HC,k,t,boilOn(),bucket,heroShadow,patKH)}
    else if(v.type==='room')drawRoomView(v,t);
    else if(v.type==='stack')animateStack(v,t);
    else animateTour(v,t)}
  if(SLOW){const e=now_()+SLOW;while(now_()<e);}
  return now_()-s0;
}
function loop(now){
  raf=requestAnimationFrame(loop);
  const L=LEVELS[level];
  if(tour&&tour.visible)updateTourFocus(tour);
  if(stack&&stack.visible)updateStackFocus(stack);
  if(L.fps&&!reduce&&!busy){
    const iv=1000/L.fps;
    if(!lastAnim||now-lastAnim>=iv-4){
      const gap=lastAnim?now-lastAnim:iv;lastAnim=now;
      const dt=animate(POSTER_T+(now-tLive)/1000);
      if(skip>0)skip--;
      else{win.push([dt,gap]);
        if(win.length>=need){
          const avgDt=win.reduce((a,b)=>a+b[0],0)/win.length,avgGap=win.reduce((a,b)=>a+b[1],0)/win.length;
          stats.avgDrawMs=+avgDt.toFixed(1);stats.avgGapMs=+avgGap.toFixed(1);win.length=0;need=24;
          if(avgDt>budget(level)||avgGap>iv*1.6){
            /* jump to the first rung that should fit, but only freeze on a measurement: the guess
               can't see how much a 1x canvas saves, and a slow laptop often animates fine at L3 */
            let to=level+1;while(to<LEVELS.length-2&&guess(avgDt,level,to)>budget(to))to++;
            changeLevel(to,avgDt,avgGap)}}}
    }
  }
  if(tour&&tour.visible)compositeTour(tour);     // every display frame: the camera follows the scroll
  if(stack&&stack.visible)compositeStack(stack); // and the stack's focus follows it too
  if(!needsLoop())stop();
}
const anyVisible=()=>views.some(v=>v.visible);
const needsLoop=()=>live&&!document.hidden&&anyVisible()&&((LEVELS[level].fps&&!reduce)||(tour&&tour.visible)||(stack&&stack.visible));
function play(){if(!raf&&needsLoop()){lastAnim=0;skip=Math.max(skip,2);tLive=now_()-(tHold-POSTER_T)*1000;raf=requestAnimationFrame(loop)}}
function stop(){if(raf){tHold=POSTER_T+(now_()-tLive)/1000;cancelAnimationFrame(raf);raf=0}}
async function changeLevel(to,dt,gap){
  const was=level;tHold=tNow();level=to;
  stats.steps.push({from:'L'+was,to:'L'+to,drawMs:+dt.toFixed(1),gapMs:+gap.toFixed(1)});
  if(LEVELS[was].hiDpr!==LEVELS[to].hiDpr||LEVELS[was].boil!==LEVELS[to].boil){
    /* new resolution or no shimmer: rooms re-bake in idle slices while the last frame holds */
    busy=true;
    dispatchEvent(new Event('resize'));clearTimeout(size.t);      // the engine drops every room's bakes
    size();await manage();
    for(const v of views)if(v.visible&&v.type!=='tour'&&v.type!=='stack')animate(tHold);
    busy=false;
  }
  skip=6;lastAnim=0;need=12;win.length=0;
  stop();play();
}

/* a single-file build carries its scripts inline (window.BL_INLINE, from tools/make-monolith.py) */
function loadScript(src){return new Promise((ok,no)=>{const s=document.createElement('script');
  const inl=window.BL_INLINE&&window.BL_INLINE.script(src);
  s.src=inl?URL.createObjectURL(new Blob([inl],{type:'text/javascript'})):src;s.onload=ok;s.onerror=no;document.head.append(s)})}
async function start(){
  const ph=stats.phasesMs={},mark=(n,s0)=>ph[n]=Math.round(now_()-s0);
  if(document.readyState!=='complete')await new Promise(r=>addEventListener('load',r,{once:true}));
  await idle(2500);
  let s0=now_();
  if(!(window.BL_QUAD_ROOMS&&typeof mount==='function'))await loadScript(BUNDLE);
  if(tour&&tour.steps.some(el=>!(el.dataset.tourStep in window.BL_QUAD_ROOMS)))await loadScript(TOUR_BUNDLE).catch(()=>{});
  if(stack&&stack.floors.some(n=>!(n in window.BL_QUAD_ROOMS)))await loadScript(OFFICE_BUNDLE).catch(()=>{});
  if(stack&&stack.floors.some(n=>!(n in window.BL_QUAD_ROOMS)))await loadScript(TOUR_BUNDLE).catch(()=>{});   // stand-ins
  mark('bundle',s0);
  await idle();
  s0=now_();
  if(hero)HC=heroComp();
  if(tour){TC=composite(tour.steps.map((el,i)=>[el.dataset.tourStep,TOUR_SLOTS[i]]).filter(([n])=>window.BL_QUAD_ROOMS[n]));
    const shared=TC.rooms.some(r=>HC&&HC.rooms.some(h=>h.name===r.name));   // a tour of the hero's rooms keeps the hero's scale
    TOUR_OWN=new Set(shared?[]:TC.rooms.map(r=>r.name))}
  if(stack){SCM=stackComposite(stack.floors.filter(n=>window.BL_QUAD_ROOMS[n]),window.BL_QUAD_ROOMS[stack.facade]?stack.facade:'');
    const taken=new Set([...(HC?HC.rooms:[]),...(TC?TC.rooms:[])].map(r=>r.name));
    STACK_OWN=new Set(SCM.rooms.some(r=>taken.has(r.name))?[]:[...SCM.rooms.map(r=>r.name),...(SCM.facade?[SCM.facade.name]:[])]);
    if(!SCM.rooms.length)SCM=null}
  mark('mountRooms',s0);
  await idle();
  s0=now_();size();mark('sizeAndShadow',s0);
  live=true;
  for(const v of views)if(v.type!=='tour'&&v.type!=='stack')v.near=v.near||v.visible;
  await manage();
  s0=now_();
  for(const v of views)if(v.type!=='tour'&&v.type!=='stack'){v.ready=true;
    if(v.type==='quad'){if(HC.rooms.every(r=>r.m.baked))drawAll(v.ctx,HC,k,tHold,boilOn(),bucket,heroShadow,patKH)}
    else drawRoomView(v,tHold);
    v.wrap.classList.add('live')}
  mark('firstFrame',s0);
  if(hero)setTimeout(()=>hero.wrap.classList.add('done'),800);
  tLive=now_();play();
}

if('IntersectionObserver' in window){
  const seen=new IntersectionObserver(es=>{for(const e of es){const v=views.find(x=>x.wrap===e.target);if(v)v.visible=e.isIntersecting}
    if(anyVisible())play()},{rootMargin:'100px 0px'});
  const reach=new IntersectionObserver(es=>{for(const e of es){const v=views.find(x=>x.wrap===e.target);if(v)v.near=e.isIntersecting}
    manage()},{rootMargin:'900px 0px'});
  for(const v of views){seen.observe(v.wrap);reach.observe(v.wrap)}
}else views.forEach(v=>{v.visible=v.near=true});
document.addEventListener('visibilitychange',()=>{document.hidden?stop():play()});
addEventListener('resize',()=>{clearTimeout(size.t);size.t=setTimeout(()=>{if(live&&!busy){size();manage().then(()=>{if(!raf)for(const v of views)if(v.visible&&v.type!=='tour'&&v.type!=='stack')animate(tHold)})}},120)});
if(tour||stack)addEventListener('scroll',()=>{if(live)play()},{passive:true});

function bakedMB(){
  let mb=0;for(const m of MOUNTS.values())if(m.baked)mb+=roomMB(m);
  if(tour)for(const s of tour.snaps.values())mb+=s.width*s.height*4/1e6;
  if(stack)for(const s of stack.snaps.values())mb+=s.width*s.height*4/1e6;
  return +mb.toFixed(1)}
window.BL_QUAD.status=()=>({state:live?(reduce?'still (reduced motion)':LEVELS[level].fps?'live':'frozen'):'loading',level:'L'+level,...LEVELS[level],
  views:views.map(v=>v.type+(v.room?':'+v.room:'')+(v.visible?' (on screen)':'')),
  baked:[...MOUNTS.values()].filter(m=>m.baked).map(m=>m.name),
  tour:tour?{active:tour.active&&tour.active.name,next:tour.next&&tour.next.name,snapshots:tour.snaps.size,pos:+tour.pos.toFixed(2)}:undefined,
  deviceScale:+k.toFixed(2),bakeBucket:bucket,patK:patKH,
  tourScale:tour?{zoom:+tzoom.toFixed(3),heroZoom:+zoom.toFixed(3),deviceScale:+kT.toFixed(2),bakeBucket:bucketT,patK:patKT,own:TOUR_OWN.size>0,anchor:[tour.el.dataset.anchorX,tour.el.dataset.anchorY]}:undefined,
  stack:stack?{floors:SCM?SCM.rooms.map(r=>r.name):[],active:stack.active&&stack.active.name,next:stack.next&&stack.next.name,snapshots:stack.snaps.size,
    zoom:+szoom.toFixed(3),deviceScale:+kS.toFixed(2),own:STACK_OWN.size>0,open:+stack.x.toFixed(2),facade:!!stack.facadeSnap}:undefined,
  canvas:hero?hero.el.width+'x'+hero.el.height:'',bakedMB:bakedMB(),budgetMB:BUDGET_MB,...stats});
start().catch(e=>{console.warn('scenes stay on their still images:',e&&e.message)});
})();
