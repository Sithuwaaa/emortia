/* Shared site-lookup engine. Each tool defines window.LOOKUP_CONFIG before loading this. */
(function(){
const C = window.LOOKUP_CONFIG;
let COLS=[], ROWS=[], IDX={}, savedAt='';
const $=id=>document.getElementById(id);
const view=$('view'), q=$('q'), hint=$('hint'), pill=$('pill');

/* theme */
const THEME_KEY='office_tool_theme';
function applyTheme(t){document.documentElement.dataset.theme=t;$('themeBtn').textContent=t==='dark'?'☀':'☾';try{localStorage.setItem(THEME_KEY,t)}catch(e){}}
applyTheme(localStorage.getItem(THEME_KEY)||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
$('themeBtn').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');

/* toast */
let tt;function toast(m,ms){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),ms||1800)}

/* The tool's own IndexedDB store is gone with the bundled copy it existed to
   hold. What caching there is now lives in _lib/db.js, holds only what the
   server handed this browser, and is emptied on sign-out. */

/* helpers */
const ci=name=>COLS.indexOf(name);
const fieldVal=(r,name)=>{const i=ci(name);return i>=0?(r[i]||''):''};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function hl(s,term){s=esc(s);const parts=term.trim().split(/\s+/).filter(Boolean);for(const p of parts){const re=new RegExp('('+p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig');s=s.replace(re,'<mark>$1</mark>')}return s}
const blank=v=>!v||v==='Unknown'||v==='Undefined'||v==='0';

function buildIndex(){
  IDX={byId:{}};
  const sidx=(C.searchCols||[]).map(ci).filter(i=>i>=0);
  ROWS.forEach(r=>{r.__blob=sidx.map(i=>r[i]).join('  ').toLowerCase()});
  const idc=ci(C.idCol);
  ROWS.forEach(r=>{if(r[idc])IDX.byId[String(r[idc]).toLowerCase()]=r});
}
/* Both tools name a dataset key and read the database through it. There was a
   second path here once - a data.json committed beside the tool, fetched when
   the server had nothing - and it is what made the row level policies on these
   tables ornamental: GitHub Pages serves every file in this repository, so the
   rows the policy guarded were also sitting at a guessable URL that wanted no
   account and no session. Both files are deleted, both are purged from the
   history, and this is the server or nothing. */
const SYNCED = !!(C.syncKey && window.DB);
function applyDataset(ds){
  COLS=ds.cols||[]; ROWS=(ds.rows||[]).map(r=>r.slice()); savedAt=ds.savedAt||'';
  /* The rows are new objects, so anything holding on to the old ones is
     holding on to nothing - the measured pair especially, which is two
     references and would quietly stop matching anything in the list. */
  PAIR=[]; PICK={}; MORE={};
  buildIndex();
  /* An empty tool has to say why it is empty, or it reads as broken. There is
     no local copy to fall back on any more, so "nothing here yet" is the
     literal truth and the way out of it is an upload. */
  if(!ROWS.length){
    pill.innerHTML='<b>0</b> '+C.unit+' · nothing published yet';
    const v=$('view');
    if(v) v.innerHTML='<div class="empty"><div class="big">☁</div><h2>Nothing published yet</h2><p>'+
      'This tool reads the database and nothing else - there is no copy of the '+
      'list in the site any more. Sithara needs to open it signed in and upload '+
      'the workbook once.</p></div>';
    return;
  }
  const where = ds.source==='server' ? ' · synced' : '';
  pill.innerHTML='<b>'+ROWS.length.toLocaleString()+'</b> '+C.unit+(savedAt?' · updated '+savedAt:'')+where;
  route();
}
async function loadData(){
  if(!SYNCED){ applyDataset({cols:[],rows:[]}); return; }
  // paints from the per-device cache first, then swaps itself if the server is ahead
  const ds=await window.DB.load(C.syncKey, fresh=>{
    applyDataset(fresh); toast('Updated from another device');
  });
  applyDataset(ds);
  window.DB.subscribe(C.syncKey, async ()=>{
    const fresh=await window.DB.load(C.syncKey);
    applyDataset(fresh); toast('Updated from another device');
  });
}
/* ================= narrowing, mapping, measuring =================

   Searching answers "where is this site". These answer the other question
   the same list gets asked - everything CM, everything in Kurunegala,
   everything this depot holds - and then what you do with the answer once
   you have it.

   A tool gets all of it by naming its own columns in LOOKUP_CONFIG.facets
   and nothing else. */
const FACETS = C.facets || [];
const MAPPABLE = !!(C.latCol && C.lngCol);
const FACE_CAP = 16, LIST_CAP = 300;
const fkey = f => f.key || f.col;
const fval = (f,r) => String((f.of ? f.of(r, fieldVal) : fieldVal(r, f.col)) || '').trim();
let PICK = {}, MORE = {}, PAIR = [];

const fbox = document.createElement('div');
const tray = document.createElement('div');
hint.parentNode.insertBefore(fbox, hint);
hint.parentNode.insertBefore(tray, hint);

const anyPick = () => FACETS.some(f => PICK[fkey(f)]);
/* Every row still standing, optionally ignoring one facet's own choice - which
   is how a chip can say how many rows it would leave rather than how many it
   has left. */
function rowsBy(exceptKey){
  if(!anyPick()) return ROWS;
  return ROWS.filter(r => FACETS.every(f => {
    const k = fkey(f);
    return k === exceptKey || !PICK[k] || fval(f,r) === PICK[k];
  }));
}
const visible = () => rowsBy(null);
const rawId = r => String(fieldVal(r, C.idCol) || fieldVal(r, C.nameCol) || '').trim();

/* the name of what is on screen, for the top of a file */
function pickName(){
  const bits = FACETS.filter(f => PICK[fkey(f)]).map(f => PICK[fkey(f)]);
  return (bits.join(' · ') || 'All ' + C.unit);
}

/* Four rows of chips is most of a screen, and on a list this size the chips
   are not the tool - they are how you put a question to it once. So the panel
   is shut to begin with and remembers how it was left; what is chosen stays on
   the bar while it is shut, with a cross on it, because a filter you cannot
   see is a filter you cannot turn off. */
const OPEN_KEY = 'lookup_facets_open_' + (C.syncKey || 'x');
let OPEN = false;
try{ OPEN = localStorage.getItem(OPEN_KEY) === '1'; }catch(e){}

function renderFacets(){
  if(!FACETS.length || !ROWS.length){ fbox.className=''; fbox.innerHTML=''; return; }
  const chosen = FACETS.filter(f => PICK[fkey(f)]);
  const n = visible().length;

  let html = '<div class="fhead">' +
    '<button class="ftog' + (OPEN ? ' open' : '') + '" id="ftog" aria-expanded="' + OPEN + '">' +
      '<span class="cv">&#9656;</span>Filters' +
      (chosen.length ? '<b>' + chosen.length + '</b>' : '') + '</button>';
  if(!OPEN) html += chosen.map(f =>
    '<button class="chip on" data-off="' + esc(fkey(f)) + '" title="Remove this filter">' +
    esc(f.label || fkey(f)) + ': ' + esc(PICK[fkey(f)]) + ' &#215;</button>').join('');
  if(chosen.length){
    html += '<span class="n">' + n.toLocaleString() + ' ' + (n === 1 ? C.unitSingular : C.unit) + '</span>' +
      (MAPPABLE ? '<button class="fbtn" id="fkml">Open these on a map</button>' : '') +
      '<button class="fbtn" id="fclr">Clear</button>';
  }
  html += '</div>';

  if(OPEN) html += '<div class="fbody">' + facetRowsHtml() + '</div>';

  fbox.className = 'facets';
  fbox.innerHTML = html;

  $('ftog').onclick = () => {
    OPEN = !OPEN;
    try{ localStorage.setItem(OPEN_KEY, OPEN ? '1' : '0'); }catch(e){}
    renderFacets();
  };
  [...fbox.querySelectorAll('.chip[data-off]')].forEach(b => b.onclick = () => {
    PICK[b.dataset.off] = ''; route();
  });
  [...fbox.querySelectorAll('.chip[data-k]')].forEach(b => b.onclick = () => {
    PICK[b.dataset.k] = b.dataset.v || ''; route();
  });
  [...fbox.querySelectorAll('.chip[data-more]')].forEach(b => b.onclick = () => { MORE[b.dataset.more] = true; renderFacets(); });
  [...fbox.querySelectorAll('.chip[data-less]')].forEach(b => b.onclick = () => { MORE[b.dataset.less] = false; renderFacets(); });
  const kb = $('fkml'); if(kb) kb.onclick = () => saveKml(visible(), pickName());
  const cb = $('fclr'); if(cb) cb.onclick = () => { PICK = {}; MORE = {}; route(); };
}

function facetRowsHtml(){
  let html = '';
  for(const f of FACETS){
    const k = fkey(f), cur = PICK[k] || '';
    const counts = new Map();
    for(const r of rowsBy(k)){
      const v = fval(f,r);
      if(!v || blank(v)) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    let items = [...counts.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
    if(!items.length) continue;
    const cap = MORE[k] ? items.length : FACE_CAP;
    const shown = items.slice(0, cap);
    /* whatever is chosen stays on screen even if it is not in the busiest
       sixteen - a chip you cannot see is a filter you cannot turn off */
    if(cur && !shown.some(i => i[0] === cur)){
      const hit = items.find(i => i[0] === cur);
      if(hit) shown.unshift(hit);
    }
    html += '<div class="frow"><span class="flabel">' + esc(f.label || k) + '</span>' +
      '<button class="chip' + (cur ? '' : ' on') + '" data-k="' + esc(k) + '" data-v="">All</button>' +
      shown.map(([v,n]) => '<button class="chip' + (cur === v ? ' on' : '') + '" data-k="' + esc(k) +
        '" data-v="' + esc(v) + '">' + esc(v) + '<b>' + n.toLocaleString() + '</b></button>').join('') +
      (items.length > cap ? '<button class="chip more" data-more="' + esc(k) + '">+' + (items.length - cap) + ' more</button>' : '') +
      (MORE[k] && items.length > FACE_CAP ? '<button class="chip more" data-less="' + esc(k) + '">fewer</button>' : '') +
      '</div>';
  }
  return html;
}

/* ---- coordinates ---- */
function coordOf(r){
  if(!MAPPABLE) return null;
  const num = s => parseFloat(String(s).replace(/[^\d.\-]/g,''));
  const la = num(fieldVal(r, C.latCol)), ln = num(fieldVal(r, C.lngCol));
  if(!isFinite(la) || !isFinite(ln)) return null;
  if(Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  if(la === 0 && ln === 0) return null;
  return { la, ln };
}
/* the great circle, which is what a microwave hop actually is - a road map
   would answer a different question and answer it longer */
function airKm(a,b){
  const R = 6371.0088, rad = Math.PI/180;
  const dLa = (b.la-a.la)*rad, dLn = (b.ln-a.ln)*rad;
  const s = Math.sin(dLa/2)**2 + Math.cos(a.la*rad)*Math.cos(b.la*rad)*Math.sin(dLn/2)**2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(s)));
}
function bearing(a,b){
  const rad = Math.PI/180;
  const y = Math.sin((b.ln-a.ln)*rad)*Math.cos(b.la*rad);
  const x = Math.cos(a.la*rad)*Math.sin(b.la*rad) -
            Math.sin(a.la*rad)*Math.cos(b.la*rad)*Math.cos((b.ln-a.ln)*rad);
  return (Math.atan2(y,x)/rad + 360) % 360;
}

/* ---- the map ----

   KML, because there is no address you can type at Google Maps that plots
   four hundred markers - its URLs carry one place, or a route down roads.
   A KML is the file both Google Earth and My Maps are waiting for, it opens
   offline, and it keeps the site IDs on the pins. */
const xes = s => String(s).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function saveKml(rows, name, hop){
  const marks = [];
  let missed = 0;
  for(const r of rows){
    const c = coordOf(r);
    if(!c){ missed++; continue; }
    const sub = [fieldVal(r, C.nameCol), C.metaCol ? fieldVal(r, C.metaCol) : ''].filter(Boolean).join(' · ');
    marks.push('<Placemark><name>' + xes(rawId(r) || 'site') + '</name>' +
      '<description>' + xes(sub) + '</description>' +
      '<Point><coordinates>' + c.ln + ',' + c.la + ',0</coordinates></Point></Placemark>');
  }
  if(!marks.length){ toast('Nothing in that selection has coordinates'); return; }
  let line = '';
  if(hop && hop.length === 2){
    const a = coordOf(hop[0]), b = coordOf(hop[1]);
    if(a && b) line = '<Placemark><name>' + xes(rawId(hop[0]) + ' to ' + rawId(hop[1]) + ' · ' +
      airKm(a,b).toFixed(2) + ' km') + '</name><LineString><tessellate>0</tessellate>' +
      '<altitudeMode>clampToGround</altitudeMode><coordinates>' +
      a.ln + ',' + a.la + ',0 ' + b.ln + ',' + b.la + ',0</coordinates></LineString></Placemark>';
  }
  const kml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xes(name) + '</name>' +
    marks.join('') + line + '</Document></kml>';
  const url = URL.createObjectURL(new Blob([kml], { type:'application/vnd.google-earth.kml+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = String(name).replace(/[\\/:*?"<>|]+/g,'').trim().slice(0,60) + '.kml';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  toast(marks.length.toLocaleString() + ' on the map' +
    (missed ? ' · ' + missed.toLocaleString() + ' had no coordinates' : ''), 3600);
}

/* ---- the tape measure ---- */
function renderTray(){
  if(!PAIR.length){ tray.className = ''; tray.innerHTML = ''; return; }
  tray.className = 'tray';
  const lbl = r => esc(rawId(r) || '—');
  if(PAIR.length === 1){
    tray.innerHTML = '<span class="leg">' + lbl(PAIR[0]) + '</span>' +
      '<span class="brg">pick a second site and the hop is measured</span>' +
      '<span class="sp"><button class="fbtn" id="tclr">Clear</button></span>';
  }else{
    const a = coordOf(PAIR[0]), b = coordOf(PAIR[1]);
    const km = airKm(a,b);
    tray.innerHTML = '<span class="leg">' + lbl(PAIR[0]) + ' → ' + lbl(PAIR[1]) + '</span>' +
      '<span class="km">' + km.toFixed(2) + ' km</span>' +
      '<span class="brg">' + bearing(a,b).toFixed(1) + '° out · ' + bearing(b,a).toFixed(1) + '° back</span>' +
      '<span class="sp"><button class="fbtn" id="thop">The hop as KML</button>' +
      '<button class="fbtn" id="tclr">Clear</button></span>';
  }
  const c = $('tclr'); if(c) c.onclick = () => { PAIR = []; route(); };
  const k = $('thop'); if(k) k.onclick = () =>
    saveKml(PAIR, rawId(PAIR[0]) + ' to ' + rawId(PAIR[1]), PAIR);
}

function search(term, base){
  term = term.trim().toLowerCase(); if(!term) return [];
  const pool = base || ROWS;
  const out = [], seen = new Set();
  const hit = IDX.byId[term];
  if(hit && pool.indexOf(hit) >= 0){ out.push(hit); seen.add(hit); }
  const parts = term.split(/\s+/);
  for(const r of pool){ if(seen.has(r))continue; if(parts.every(p=>r.__blob.includes(p))){out.push(r);if(out.length>=60)break} }
  return out;
}
function route(){
  const term = q.value.trim();
  $('clr').style.display = q.value ? 'block' : 'none';
  renderFacets(); renderTray();
  if(!ROWS.length){ renderHome(); return; }
  const picked = anyPick();
  if(!term && !picked){ renderHome(); return; }
  const base = visible();
  const res = term ? search(term, base) : base;
  if(!res.length){
    hint.textContent = '';
    view.innerHTML = '<div class="empty"><div class="big">🔍</div>No ' + C.unitSingular +
      (term ? ' matches “' + esc(term) + '”' : ' here') + '.</div>';
    return;
  }
  hint.textContent = term
    ? (res.length >= 60 ? 'showing first 60 matches' : res.length + ' match' + (res.length === 1 ? '' : 'es'))
    : (res.length > LIST_CAP
        ? 'showing the first ' + LIST_CAP.toLocaleString() + ' of ' + res.length.toLocaleString()
        : res.length.toLocaleString() + ' ' + (res.length === 1 ? C.unitSingular : C.unit));
  if(res.length === 1 && term){ renderDetail(res[0]); return; }
  renderList(res.slice(0, term ? 60 : LIST_CAP), term);
}
function renderHome(){
  hint.textContent='';
  view.innerHTML='<div class="empty"><div class="big">'+C.homeIcon+'</div>'+C.homeText(ROWS.length)+'</div>';
}
function renderList(res,term){
  const idc=ci(C.idCol), nc=ci(C.nameCol), mc=ci(C.metaCol);
  view.innerHTML='<div class="results">'+res.map((r,i)=>{
    const on = PAIR.indexOf(r) >= 0;
    const can = !!coordOf(r);
    return '<div class="rrow" data-i="'+i+'"><span class="id">'+hl(String(r[idc]||'—'),term)+
      '</span><span class="nm">'+hl(String(r[nc]||''),term)+'</span><span class="meta">'+esc(String(r[mc]||''))+'</span>'+
      (can ? '<button class="pin'+(on?' on':'')+'" data-p="'+i+'" title="Measure the hop from here" aria-label="Measure from this site">&#8596;</button>' : '')+
      '</div>';
  }).join('')+'</div>';
  [...view.querySelectorAll('.rrow')].forEach(el=>el.onclick=e=>{
    if(e.target.closest && e.target.closest('.pin')) return;
    renderDetail(res[+el.dataset.i]);
  });
  [...view.querySelectorAll('.pin')].forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const r = res[+b.dataset.p], at = PAIR.indexOf(r);
    if(at >= 0) PAIR.splice(at,1);
    else { if(PAIR.length >= 2) PAIR.shift(); PAIR.push(r); }
    route();
  });
}
function renderDetail(r){
  const id=fieldVal(r,C.idCol), nm=fieldVal(r,C.nameCol);
  const lat=C.latCol?fieldVal(r,C.latCol):'', lng=C.lngCol?fieldVal(r,C.lngCol):'', tel=C.telCol?fieldVal(r,C.telCol):'';
  let h='<div class="detail"><div class="dhead"><div class="top"><span class="id">'+esc(id||'—')+'</span>';
  const badges=C.badges?C.badges(r,fieldVal):[];
  for(const b of badges) if(b&&b.text) h+='<span class="badge '+(b.kind||'info')+'">'+esc(b.text)+'</span>';
  h+='</div>';
  if(nm) h+='<div class="nm">'+esc(nm)+'</div>';
  const sub=(C.subBits?C.subBits(r,fieldVal):[]).filter(Boolean);
  if(sub.length) h+='<div class="sub">'+esc(sub.join('  ·  '))+'</div>';
  h+='<div class="actions">';
  if(lat&&lng&&!blank(lat)&&!blank(lng)) h+='<a class="act primary" target="_blank" rel="noopener" href="https://www.google.com/maps?q='+encodeURIComponent(lat+','+lng)+'">📍 Open in Maps</a>';
  if(tel&&!blank(tel)) h+='<a class="act" href="tel:'+esc(String(tel).replace(/[^0-9+]/g,''))+'">📞 Call</a>';
  /* A search that lands on one site comes straight here, so the measure has to
     be startable from here too - otherwise the only way to pick an end of a
     hop is to search badly enough to get a list. */
  if(coordOf(r)) h+='<button class="act" id="measBtn">&#8596; '+
    (PAIR.indexOf(r)>=0 ? 'Picked for the hop' : 'Measure from here')+'</button>';
  h+='<button class="act" id="copyBtn">⧉ Copy details</button></div></div><div class="groups">';
  for(const g of C.groups){
    const cells=g.f.map(name=>{
      const i=ci(name); if(i<0) return '';
      const v=String(r[i]||'').trim();
      const label=(C.labels&&C.labels[name])||name;
      const isMono=(C.mono||[]).includes(name), isFull=(C.full||[]).includes(name);
      let vhtml;
      if(blank(v)&&v==='') vhtml='<span class="v dim">—</span>';
      else if(name===C.telCol&&!blank(v)) vhtml='<span class="v mono"><a href="tel:'+esc(v.replace(/[^0-9+]/g,''))+'">'+esc(v)+'</a></span>';
      else vhtml='<span class="v '+(isMono?'mono':'')+(v==='Unknown'||v==='Undefined'?' dim':'')+'">'+esc(v||'—')+'</span>';
      return '<div class="f'+(isFull?' full':'')+'"><div class="k">'+esc(label)+'</div>'+vhtml+'</div>';
    }).join('');
    h+='<div class="group"><h3>'+esc(g.h)+'</h3><div class="fields">'+cells+'</div></div>';
  }
  h+='</div></div>'; view.innerHTML=h;
  const mb=$('measBtn');
  if(mb) mb.onclick=()=>{
    const at=PAIR.indexOf(r);
    if(at>=0) PAIR.splice(at,1);
    else { if(PAIR.length>=2) PAIR.shift(); PAIR.push(r); }
    renderTray(); renderDetail(r);
  };
  $('copyBtn').onclick=()=>{
    const text=C.copyText
      ? C.copyText(r,fieldVal)
      : COLS.map((c,i)=>(((C.labels&&C.labels[c])||c)+': '+(r[i]||'—'))).join('\n');
    navigator.clipboard&&navigator.clipboard.writeText(text).then(()=>toast('Details copied')).catch(()=>{});
  };
}

/* refresh from xlsx.
   Full-format sheets (headers matching the bundled dataset) replace everything.
   Partial sheets (e.g. just Site ID / Name / Lat / Long / Depot) MERGE by id:
   only the supplied fields change, blanks never wipe existing values, and a
   supplied depot auto-fills the matching officer + contact (learned from the
   current dataset by majority). Configured via C.merge. */
function normHdr(s){return String(s).toLowerCase().replace(/[\s_\-\/().]+/g,'')}
function officerMapFromRows(){
  const m={};
  if(!C.merge) return m;
  const di=ci(C.merge.officerFrom), oi=ci(C.merge.officerCol), ti=ci(C.merge.contactCol);
  if(di<0||oi<0||ti<0) return m;
  const tally={};
  for(const r of ROWS){
    const dep=String(r[di]||'').trim().toLowerCase(); if(!dep) continue;
    const o=String(r[oi]||'').trim(), t=String(r[ti]||'').trim();
    if(!o&&!t) continue;
    ((tally[dep]=tally[dep]||{})[o+'|SEP|'+t]=(tally[dep][o+'|SEP|'+t]||0)+1);
  }
  for(const dep in tally){
    const best=Object.entries(tally[dep]).sort((a,b)=>b[1]-a[1])[0][0].split('|SEP|');
    m[dep]={officer:best[0], contact:best[1]};
  }
  return m;
}
function mergeUpload(arr){
  // alias lookup: normalized header -> our column name
  const aliasOf={};
  for(const col in C.merge.aliases) for(const a of C.merge.aliases[col]) aliasOf[normHdr(a)]=col;
  aliasOf[normHdr(C.idCol)]=C.idCol;
  // find the header row (sheets often start with banner/filter rows)
  let hdrRow=-1, colmap=null;
  for(let i=0;i<Math.min(arr.length,12);i++){
    const m={}; let hits=0, hasId=false;
    arr[i].forEach((cell,j)=>{
      const t=aliasOf[normHdr(cell)];
      if(t && !Object.values(m).includes(t)){ m[j]=t; hits++; if(t===C.idCol) hasId=true; }
    });
    if(hasId&&hits>=2){ hdrRow=i; colmap=m; break; }
  }
  if(hdrRow<0) throw new Error('no recognizable header row (need at least Site ID + one more column)');
  const officers=officerMapFromRows();
  const idc=ci(C.idCol);
  const byId={}; ROWS.forEach(r=>{const k=String(r[idc]||'').trim().toUpperCase(); if(k) byId[k]=r;});
  let updated=0, added=0, seen=0;
  for(let i=hdrRow+1;i<arr.length;i++){
    const raw=arr[i]||[];
    const vals={};
    for(const j in colmap){ const v=(raw[j]==null?'':String(raw[j])).trim(); if(v) vals[colmap[j]]=v; }
    const id=(vals[C.idCol]||'').toUpperCase();
    if(!id||!/[A-Za-z]/.test(id)) continue;            // skips the autofilter count row etc.
    seen++;
    let r=byId[id], isNew=false, changed=false;
    if(!r){ r=new Array(COLS.length).fill(''); r[idc]=vals[C.idCol]; byId[id]=r; ROWS.push(r); isNew=true; }
    for(const col in vals){
      if(col===C.idCol) continue;
      const k=ci(col); if(k<0) continue;
      if(String(r[k]||'').trim()!==vals[col]){ r[k]=vals[col]; changed=true; }
    }
    // depot supplied -> fill matching officer + contact
    if(C.merge.officerFrom && vals[C.merge.officerFrom]){
      const rec=officers[vals[C.merge.officerFrom].toLowerCase()];
      if(rec){
        const oi2=ci(C.merge.officerCol), ti2=ci(C.merge.contactCol);
        if(oi2>=0&&rec.officer&&String(r[oi2]||'').trim()!==rec.officer){ r[oi2]=rec.officer; changed=true; }
        if(ti2>=0&&rec.contact&&String(r[ti2]||'').trim()!==rec.contact){ r[ti2]=rec.contact; changed=true; }
      }
    }
    if(isNew) added++; else if(changed) updated++;
  }
  return {updated,added,seen};
}
/* two questions before publishing over the list everybody reads - ask.js,
   with confirm() behind it only if that file never loaded */
const askTwice=steps=>window.Ask?window.Ask.twice(steps)
  :Promise.resolve(window.confirm(steps.map(s=>s.title).join('\n\n')));

$('file').addEventListener('change', async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  toast('Reading '+f.name+'…');
  /* Reading the workbook and publishing it are two different jobs that fail in
     two different ways, and one catch around both told us the file could not be
     read when what had actually happened was that the page was missing a
     script. Whatever goes wrong now says which half it went wrong in. */
  let arr;
  try{
    const buf=await f.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array'});
    const ws=wb.Sheets[C.sheetName]||wb.Sheets[wb.SheetNames[0]];
    if(!ws) throw new Error('sheet not found');
    arr=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
  }catch(err){console.error(err);toast('Could not read that file: '+err.message,5000);return}
  try{
    // full-format sheet? (row 0 matches the bundled columns) -> replace everything
    const hdr0=(arr[0]||[]).map(c=>String(c).trim());
    const overlap=hdr0.filter(h=>COLS.includes(h)).length;
    if(!C.merge || overlap>=Math.ceil(COLS.length*0.8)){
      const cols=hdr0;
      const rows=[];
      for(let i=1;i<arr.length;i++){
        const r=arr[i].map(v=>(v==null?'':String(v)).trim());
        if(!r.some(v=>v&&v!=='Unknown'&&v!=='0'&&v!=='Undefined'&&v!=='Deny')) continue;
        rows.push(r);
      }
      /* This branch replaces everything, so what it is handed has to be worth
         replacing everything with. A file picked by mistake parses into a sheet
         like any other - a text file becomes one cell - and without these two
         questions it would publish nothing over thousands of live rows, which
         is not an upload failing, it is an upload succeeding at deleting. */
      if(cols.indexOf(C.idCol)<0){
        toast('That sheet has no '+C.idCol+' column - is it the right file? Nothing was published',7000);
        return;
      }
      if(!rows.length){
        toast('That sheet has a heading and no rows. Nothing was published',6000);
        return;
      }
      const live=ROWS.length;
      const okRep=await askTwice([
        {title:'Replace every '+C.unitSingular+' with this file?',
         body:f.name+' has '+rows.length.toLocaleString()+' '+C.unit+'. It is a full sheet, so it takes the place of the whole list rather than adding to it.',
         no:'Cancel',yes:'Yes, go on'},
        {title:'Every device sees the new list at once.',
         body:(live?'The '+live.toLocaleString()+' '+C.unit+' there now are replaced':'Nothing is published yet, so this becomes the list')+
           '. A '+C.unitSingular+' that is not in this file is gone from the lookup until a sheet with it is uploaded again.',
         no:'No, leave it',yes:'Replace the list'}
      ]);
      if(!okRep){toast('Nothing was published');return}
      await publishDataset(cols,rows,'Replaced');
    }else{
      const res=mergeUpload(arr);
      /* mergeUpload has already folded the file into the rows on screen, so a
         "no" has to read the published list back rather than leave the
         unpublished merge sitting there looking live */
      const okMer=await askTwice([
        {title:'Merge '+f.name+' into the list?',
         body:res.updated.toLocaleString()+' '+C.unit+' change and '+res.added.toLocaleString()+' are added. Blank cells never wipe what is already there.',
         no:'Cancel',yes:'Yes, go on'},
        {title:'The changes go to every device.',
         body:'Values in the file overwrite the ones on the list for those '+C.unit+'. The only undo is uploading the old values again.',
         no:'No, leave it',yes:'Publish the changes'}
      ]);
      if(!okMer){await loadData();toast('Nothing was published');return}
      ROWS.forEach(r=>{delete r.__blob});
      const merged=ROWS.map(r=>r.slice(0,COLS.length));
      await publishDataset(COLS,merged,'Merged · '+res.updated+' updated · '+res.added+' added');
    }
    await loadData();
  }catch(err){console.error(err);toast('Read the file, but could not publish it: '+err.message,6000)}
});

/* Push a whole dataset to the shared database. Writes are refused without a
   session, so ask for one first rather than letting the upload fail deep in a
   chunk loop with a policy error. */
async function publishDataset(cols,rows,what){
  /* Said plainly rather than left to throw a TypeError two frames down, so the
     next tool that adopts this engine and forgets the tag is told what it is
     missing instead of being sent to look at the spreadsheet library. */
  if(!window.AuthGate){ toast('This page cannot sign in - authgate.js is not loaded on it',7000); return; }
  const s=await window.AuthGate.require();
  if(!s){ toast('Cancelled - nothing was published'); return; }
  toast('Publishing '+rows.length.toLocaleString()+' '+C.unit+'…',60000);
  await window.DB.publish(C.syncKey,cols,rows,(done,total)=>{
    if(done<total) toast('Publishing… '+done.toLocaleString()+' of '+total.toLocaleString(),60000);
  });
  toast(what+' · '+rows.length.toLocaleString()+' '+C.unit+' · every device sees this now',5000);
}

/* events */
let dq; q.addEventListener('input',()=>{clearTimeout(dq);dq=setTimeout(route,120)});
$('clr').onclick=()=>{q.value='';q.focus();route()};
addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus()}});

/* footer - the data-editing links show only in owner mode (see _lib/owner.js) */
const editLinks = window.IS_OWNER
  ? '<br><a href="#" id="refresh">Update data from Excel…</a>' +
    ' · <a href="#" id="acct" style="color:var(--muted)">…</a>'
  : '';
/* There is no "reset to bundled" any more, because there is nothing bundled
   to reset to. */
const lead = window.DB && window.DB.configured()
  ? 'Read from the database · '
  : 'Not connected - the anon key is missing · ';
document.querySelector('main').insertAdjacentHTML('beforeend',
  '<footer>'+lead+C.source+editLinks+'</footer>');
if(window.IS_OWNER){
  $('refresh').onclick=e=>{e.preventDefault();$('file').click()};
  const ac=$('acct');
  if(ac){
    const paint=s=>{ac.textContent=s?('signed in as '+s.user.email+' · sign out'):'sign in to publish'};
    window.DB.session().then(paint);
    window.DB.onAuth(paint);
    ac.onclick=async e=>{e.preventDefault();
      const s=await window.DB.session();
      if(s){await window.DB.signOut();toast('Signed out');paint(null);}
      else{const ns=await window.AuthGate.signIn(); if(ns){toast('Signed in');paint(ns);}}
    };
  }
}

loadData();
})();
