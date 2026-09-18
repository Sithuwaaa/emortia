/* Site Access · the unified view.

   One screen for the two things this list is asked: "tell me about this site"
   and "which sites". The search box does both - a site ID, a name, a district,
   or the filter language typed straight in (district:kandy, depot:negombo,
   code:cm, 24h) - and the Filter panel is the same questions for somebody who
   would rather tap. The list is on the left and the site you are looking at
   stays open on the right, so going down a depot's sites is one click each
   rather than out to the list and back in again. On a phone the two take turns.

   The data, the live updates and the owner's upload all stay in _lib/lookup.js;
   this file is handed the rows each time they change and draws them. */
(function(){
const $ = id => document.getElementById(id);

const COL = {
  id:'Site_ID', other:'Other_Site_IDS', name:'Site_Name', region:'New_Region',
  district:'District', depot:'Depot', officer:'Depot_officer(FME_ID)', contact:'Depot_Contact',
  lat:'Latitude', lng:'Longitude', tcat:'Tower_Category', ttype:'Tower_Type', towner:'Tower_Owner',
  party:'Access_Permission_providing_Party', arrange:'Permission_arrangement_final',
  reason:'Time_restricted_reason', wkday:'Week_Days_Access_Restricted_time',
  wkend:'Week_ends/Holydays_Access_Restricted_time', times:'Time_Restrictions_final',
  address:'Additional_data-Site_Address'
};

/* the three things a site's access can be, and how each one looks */
const TONE = {
  open:       { label:'24 hour',        cls:'t-open' },
  restricted: { label:'Restricted',     cls:'t-warn' },
  unknown:    { label:'Access unknown', cls:'t-none' }
};

/* the filter panel's rows, and the words the search box accepts for each */
const DIMS = [
  { key:'code',      label:'Code',     word:'code' },
  { key:'region',    label:'Region',   word:'region' },
  { key:'district',  label:'District', word:'district' },
  { key:'depot',     label:'Depot',    word:'depot' },
  { key:'towerKind', label:'Tower',    word:'tower' }
];
const SCOPE = {}; DIMS.forEach(d => SCOPE[d.word] = d.key);
const TOP = 8, PAGE = 60;
const RECENT_KEY = 'site_access_recent', RECENT_MAX = 12;

let A = null, SITES = [], BY_ID = {};
const st = { q:'', filters:{}, open:false, expanded:{}, near:null, nearOn:false,
             selId:'', listOnly:true, limit:PAGE };
let PAIR = [];
const narrowMq = matchMedia('(max-width: 760px)');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = s => parseFloat(String(s).replace(/[^\d.\-]/g,''));

/* ---------------------------------------------------------------- the rows */
function shape(){
  const v = (r,k) => { const s = String(A.fieldVal(r, COL[k]) || '').trim(); return A.blank(s) ? '' : s; };
  SITES = A.rows.map(r => {
    const id = v(r,'id');
    const times = v(r,'times');
    const kind = !times ? 'unknown' : (/no\s*(time\s*)?restrict/i.test(times) ? 'open' : 'restricted');
    const la = num(v(r,'lat')), ln = num(v(r,'lng'));
    const ok = isFinite(la) && isFinite(ln) && !(la === 0 && ln === 0) && Math.abs(la) <= 90 && Math.abs(ln) <= 180;
    const tcat = v(r,'tcat'), ttype = v(r,'ttype');
    return {
      raw:r, id, other:v(r,'other'), name:v(r,'name'),
      region:v(r,'region'), district:v(r,'district'), depot:v(r,'depot'),
      code:(id.match(/^[A-Za-z]+/) || [''])[0].toUpperCase(),
      towerKind: tcat || (ttype.split(/\s+/)[0] || ''),
      tower:[tcat, ttype].filter(Boolean).join(' · '), tcat, ttype, towner:v(r,'towner'),
      officer:v(r,'officer').replace(/_\d+$/,'').trim(), contact:v(r,'contact'),
      address:v(r,'address'), coord: ok ? { la, ln } : null,
      kind, times, reason:v(r,'reason'), wkday:v(r,'wkday'), wkend:v(r,'wkend'),
      party:v(r,'party'), arrange:v(r,'arrange'),
      blob:[id, v(r,'other'), v(r,'name'), v(r,'district'), v(r,'region'), v(r,'depot'), v(r,'address')]
             .join(' ').toLowerCase()
    };
  }).filter(s => s.id);
  BY_ID = {}; SITES.forEach(s => BY_ID[s.id.toLowerCase()] = s);
}

/* ------------------------------------------------------- the filter language

   The search box doubles as the filters, so somebody on a phone who would
   rather type than open a panel can say depot:negombo and have it mean what
   the chip means. A value with a space in it is written with an underscore:
   district:nuwara_eliya. */
function parseQuery(raw){
  const scoped = {}, words = [];
  let flag = '';
  for (const part of raw.trim().split(/\s+/).filter(Boolean)){
    const m = part.match(/^([a-z]+):(.+)$/i);
    if (m && SCOPE[m[1].toLowerCase()]){
      scoped[SCOPE[m[1].toLowerCase()]] = m[2].toLowerCase().replace(/_/g,' ');
      continue;
    }
    if (/^24h?$/i.test(part)){ flag = 'open'; continue; }
    if (/^restricted$/i.test(part)){ flag = 'restricted'; continue; }
    words.push(part.toLowerCase());
  }
  return { scoped, words, flag };
}

/* Everything still standing, ignoring one dimension's own choice - which is how
   the District row shrinks to the Western districts the moment Western is
   picked, instead of offering places that would leave nothing. */
function rowsExcept(skip){
  const { scoped, words, flag } = parseQuery(st.q);
  return SITES.filter(s => {
    for (const k in st.filters) if (k !== skip && s[k] !== st.filters[k]) return false;
    for (const k in scoped) if (k !== skip && !String(s[k]).toLowerCase().includes(scoped[k])) return false;
    if (flag && s.kind !== flag) return false;
    if (words.length && !words.every(w => s.blob.includes(w))) return false;
    return true;
  });
}
const narrowed = () => !!(st.q.trim() || Object.keys(st.filters).length);

function results(){
  let rows = rowsExcept(null);
  const { words } = parseQuery(st.q);
  /* the site whose ID you typed goes first, whatever else also matched */
  if (words.length === 1){
    const hit = BY_ID[words[0]];
    if (hit && rows.indexOf(hit) > 0) rows = [hit].concat(rows.filter(s => s !== hit));
  }
  if (st.nearOn && st.near){
    rows = rows.filter(s => s.coord).map(s => ({ s, d: A.airKm(st.near, s.coord) }))
               .sort((a,b) => a.d - b.d).map(x => (x.s._km = x.d, x.s));
  }
  return rows;
}

/* ------------------------------------------------------------ recently opened */
function recents(){
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY)) || []).map(id => BY_ID[String(id).toLowerCase()]).filter(Boolean); }
  catch(e){ return []; }
}
function remember(s){
  try {
    const ids = (JSON.parse(localStorage.getItem(RECENT_KEY)) || []).filter(x => x !== s.id);
    ids.unshift(s.id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX)));
  } catch(e){}
}

