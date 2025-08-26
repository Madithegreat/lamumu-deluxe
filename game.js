/* =========================================================================
   Lamumu Deluxe — Single 10-min Survival (Reverse/Slow/Bomb)
   ========================================================================= */
(() => {
  const ASSET_BASE = "./assets/img/";

  const GAME = {
    durationSec: 10 * 60,
    canvasMarginTop: 56,
    ballRadius: 18,
    ballSpacing: 36.5,
    baseSpeed: 65,
    projectileSpeed: 600,
    insertDistanceThreshold: 17,
    powerupSpawnChance: 0.07,
    reverseDuration: 5.0,
    slowDuration: 7.0,
    slowFactor: 0.5,
    bombRadiusInBalls: 3,
    colors: [
      { name: "red" }, { name: "blue" }, { name: "yellow" },
      { name: "green" }, { name: "purple" },
    ],
    anchorsPct: [
      [0.08,0.30],[0.30,0.18],[0.55,0.32],[0.78,0.22],
      [0.90,0.43],[0.70,0.62],[0.45,0.56],[0.22,0.76],[0.10,0.94],
    ],
  };

  const DPR = Math.max(1, Math.min(2, devicePixelRatio || 1));
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp  = (a,b,t)=>a+(b-a)*t;

  // ---------- Root / HUD / Canvas ----------
  const root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;display:grid;grid-template-rows:auto 1fr;background:#1b5e20;color:#fff;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;user-select:none;overscroll-behavior:none;";
  document.body.style.margin = "0";
  document.body.appendChild(root);

  const hud = document.createElement("div");
  hud.style.cssText = "height:56px;display:flex;align-items:center;gap:12px;padding:8px 12px;background:linear-gradient(0deg,#0006,#0000);backdrop-filter:blur(3px);";
  hud.innerHTML = `
    <img id="logo" alt="logo" style="height:36px;opacity:.9;display:none" />
    <div class="pill" style="padding:.35rem .7rem;border-radius:999px;background:#ffffffe0;color:#111;font-weight:700">⏱ <span id="timer">10:00</span></div>
    <div class="pill" style="padding:.35rem .7rem;border-radius:999px;background:#ffffffe0;color:#111;font-weight:700">Score <span id="score">0</span></div>
    <div id="activePU" style="display:flex;gap:8px;align-items:center;margin-left:auto"></div>
  `;
  root.appendChild(hud);

  const canvas = document.createElement("canvas");
  canvas.id = "gameCanvas";
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;background:#2e7d32";
  root.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  // ---------- Overlay (Splash/End) with strict show/hide ----------
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;display:none;place-items:center;padding:20px;background:#0008;backdrop-filter:blur(2px);z-index:1200;";
  document.body.appendChild(overlay);

  const showOverlay = (html) => {
    overlay.innerHTML = html;
    overlay.style.display = "grid";
  };
  const hideOverlay = () => {
    overlay.style.display = "none";
    overlay.innerHTML = "";
  };

  // ---------- Help modal (JS-driven only) ----------
  const settingsBtn = document.getElementById("settingsBtn");
  const help = document.getElementById("help");
  const openHelp = () => { hideOverlay(); help.classList.add("open"); settingsBtn?.classList.remove("pulse"); };
  const closeHelp = () => help.classList.remove("open");

  settingsBtn?.addEventListener("click",(e)=>{ e.preventDefault(); openHelp(); });
  help.addEventListener("click",(e)=>{ if (e.target === help) closeHelp(); });
  addEventListener("keydown",(e)=>{ if (e.key === "Escape") closeHelp(); });

  // ---------- Delegated buttons ----------
  document.addEventListener("click",(e)=>{
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const act = btn.getAttribute("data-action");
    if (act === "close-help") { e.preventDefault(); closeHelp(); }
    if (act === "start" || act === "retry") { e.preventDefault(); startGame(); }
  });

  // ---------- HUD refs ----------
  const $timer = hud.querySelector("#timer");
  const $score = hud.querySelector("#score");
  const $activePU = hud.querySelector("#activePU");
  const $logo = hud.querySelector("#logo");

  // ---------- Assets ----------
  const imgs = {};
  const files = {
    cow_base:"cow_base.png", cow_body:"cow_body.png", muzzle_flash:"muzzle_flash.png",
    ball_base:"ball_base.png", ball_red:"ball_red.png", ball_blue:"ball_blue.png",
    ball_yellow:"ball_yellow.png", ball_green:"ball_green.png", ball_purple:"ball_purple.png",
    icon_bomb:"icon_bomb.png", icon_slow:"icon_slow.png", icon_reverse:"icon_reverse.png",
    sparkle:"sparkle.png", explosion_burst:"explosion_burst.png",
    hud_bomb:"hud_bomb.png", hud_reverse:"hud_reverse.png", hud_slow:"hud_slow.png",
    logo:"logo.png", skull_end:"skull_end.png", bg_grass_1920:"bg_grass_1920.jpg",
    ring_slow:"ring_slow.png", ring_reverse:"ring_reverse.png",
    ball_shadow:"ball_shadow.png", cursor_reticle:"cursor_reticle.png",
  };
  const loadImages = () => Promise.all(Object.entries(files).map(([k,f])=> new Promise((res,rej)=>{
    const im = new Image();
    im.onload=()=>{ imgs[k]=im; res(); };
    im.onerror=()=>rej(new Error("Failed to load "+f));
    im.src = ASSET_BASE + f;
  })));

  // ---------- Geometry / Path ----------
  function resizeCanvas(){
    canvas.width  = Math.floor(innerWidth  * DPR);
    canvas.height = Math.floor(innerHeight * DPR);
    canvas.style.width  = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  addEventListener("resize",()=>{ resizeCanvas(); buildPath(); });

  let pathPts=[], cumLen=[], pathLen=0, spawnMinS=-800;
  function buildPath(){
    const W = canvas.width, H = canvas.height - GAME.canvasMarginTop * DPR;
    const top = (GAME.canvasMarginTop + 6) * DPR;
    const anchors = GAME.anchorsPct.map(([px,py])=>({ x:px*W, y: top + py*(H-top) }));
    const SEG=28, pts=[];
    for (let i=0;i<anchors.length-1;i++){
      const p0=anchors[Math.max(0,i-1)], p1=anchors[i], p2=anchors[i+1], p3=anchors[Math.min(anchors.length-1,i+2)];
      for (let s=0;s<SEG;s++) pts.push(catmullRom(p0,p1,p2,p3,s/SEG));
    }
    pts.push(anchors[anchors.length-1]);
    const CL=[0]; let L=0;
    for (let i=1;i<pts.length;i++){ const dx=pts[i].x-pts[i-1].x, dy=pts[i].y-pts[i-1].y; L+=Math.hypot(dx,dy); CL.push(L); }
    pathPts=pts; cumLen=CL; pathLen=L;
  }
  function catmullRom(p0,p1,p2,p3,t){ const t2=t*t,t3=t2*t;
    return {
      x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
      y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
    };
  }
  const lerpPt = (a,b,t)=>({ x:lerp(a.x,b.x,t), y:lerp(a.y,b.y,t) });
  function posAtS(s){
    const ss=clamp(s,0,pathLen); let lo=0,hi=cumLen.length-1;
    while(lo<hi){ const mid=(lo+hi)>>1; if(cumLen[mid]<ss) lo=mid+1; else hi=mid; }
    const i=Math.max(1,lo), s0=cumLen[i-1], s1=cumLen[i], t=(s1-s0)>0?(ss-s0)/(s1-s0):0;
    return lerpPt(pathPts[i-1], pathPts[i], t);
  }
  function nearestSForPoint(px,py){
    let bestIdx=1,best=Infinity;
    for(let i=1;i<pathPts.length;i+=4){ const p=pathPts[i], d=(p.x-px)**2+(p.y-py)**2; if(d<best){best=d;bestIdx=i;} }
    best=Infinity; let bestS=0; const start=Math.max(1,bestIdx-5), end=Math.min(pathPts.length-1,bestIdx+5);
    for(let i=start;i<=end;i++){ const p=pathPts[i], d=(p.x-px)**2+(p.y-py)**2; if(d<best){best=d;bestS=cumLen[i];} }
    return bestS;
  }

  // ---------- Game state ----------
  const R = ()=>GAME.ballRadius*DPR, SP=()=>GAME.ballSpacing*DPR;
  let state="splash", score=0, timeLeft=GAME.durationSec, startTs=0, paused=false;

  const pointer={x:0,y:0,lastTapTs:0};
  const shooter={ x:()=>canvas.width/2, y:()=>canvas.height-110*DPR, angle:0, current:null, next:null, cooldown:0, flashT:0 };

  const chain=[], fired=[], sparkles=[], bursts=[];
  const effects={ reverseUntil:0, slowUntil:0 };

  // ---------- Input ----------
  function setPointer(x,y){ const r=canvas.getBoundingClientRect(); pointer.x=(x-r.left)*DPR; pointer.y=(y-r.top)*DPR; }
  canvas.addEventListener("mousemove",(e)=>setPointer(e.clientX,e.clientY));
  canvas.addEventListener("mousedown",()=>{ if(state==="playing") shoot(); });
  canvas.addEventListener("touchstart",(e)=>{ if(!e.touches.length) return; const t=e.touches[0]; setPointer(t.clientX,t.clientY);
    if(state==="playing"){ const now=performance.now(); if(now-pointer.lastTapTs<280) swapColors(); else shoot(); pointer.lastTapTs=now; }
    e.preventDefault(); },{passive:false});
  canvas.addEventListener("touchmove",(e)=>{ if(!e.touches.length) return; const t=e.touches[0]; setPointer(t.clientX,t.clientY); },{passive:true});
  addEventListener("keydown",(e)=>{ if(state!=="playing") return; const k=e.key.toLowerCase(); if(k==="q") swapColors(); if(k===" ") shoot(); if(k==="p") paused=!paused; });

  function swapColors(){ const t=shooter.current; shooter.current=shooter.next; shooter.next=t; }
  function shoot(){
    if(shooter.cooldown>0) return;
    const sx=shooter.x(), sy=shooter.y(), dx=pointer.x-sx, dy=pointer.y-sy, len=Math.hypot(dx,dy)||1;
    fired.push({ x:sx,y:sy, vx:(dx/len)*(GAME.projectileSpeed*DPR), vy:(dy/len)*(GAME.projectileSpeed*DPR), color:shooter.current });
    shooter.current=shooter.next; shooter.next=pickColor(); shooter.cooldown=0.12; shooter.flashT=0.06;
  }

  // ---------- Flow ----------
  function startGame(){
    // force-close everything visible first
    closeHelp();
    hideOverlay();

    score=0; timeLeft=GAME.durationSec; state="playing"; effects.reverseUntil=effects.slowUntil=0;
    chain.length=0; fired.length=0; sparkles.length=0; bursts.length=0;

    shooter.current=pickColor(); shooter.next=pickColor(); shooter.cooldown=0; shooter.flashT=0;

    buildPath();
    let s=-SP()*10; for(let i=0;i<20;i++){ chain.push(makeBall(s,pickColor(),maybePowerup())); s+=SP(); }

    pointer.x=canvas.width/2; pointer.y=canvas.height/2-200*DPR;
    startTs=performance.now();
    settingsBtn?.classList.remove("pulse");
  }

  const pickColor=()=>GAME.colors[(Math.random()*GAME.colors.length)|0].name;
  const makeBall=(s,color,pu)=>({s,color,pu:pu||null});
  function maybePowerup(){ if(Math.random()<GAME.powerupSpawnChance){ const a=["reverse","slow","bomb"]; return a[(Math.random()*a.length)|0]; } return null; }

  function showSplash(){
    state="splash";
    showOverlay(`
      <div style="max-width:760px;background:#ffffffe6;color:#111;border-radius:18px;padding:18px 20px;box-shadow:0 24px 60px #0006;text-align:center">
        <div style="margin:.5rem 0 1rem 0">
          ${imgs.logo ? `<img src="${imgs.logo.src}" alt="Lamumu Deluxe" style="max-width:420px;width:80%;height:auto;filter:drop-shadow(0 12px 28px rgba(0,0,0,.3))" />` : `<h1 style="margin:0">Lamumu Deluxe</h1>`}
        </div>
        <p style="margin:.25rem 0 1rem 0;line-height:1.55">Tap <b>⚙️ Settings</b> for a quick guide, or start now.</p>
        <button class="primary-btn" data-action="start">Start Game</button>
      </div>
    `);
    settingsBtn?.classList.add("pulse");
  }

  function showEnd({title,sub}){
    closeHelp(); // guarantee Help isn't behind
    showOverlay(`
      <div style="max-width:760px;background:#ffffffe6;color:#111;border-radius:18px;padding:18px 20px;box-shadow:0 24px 60px #0006;text-align:center">
        <h2 style="margin:.2rem 0 .6rem 0;font-size:1.4rem">${title}</h2>
        <p style="margin:.25rem 0 1rem 0;line-height:1.55">${sub}</p>
        <button class="primary-btn" data-action="retry">Start Game</button>
      </div>
    `);
  }

  const win = ()=>{ state="won"; showEnd({title:"You Win! 🐄🌾", sub:`Survived 10 minutes.<br/>Final score: <b>${score}</b>`}); };
  const lose = ()=>{ state="lost"; showEnd({title:"They Reached the Barn! 💀", sub:`You lasted <b>${fmtTime(GAME.durationSec - timeLeft)}</b>.<br/>Final score: <b>${score}</b>`}); };

  // ---------- Update / Draw ----------
  let lastTs=performance.now();
  function gameLoop(ts){
    const dt=Math.min(0.033,(ts-lastTs)/1000); lastTs=ts;
    if(state==="playing"&&!paused) update(dt,ts);
    draw(); requestAnimationFrame(gameLoop);
  }

  function update(dt,ts){
    timeLeft=Math.max(0,GAME.durationSec-(ts-startTs)/1000);
    $timer.textContent=fmtTime(timeLeft);

    shooter.cooldown=Math.max(0,shooter.cooldown-dt);
    shooter.flashT=Math.max(0,shooter.flashT-dt);
    const dx=pointer.x-shooter.x(), dy=pointer.y-shooter.y(); shooter.angle=Math.atan2(dy,dx);

    const reverseActive=ts<effects.reverseUntil*1000, slowActive=ts<effects.slowUntil*1000;
    const dir=reverseActive?-1:1, speed=(GAME.baseSpeed*(slowActive?GAME.slowFactor:1))*DPR;

    // Safe tail feed (no infinite loop)
    if (timeLeft>0){
      let guard=0;
      while ((chain.length===0 || chain[0].s>spawnMinS) && guard++<2000){
        const s = chain.length ? chain[0].s - SP() : -SP();
        chain.unshift(makeBall(s,pickColor(),maybePowerup()));
      }
    }

    const delta=dir*speed*dt;
     
    if (dir > 0) {
      // FORWARD: only the tail segment moves; front segments wait until pushed
      const segs = getSegments();
      if (segs.length) {
        const [start0, end0] = segs[0]; // tail-most segment (lowest s)

        // move the tail segment forward, but stop at the next segment’s first ball
        for (let i = end0; i >= start0; i--) {
          let lead;
          if (i === end0) {
            if (segs.length > 1) {
              const nextStart = segs[1][0];
              lead = chain[nextStart].s - SP();        // stop when contacting next segment
            } else {
              lead = Infinity;                         // no segment ahead
            }
          } else {
            lead = chain[i + 1].s - SP();              // keep spacing to the ball ahead
          }
          chain[i].s = Math.min(chain[i].s + delta, lead);
        }

        // propagate PUSH into front segments once contact occurs
        for (let i = end0 + 1; i < chain.length; i++) {
          chain[i].s = Math.max(chain[i].s, chain[i - 1].s + SP());
        }
      }
    } else {
      // REVERSE: whole chain moves backward together
      for (let i = 0; i < chain.length; i++) {
        const back = (i === 0) ? -Infinity : chain[i - 1].s + SP();
        chain[i].s = Math.max(chain[i].s + delta, back);
      }
    }

    // Projectiles & insertion
    for(let i=fired.length-1;i>=0;i--){
      const b = fired[i];
      // advance
      b.x += b.vx * dt;
      b.y += b.vy * dt;
   
      // cull off-screen
      if (b.x < -100 || b.y < -100 || b.x > canvas.width + 100 || b.y > canvas.height + 100) {
        fired.splice(i, 1);
        continue;
      }
   
      if (!chain.length) continue;
   
      // project shot to path
      const sHit = nearestSForPoint(b.x, b.y);
      const pOnPath = posAtS(sHit);
   
      // find nearest chain ball in "s" space
      let nearestIdx = 0;
      let nearestDiff = Math.abs(chain[0].s - sHit);
      for (let j = 1; j < chain.length; j++) {
        const d = Math.abs(chain[j].s - sHit);
        if (d < nearestDiff) { nearestDiff = d; nearestIdx = j; }
      }
   
      // distances
      const bp = posAtS(chain[nearestIdx].s);
      const distToBall = Math.hypot(bp.x - b.x, bp.y - b.y);
      const distToPath = Math.hypot(pOnPath.x - b.x, pOnPath.y - b.y);
   
      // thresholds (tweakable)
      const CONTACT_DIST = R() * 1.9;      // must actually touch a ball
      const S_MAX_GAP    = SP() * 0.95;    // shot must be near that ball along the path
      const PATH_SNAP    = R() * 1.3;      // also be close to the path centerline
   
      // insert only if we're contacting the chain (not just the empty path)
      if (distToBall <= CONTACT_DIST && nearestDiff <= S_MAX_GAP && distToPath <= PATH_SNAP) {
        // choose before/after nearest depending on s
        let insertIdx = (sHit > chain[nearestIdx].s) ? (nearestIdx + 1) : nearestIdx;
   
        // clamp s a little between neighbors to avoid huge overlaps; settle will finish it
        let sInsert = sHit;
        const leftS  = (insertIdx > 0) ? chain[insertIdx - 1].s : -Infinity;
        const rightS = (insertIdx < chain.length) ? chain[insertIdx].s :  Infinity;
        const EPS = SP() * 0.08;
        if (isFinite(leftS))  sInsert = Math.max(sInsert, leftS  + EPS);
        if (isFinite(rightS)) sInsert = Math.min(sInsert, rightS - EPS);
   
        chain.splice(insertIdx, 0, makeBall(sInsert, b.color, null));
        fired.splice(i, 1);
   
        settleAround(insertIdx);
        handleMatchesAndPowerups(insertIdx);
   
        sparkles.push({ x: pOnPath.x, y: pOnPath.y, t: 0, life: 0.25 });
      }
    }      

    // Win / Lose
    const head=chain[chain.length-1];
    if(head && head.s>=pathLen-SP()*1.2) lose();
    else if(timeLeft<=0) win();

    // FX lifetimes
    for(let k=sparkles.length-1;k>=0;k--){ sparkles[k].t+=dt; if(sparkles[k].t>=sparkles[k].life) sparkles.splice(k,1); }
    for(let k=bursts.length-1;k>=0;k--){ bursts[k].t+=dt; if(bursts[k].t>=bursts[k].life) bursts.splice(k,1); }

    renderActivePU(ts);
  }

  function settleAround(idx){
    for(let i=idx-1;i>=0;i--) chain[i].s=Math.min(chain[i].s,chain[i+1].s-SP());
    for(let i=idx+1;i<chain.length;i++) chain[i].s=Math.max(chain[i].s,chain[i-1].s+SP());
  }

  function handleMatchesAndPowerups(centerIdx){
    const c=chain[centerIdx]?.color; if(!c) return;
    let L=centerIdx,R=centerIdx; while(L-1>=0&&chain[L-1].color===c)L--; while(R+1<chain.length&&chain[R+1].color===c)R++;
    const count=R-L+1, removed=[];
    if(count>=3){ for(let i=L;i<=R;i++) removed.push(chain[i]); chain.splice(L,count); score+=count*10; $score.textContent=String(score);
      for(let i=L;i<chain.length;i++) chain[i].s-=SP()*0.28; }
    if(removed.length){
      const hasReverse=removed.some(b=>b.pu==="reverse");
      const hasSlow=removed.some(b=>b.pu==="slow");
      const hasBomb=removed.some(b=>b.pu==="bomb");
      const now=performance.now()/1000;
      if(hasReverse) effects.reverseUntil=Math.max(effects.reverseUntil,now+GAME.reverseDuration);
      if(hasSlow)    effects.slowUntil   =Math.max(effects.slowUntil,   now+GAME.slowDuration);
      if(hasBomb){ const midS=removed[Math.floor(removed.length/2)].s; doBomb(midS); }
      const checkIdx=Math.max(0,L-1); if(checkIdx<chain.length) chainReactionCheck(checkIdx);
    }
  }

  function chainReactionCheck(idx){
    if(!chain.length) return;
    const tryIdx=clamp(idx,0,chain.length-1);
    const colors=[chain[tryIdx].color, chain[tryIdx+1]?.color].filter(Boolean);
    colors.forEach(col=>{
      let L=tryIdx,R=tryIdx; while(L-1>=0&&chain[L-1].color===col)L--; while(R+1<chain.length&&chain[R+1].color===col)R++;
      const cnt=R-L+1; if(cnt>=3){ chain.splice(L,cnt); score+=cnt*10; $score.textContent=String(score); for(let i=L;i<chain.length;i++) chain[i].s-=SP()*0.25; }
    });
  }

  // Split the chain into contiguous segments (gaps > ~1 ball apart)
  function getSegments() {
    const segments = [];
    if (!chain.length) return segments;
    const GAP = SP() * 1.05; // threshold to consider "broken"
    let start = 0;
    for (let i = 1; i < chain.length; i++) {
      if (chain[i].s - chain[i - 1].s > GAP) {
        segments.push([start, i - 1]);
        start = i;
      }
    }
    segments.push([start, chain.length - 1]);
    return segments;
  }

  function doBomb(centerS){
    const radius=SP()*GAME.bombRadiusInBalls, p=posAtS(centerS);
    bursts.push({x:p.x,y:p.y,t:0,life:0.35});
    const keep=[]; for(let i=0;i<chain.length;i++){ if(Math.abs(chain[i].s-centerS)>radius) keep.push(chain[i]); else score+=8; }
    chain.length=0; chain.push(...keep); $score.textContent=String(score);
  }

  function fmtTime(sec){ const s=Math.max(0,Math.floor(sec)), m=(s/60)|0, r=s%60; return `${m}:${r.toString().padStart(2,"0")}`; }

  // ---------- Drawing ----------
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height); drawBG();

    // path ribbon
    ctx.save(); ctx.strokeStyle="rgba(255,255,255,0.04)"; ctx.lineWidth=14*DPR; ctx.lineCap="round";
    ctx.beginPath(); for(let i=1;i<pathPts.length;i++){ const a=pathPts[i-1], b=pathPts[i]; ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); } ctx.stroke(); ctx.restore();

    // skull
    const end=pathPts[pathPts.length-1]; if(imgs.skull_end){ const sz=46*DPR; ctx.drawImage(imgs.skull_end,end.x-sz/2,end.y-sz/2,sz,sz); }

    // effect rings near head
    const nowS=performance.now()/1000, head=chain[chain.length-1];
    if(head){ const hp=posAtS(head.s);
      if(nowS<effects.reverseUntil && imgs.ring_reverse){ const size=140*DPR; ctx.globalAlpha=.75; ctx.drawImage(imgs.ring_reverse,hp.x-size/2,hp.y-size/2,size,size); ctx.globalAlpha=1; }
      if(nowS<effects.slowUntil && imgs.ring_slow){ const size=140*DPR; ctx.globalAlpha=.75; ctx.drawImage(imgs.ring_slow,hp.x-size/2,hp.y-size/2,size,size); ctx.globalAlpha=1; }
    }

    // chain
    for(const b of chain){
      const p=posAtS(b.s);
      if(imgs.ball_shadow){ const sw=36*DPR, sh=16*DPR; ctx.globalAlpha=.5; ctx.drawImage(imgs.ball_shadow,p.x-sw/2,p.y+R()*.65,sw,sh); ctx.globalAlpha=1; }
      const bi=imgs["ball_"+b.color]||imgs.ball_base, size=R()*2;
      if(bi) ctx.drawImage(bi,p.x-R(),p.y-R(),size,size);
      if(b.pu){ const ik=b.pu==="bomb"?"icon_bomb":b.pu==="slow"?"icon_slow":"icon_reverse", s=R()*1.2; if(imgs[ik]) ctx.drawImage(imgs[ik],p.x-s/2,p.y-s/2,s,s); }
    }

    // bursts
    for(const ex of bursts){ const t=ex.t/ex.life, scale=lerp(.6,1.8,t), alpha=1-t, img=imgs.explosion_burst;
      if(img){ const size=120*DPR*scale; ctx.globalAlpha=alpha; ctx.drawImage(img,ex.x-size/2,ex.y-size/2,size,size); ctx.globalAlpha=1; } }

    // projectiles
    for(const f of fired){ const bi=imgs["ball_"+f.color]||imgs.ball_base, size=R()*1.8;
      if(bi) ctx.drawImage(bi,f.x-size/2,f.y-size/2,size,size);
      if(imgs.ball_shadow) ctx.drawImage(imgs.ball_shadow,f.x-12*DPR,f.y+10*DPR,24*DPR,10*DPR);
    }

    // sparkles
    for(const s of sparkles){ const t=s.t/s.life, a=1-t, size=lerp(12,28,t)*DPR;
      if(imgs.sparkle){ ctx.globalAlpha=a; ctx.drawImage(imgs.sparkle,s.x-size/2,s.y-size/2,size,size); ctx.globalAlpha=1; } }

    drawShooter();
  }

  function drawBG(){
    const img=imgs.bg_grass_1920;
    if(!img){ const g=ctx.createLinearGradient(0,0,0,canvas.height); g.addColorStop(0,"#66bb6a"); g.addColorStop(1,"#2e7d32"); ctx.fillStyle=g; ctx.fillRect(0,0,canvas.width,canvas.height); return; }
    const iw=img.naturalWidth, ih=img.naturalHeight, ar=iw/ih, cw=canvas.width, ch=canvas.height, car=cw/ch;
    let w,h; if(car>ar){ w=cw; h=cw/ar; } else { h=ch; w=ch*ar; }
    ctx.drawImage(img,(cw-w)/2,(ch-h)/2,w,h);
  }

  function drawShooter(){
    const sx=shooter.x(), sy=shooter.y();
    if(imgs.cow_base){ const w=140*DPR,h=56*DPR; ctx.drawImage(imgs.cow_base,sx-w/2,sy-h/2+20*DPR,w,h); }
    if(imgs.cow_body){ const w=120*DPR,h=100*DPR; ctx.drawImage(imgs.cow_body,sx-w/2,sy-h/2,w,h); }
    const mx=sx+Math.cos(shooter.angle)*34*DPR, my=sy+Math.sin(shooter.angle)*34*DPR, bi=imgs["ball_"+shooter.current]||imgs.ball_base;
    if(bi) ctx.drawImage(bi,mx-R()*0.9,my-R()*0.9,R()*1.8,R()*1.8);
    ctx.save(); ctx.strokeStyle="rgba(255,255,255,0.7)"; ctx.lineWidth=2*DPR; ctx.setLineDash([6*DPR,6*DPR]); ctx.beginPath(); ctx.moveTo(mx,my);
    ctx.lineTo(mx+Math.cos(shooter.angle)*600*DPR, my+Math.sin(shooter.angle)*600*DPR); ctx.stroke(); ctx.restore();
    if(imgs.muzzle_flash && shooter.flashT>0){ const t=shooter.flashT/0.06, s=lerp(30,14,1-t)*DPR; ctx.globalAlpha=t; ctx.drawImage(imgs.muzzle_flash,mx-s/2,my-s/2,s,s); ctx.globalAlpha=1; }
    if(imgs.cursor_reticle){ const rs=26*DPR; ctx.globalAlpha=.8; ctx.drawImage(imgs.cursor_reticle,pointer.x-rs/2,pointer.y-rs/2,rs,rs); ctx.globalAlpha=1; }
  }

  function renderActivePU(ts){
    $activePU.innerHTML=""; const now=ts/1000;
    const add=(key,until)=>{ const d=Math.max(0,until-now); const el=document.createElement("div");
      el.style.cssText="display:flex;align-items:center;gap:6px;padding:.3rem .5rem;border-radius:999px;background:#ffffffe0;color:#111;font-weight:700";
      const img=document.createElement("img"); img.src=imgs[key].src; img.style.height="22px";
      const span=document.createElement("span"); span.textContent=d.toFixed(1)+"s";
      el.appendChild(img); el.appendChild(span); $activePU.appendChild(el); };
    if(now<effects.reverseUntil && imgs.hud_reverse) add("hud_reverse",effects.reverseUntil);
    if(now<effects.slowUntil    && imgs.hud_slow)    add("hud_slow",effects.slowUntil);
  }

  // ---------- Boot ----------
  function init(){
    resizeCanvas(); buildPath();
    pointer.x=canvas.width/2; pointer.y=canvas.height/2-200*DPR;
    showSplash(); requestAnimationFrame(gameLoop);
  }
  function setupLogo(){ if(imgs.logo){ $logo.src=imgs.logo.src; $logo.style.display="block"; } }

  loadImages().then(()=>{ setupLogo(); init(); })
  .catch(err=>{
    showOverlay(`<div style="max-width:720px;background:#ffffffe6;color:#111;border-radius:18px;padding:16px 18px;box-shadow:0 24px 60px #0006;text-align:center">
      <h2>Asset Load Error</h2><p>${err.message}</p></div>`);
  });
})();