/* ------------------------------------------------------------------- links */
const navUrl = s => s.coord
  ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(s.coord.la + ',' + s.coord.ln)
  : '';
const telUrl = s => s.contact ? 'tel:' + s.contact.replace(/[^0-9+]/g,'') : '';

/* ------------------------------------------------------------------ drawing */
function draw(){
  drawFresh(); drawBar(); drawPanel(); drawTray(); drawBody();
}

function drawFresh(){
  const n = SITES.length;
  const when = A.savedAt ? ' · updated ' + A.savedAt : '';
  $('freshTxt').textContent = n
    ? n.toLocaleString() + ' sites' + when
    : (A.connected() ? 'nothing published yet' : 'not connected');
  $('fresh').classList.toggle('off', !n);
}

function drawBar(){
  const active = Object.keys(st.filters);
  const fb = $('fBtn');
  fb.classList.toggle('on', st.open || !!active.length);
  fb.setAttribute('aria-expanded', String(st.open));
  $('fN').textContent = active.length ? String(active.length) : '';
  $('fN').hidden = !active.length;

  const nb = $('nearBtn');
  nb.classList.toggle('on', st.nearOn);
  nb.setAttribute('aria-pressed', String(st.nearOn));

  $('tokens').innerHTML = active.map(k => {
    const d = DIMS.find(x => x.key === k);
    return '<button class="tok" data-k="' + esc(k) + '" title="Remove this filter">' +
      '<span>' + esc(d ? d.word : k) + '</span>' + esc(st.filters[k]) + '<i>×</i></button>';
  }).join('');
  [...$('tokens').querySelectorAll('.tok')].forEach(b => b.onclick = () => pick(b.dataset.k, st.filters[b.dataset.k]));

  const n = rowsExcept(null).length;
  $('count').textContent = SITES.length ? n.toLocaleString() + (n === 1 ? ' site' : ' sites') : '';
  $('mapBtn').hidden = !(narrowed() && n);
}

function drawPanel(){
  const p = $('fPanel');
  p.hidden = !st.open;
  if (!st.open) return;
  p.innerHTML = DIMS.map(d => {
    const tally = {};
    for (const s of rowsExcept(d.key)){ const v = s[d.key]; if (v) tally[v] = (tally[v] || 0) + 1; }
    const items = Object.keys(tally).map(v => ({ v, n:tally[v] }))
      .sort((a,b) => b.n - a.n || a.v.localeCompare(b.v));
    if (!items.length) return '';
    const chosen = st.filters[d.key] || '';
    let head = st.expanded[d.key] ? items : items.slice(0, TOP);
    /* what is chosen stays in view even when it is not among the busiest */
    if (chosen && !head.some(i => i.v === chosen)){
      head = [items.find(i => i.v === chosen) || { v:chosen, n:0 }].concat(head.slice(0, TOP - 1));
    }
    const rest = items.length - head.length;
    return '<div class="dim"><div class="dl">' + esc(d.label) + '</div><div class="dv">' +
      head.map(i => '<button class="opt' + (chosen === i.v ? ' on' : '') + '" data-k="' + d.key + '" data-v="' + esc(i.v) + '">' +
        esc(i.v) +
        /* the count only on the one you picked - forty numbers is a table nobody reads */
        (chosen === i.v ? '<b>' + i.n.toLocaleString() + '</b>' : '') + '</button>').join('') +
      (rest > 0 ? '<button class="more" data-x="' + d.key + '">+' + rest + ' more</button>' : '') +
      '</div></div>';
  }).join('');
  [...p.querySelectorAll('.opt')].forEach(b => b.onclick = () => pick(b.dataset.k, b.dataset.v));
  [...p.querySelectorAll('.more')].forEach(b => b.onclick = () => { st.expanded[b.dataset.x] = true; drawPanel(); });
}

function pick(key, v){
  if (st.filters[key] === v) delete st.filters[key]; else st.filters[key] = v;
  st.expanded[key] = false;
  st.limit = PAGE;
  draw();
}

/* the hop, when two sites have been picked for it */
function drawTray(){
  const t = $('tray');
  if (!PAIR.length){ t.hidden = true; t.innerHTML = ''; return; }
  t.hidden = false;
  if (PAIR.length === 1){
    t.innerHTML = '<span class="leg">' + esc(PAIR[0].id) + '</span>' +
      '<span class="brg">open another site and measure from it to get the hop</span>' +
      '<span class="sp"></span><button class="ghost sm" id="tClr">Clear</button>';
  } else {
    const [a, b] = PAIR;
    t.innerHTML = '<span class="leg">' + esc(a.id) + ' → ' + esc(b.id) + '</span>' +
      '<span class="km">' + A.airKm(a.coord, b.coord).toFixed(2) + ' km</span>' +
      '<span class="brg">' + A.bearing(a.coord, b.coord).toFixed(1) + '° out · ' +
        A.bearing(b.coord, a.coord).toFixed(1) + '° back</span>' +
      '<span class="sp"></span><button class="ghost sm" id="tKml">The hop as KML</button>' +
      '<button class="ghost sm" id="tClr">Clear</button>';
  }
  $('tClr').onclick = () => { PAIR = []; draw(); };
  const k = $('tKml');
  if (k) k.onclick = () => A.saveKml([PAIR[0].raw, PAIR[1].raw], PAIR[0].id + ' to ' + PAIR[1].id, [PAIR[0].raw, PAIR[1].raw]);
}

function drawBody(){
  const narrow = narrowMq.matches;
  const list = $('list'), det = $('detail');

  if (!SITES.length){
    list.hidden = false; det.hidden = true;
    list.innerHTML = '<div class="blank"><b>' +
      (A.connected() ? 'Nothing published yet' : 'Not connected') + '</b>' +
      (A.connected()
        ? 'This tool reads the database and nothing else. Sithara needs to open it signed in and upload the workbook once.'
        : 'The database key is missing from this copy of the site.') + '</div>';
    return;
  }

  let rows, label;
  if (narrowed() || st.nearOn){
    rows = results();
    label = st.nearOn ? (st.near ? 'Nearest to you' : 'Finding where you are…') : 'Results';
  } else {
    rows = recents();
    label = rows.length ? 'Recently opened' : 'Start here';
  }

  /* on a wide screen something is always open on the right: the one you
     picked, or failing that the first thing on the list */
  let sel = BY_ID[st.selId.toLowerCase()] || null;
  if (!narrow && !sel && rows.length) sel = rows[0];

  const showList = !narrow || st.listOnly;
  const showDet  = !!sel && (!narrow || !st.listOnly);
  list.hidden = !showList; det.hidden = !showDet;

  if (showList){
    const shown = rows.slice(0, st.limit);
    let h = '<div class="ll">' + esc(label) + '</div>';
    if (!rows.length){
      h += narrowed()
        ? '<div class="blank">Nothing matches that.<br>Try a shorter term or drop a filter.</div>'
        : '<div class="blank"><b>Search a site, or open Filter.</b>' +
          'A site ID, a name or a district. You can also type the filters straight in: ' +
          '<code>district:kandy</code> <code>depot:negombo</code> <code>code:cm</code> <code>24h</code></div>';
    }
    h += shown.map(s => {
      const tone = TONE[s.kind];
      const nav = navUrl(s);
      return '<div class="card' + (sel === s ? ' on' : '') + '" data-id="' + esc(s.id) + '" tabindex="0">' +
        '<div class="ct"><div class="cl">' +
          '<div class="cid">' + esc(s.id) + '</div>' +
          '<div class="cnm">' + esc(s.name || '—') + '</div>' +
          '<div class="csub">' + esc([s.district, s.depot ? s.depot + ' depot' : ''].filter(Boolean).join(' · ')) + '</div>' +
        '</div>' +
        (st.nearOn && st.near && s._km != null ? '<div class="ckm"><b>' + s._km.toFixed(1) + '</b><span>KM</span></div>' : '') +
        '</div>' +
        '<div class="cb">' +
          '<span class="tone ' + tone.cls + '">' + tone.label + '</span>' +
          (s.tower ? '<span class="tw">' + esc(s.tower) + '</span>' : '') +
          '<span class="sp"></span>' +
          (nav ? '<a class="navb" href="' + nav + '" target="_blank" rel="noopener">Navigate</a>' : '') +
        '</div></div>';
    }).join('');
    if (rows.length > shown.length){
      h += '<button class="ghost moreRows" id="moreRows">Show ' +
        Math.min(PAGE, rows.length - shown.length) + ' more · ' +
        (rows.length - shown.length).toLocaleString() + ' left</button>';
    }
    list.innerHTML = h;
    [...list.querySelectorAll('.card')].forEach(el => {
      const go = () => open(BY_ID[el.dataset.id.toLowerCase()]);
      el.onclick = e => { if (e.target.closest('a')) return; go(); };
      el.onkeydown = e => { if (e.key === 'Enter') go(); };
    });
    const mr = $('moreRows'); if (mr) mr.onclick = () => { st.limit += PAGE; drawBody(); };
  }

  if (showDet) drawDetail(sel, narrow);
}

function drawDetail(s, narrow){
  const tone = TONE[s.kind];
  const nav = navUrl(s), tel = telUrl(s);
  const picked = PAIR.indexOf(s) >= 0;
  const row = (k, v, mono) => v
    ? '<div class="fr"><div class="fk">' + esc(k) + '</div><div class="fv' + (mono ? ' mono' : '') + '">' + esc(v) + '</div></div>'
    : '';
  const accessRows =
    row('Permission from', s.party) + row('Arrangement', s.arrange) +
    row('Restriction', s.times) + row('Why', s.reason) +
    row('Weekdays', s.wkday) + row('Weekends', s.wkend) +
    row('Depot officer', s.officer) + row('Contact', s.contact, true);
  const techRows =
    row('Coordinates', s.coord ? s.coord.la + ', ' + s.coord.ln : '', true) +
    row('Region', s.region) + row('District', s.district) + row('Depot', s.depot) +
    row('Tower category', s.tcat) + row('Tower type', s.ttype) + row('Tower owner', s.towner) +
    row('Other IDs', s.other && s.other !== s.id ? s.other : '', true);

  $('detail').innerHTML =
    (narrow ? '<button class="back" id="back">← All results</button>' : '') +
    '<div><div class="did">' + esc(s.id) + '</div>' +
    '<div class="dnm">' + esc(s.name || '—') + '</div>' +
    (s.address ? '<div class="dad">' + esc(s.address) + '</div>' : '') + '</div>' +
    '<div class="dtags"><span class="tone ' + tone.cls + '">' + tone.label + '</span>' +
      (s.tower ? '<span class="tw">' + esc(s.tower) + '</span>' : '') + '</div>' +
    '<div class="dacts">' +
      (nav ? '<a class="bp" href="' + nav + '" target="_blank" rel="noopener">Navigate</a>'
           : '<span class="bp dis" title="This site has no coordinates">Navigate</span>') +
      (tel ? '<a class="bs" href="' + tel + '">Call depot officer</a>'
           : '<span class="bs dis" title="No contact number on the list">Call depot officer</span>') +
    '</div>' +
    '<div class="dmini">' +
      '<button class="ghost sm" id="dCopy">Copy details</button>' +
      (s.coord ? '<button class="ghost sm' + (picked ? ' on' : '') + '" id="dMeas">' +
        (picked ? 'Picked for the hop' : 'Measure from here') + '</button>' : '') +
    '</div>' +
    (accessRows ? '<div class="sec"><div class="sh">Access</div>' + accessRows + '</div>' : '') +
    (techRows ? '<div class="sec rule"><div class="sh">Technical</div>' + techRows + '</div>' : '');

  const bk = $('back'); if (bk) bk.onclick = () => { st.listOnly = true; drawBody(); scrollTo(0,0); };
  $('dCopy').onclick = () => {
    const C = window.LOOKUP_CONFIG;
    const text = C.copyText ? C.copyText(s.raw, A.fieldVal) : s.id + ' - ' + s.name;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => A.toast('Details copied')).catch(() => {});
  };
  const m = $('dMeas');
  if (m) m.onclick = () => {
    const at = PAIR.indexOf(s);
    if (at >= 0) PAIR.splice(at, 1);
    else { if (PAIR.length >= 2) PAIR.shift(); PAIR.push(s); }
    drawTray(); drawDetail(s, narrowMq.matches);
  };
}

function open(s){
  if (!s) return;
  st.selId = s.id;
  st.listOnly = false;
  remember(s);
  drawBody();
  if (narrowMq.matches) scrollTo(0, 0);
}

/* ------------------------------------------------------------------ near me */
function toggleNear(){
  if (st.nearOn){ st.nearOn = false; draw(); return; }
  if (!navigator.geolocation){ A.toast('This browser cannot tell where you are'); return; }
  st.nearOn = true; st.limit = PAGE; draw();
  navigator.geolocation.getCurrentPosition(
    p => { st.near = { la:p.coords.latitude, ln:p.coords.longitude }; draw(); },
    e => {
      st.nearOn = false; draw();
      A.toast(e.code === 1 ? 'Location is blocked for this site - allow it in the browser to sort by distance'
                           : 'Could not get your location', 4500);
    },
    { enableHighAccuracy:false, timeout:12000, maximumAge:120000 });
}

/* ------------------------------------------------------------------- wiring */
let wired = false;
function wire(){
  if (wired) return; wired = true;
  const q = $('q');
  let dq;
  q.addEventListener('input', () => {
    $('qClr').hidden = !q.value;
    $('search').classList.toggle('on', !!q.value);
    clearTimeout(dq);
    dq = setTimeout(() => { st.q = q.value; st.limit = PAGE; st.listOnly = true; draw(); }, 90);
  });
  /* Enter on a single answer opens it, which is how an ID search ends */
  q.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    st.q = q.value;
    const r = results();
    if (r.length) open(r[0]);
  });
  $('qClr').onclick = () => { q.value = ''; st.q = ''; $('qClr').hidden = true; $('search').classList.remove('on'); q.focus(); draw(); };
  $('fBtn').onclick = () => { st.open = !st.open; drawBar(); drawPanel(); };
  $('nearBtn').onclick = toggleNear;
  $('mapBtn').onclick = () => {
    const rows = results();
    const name = Object.keys(st.filters).map(k => st.filters[k]).concat(st.q.trim() ? [st.q.trim()] : []).join(' · ') || 'Sites';
    A.saveKml(rows.map(s => s.raw), name);
  };
  addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== q){ e.preventDefault(); q.focus(); }
  });
  const onMq = () => { st.listOnly = true; drawBody(); };
  if (narrowMq.addEventListener) narrowMq.addEventListener('change', onMq);
  else narrowMq.addListener(onMq);
}

window.SiteAccessUI = {
  render(api){
    A = api;
    shape();
    /* a refresh brings new row objects; what was picked has to be found again */
    PAIR = PAIR.map(p => BY_ID[p.id.toLowerCase()]).filter(Boolean);
    wire();
    draw();
  }
};
})();
