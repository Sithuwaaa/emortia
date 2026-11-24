/* Tooway Warehouse - tools/warehouse/warehouse.js

   Stock in and out of the Tooway warehouse: inbound new stock (GRN) and site
   returns (SRN), outbound to sites and 3rd parties (OBN) with a printed A4
   note, cable drums by reading, pins and minimums for the Overview.

   Reads and writes only through DB.wh* in tools/_lib/db.js; every save is one
   server-side RPC (see supabase/NNN_tooway_warehouse.sql), so note numbers,
   drum readings and stock moves land together or not at all. */
/* ================= DATA · live, through DB.wh* in tools/_lib/db.js =================
   Nothing is kept in the page: every save is one RPC (wh_inbound / wh_outbound,
   numbered and applied in one transaction on the server), then the page reloads
   what the server holds. The shapes below (lines = stock items, tickets = notes)
   are the same ones the approved mock-up rendered from. */
const MC = new Map();   // Material Codes: code -> {code,name,cat (raw type)}
const SHORT = {'BB,MPT,EXT,BB accs':'Baseband','Com & Filters':'Combiners','H & E SFP':'SFP','AAU & AIR':'AAU','CenRF IBS':'IBS','RRU PWR':'RRU PWR','PWR':'Power','Radio':'RRU','Jumpers':'Jumpers','Antenna':'Antenna','Fibers':'Fibers','IP':'IP','TX':'TX','BBU':'BBU','Civil':'Civil'};
const TYPE_OF = Object.fromEntries(Object.entries(SHORT).map(([k,v])=>[v,k]));   // short category -> Material Codes type
const CATS = ['RRU','AAU','Antenna','Baseband','BBU','Fibers','Jumpers','Cables','Power','RRU PWR','SFP','IP','TX','Combiners','IBS','Civil','Other'];
const shortCat = c => SHORT[c] || c || 'Other';
const PURPOSES=['Repair','Return to vendor','Loan','Transfer','Testing','Scrap'];
const CONDS=['Good','Faulty','Scrap'];
const NEWPJ='+ New project…';
let PROJECTS=[], PARTIES=[], SOURCES=[], VENDORS=[], SITES={};
/* note id + item id -> wh_lines.id, filled as the notes are read */
const LID=new Map();
/* outbound wh_lines.id -> how much of it has already been returned */
const RET=new Map();
const pad=(n,w=2)=>String(n).padStart(w,'0');
let lines=[], tickets=[], pins=new Set(), mins={}, newMats=new Map(), proj='';
/* The warehouses stock comes from. Loaded with everything else; empty
   until 053 is run, which is survivable - the field just offers nothing
   to pick and takes whatever is typed. */
/* ONE LOOKUP MECHANISM, FIVE LISTS. There were four tables of one column
   and a fifth list with nowhere to live, each with its own "+ new"
   behaviour. 059 made them one table keyed by kind; this makes them one
   component and one add. A list that has not been migrated yet is simply
   empty, and an empty list still takes whatever is typed. */
const LOOK={project:[],party:[],source:[],vendor:[],location:[]};
const lookList=k=>LOOK[k]||[];
/* The component. An input backed by a datalist: pick an existing name or
   type a new one, and the new one joins the list when it is used. No
   modal, no separate "+ new" button to forget to wire up. */
function lookBox(kind,id,value,ph,extra){
  return `<input class="in" id="${id}" list="lk_${kind}" placeholder="${esc(ph||'type or pick')}" value="${esc(value||'')}" ${extra||''}>`
    + `<datalist id="lk_${kind}">${lookList(kind).map(x=>`<option>${esc(x)}</option>`).join('')}</datalist>`;
}
/* Remembering a name is never allowed to fail the thing that used it. */
async function lookAdd(kind,name){
  name=String(name==null?'':name).trim(); if(!name) return;
  if(lookList(kind).includes(name)) return;
  try{ await DB.whAddLookup(kind,name); LOOK[kind].push(name); LOOK[kind].sort((a,b)=>a.localeCompare(b)); }catch(e){}
}

const condChip=c=>c&&c!=='Good'?`<span class="st ${c==='Faulty'?'short':'out'}" style="margin-left:6px">${c.toUpperCase()}</span>`:'';
const isDummy=sn=>/^DMY-/.test(sn||'');
/* WHERE IT CAME FROM. A different question from where it is now, and a
   different one again from who owns it - vendor. REDEP has no warehouse
   behind it, which is the whole meaning of the word, so it says REDEP
   rather than leaving the space blank and looking like missing data.
   Empty until 056 and 057 are run, because the columns do not exist in
   the database yet; an empty chip is correct then, not broken. */
function originOf(L){
  if(!L) return '';
  if(L.source==='redep') return '<span class="chip org rd">REDEP</span>';
  if(L.source==='local') return '<span class="chip org lp">Local purchase</span>';
  if(L.fromWh) return '<span class="chip org">'+esc(L.fromWh)+'</span>';
  return '';
}
/* A serial that is already on something else. THIS WARNS AND DOES NOT
   REFUSE, deliberately. The same serial really does come back: a unit
   returned and booked in again, a label misread off a worn plate, two
   units from one batch stamped alike. wh_items_sn is a plain index and
   not a unique one for that reason, and the warehouse has to be able to
   write down what it is actually holding rather than what would validate.
   So this says where the other one is and lets the entry stand.
   Dummies are skipped: wh_next('DMY') hands out a fresh number each
   time, so two of those matching would be noise, not news. */
const snTwin=(sn,exceptId)=>{ const v=(sn||'').trim().toLowerCase();
  if(!v||isDummy(sn)) return null;
  return lines.find(L=>L.sn&&L.sn.trim().toLowerCase()===v&&L.id!==exceptId)||null; };
const twinSays=t=>`<span class="mstate" style="color:var(--warn)">● serial already on ${esc(t.code||t.name)}${t.inTicket?' · '+esc(t.inTicket):''} - saved anyway</span>`;
/* Updated in place rather than by redrawing the table. drawRows() replaces
   the whole tbody, so calling it from the serial box would destroy the
   element the user is tabbing into. */
function snWarn(i,which){ const rows=which?nDn.rows:nIn.rows, r=rows[i]; if(!r) return;
  const e=$('#snw'+which+'_'+i); if(!e) return;
  const t=snTwin(r.sn, r.lineId||undefined); e.innerHTML=t?twinSays(t):''; }
const snHtml=sn=>isDummy(sn)?`<span class="dmy">${esc(sn)}</span>`:esc(sn||'—');
const today=()=>{ const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); };
const ME=()=>{ try{ return (window.Access&&Access.currentUser&&Access.currentUser())||''; }catch(e){ return ''; } };
const OWNER=()=>{ try{ return !!(window.Access&&Access.isOwner&&Access.isOwner()); }catch(e){ return false; } };
const siteKey=s=>String(s==null?'':s).toUpperCase().replace(/[^A-Z0-9]/g,'');
const siteLookup=id=>SITES[siteKey(id)]||'';
/* Same index the Austin SWAP page built from Site Access: id (and other ids) -> name. */
function buildSiteIndex(ds){
  const idx={}; if(!ds||!Array.isArray(ds.cols)||!Array.isArray(ds.rows)) return idx;
  const at=n=>ds.cols.findIndex(c=>String(c||'').trim().toLowerCase()===n);
  const idCols=['site_id','siteid','site id','other_site_ids'].map(at).filter(i=>i>=0);
  const nameCol=['site_name','sitename','site name'].map(at).find(i=>i>=0);
  if(!idCols.length||nameCol==null||nameCol<0) return idx;
  ds.rows.forEach(r=>{ const nm=String(r[nameCol]==null?'':r[nameCol]).trim(); if(!nm) return;
    idCols.forEach(c=>String(r[c]==null?'':r[c]).split(/[,;/]+/).forEach(one=>{ const k=siteKey(one); if(k&&!idx[k]) idx[k]=nm; })); });
  return idx;
}
/* wDummy is gone with the buttons that called it. He types dummy
   serials himself, so the warehouse no longer hands them out - but
   isDummy stays, because the Inventory tab still has to be able to show
   and filter which serials are placeholders. That is a question about
   stock on a shelf, not about the box he is typing into. */

function fromDB(d){
  lines=d.items.map(r=>({id:r.id,code:r.code||'',name:r.name,cat:r.cat||'Other',uom:r.uom||'EA',qty:+r.qty,sn:r.sn||'',loc:r.bin||'',project:r.project||'',
    status:r.status,source:r.source==='direct'?'pending':r.source,pending:r.source==='direct',cond:r.cond||'',
    vendor:r.vendor||'',pack:r.pack||'',fromWh:r.from_wh||'',
    inTicket:r.in_note||'',inDate:r.in_date||'',fromSite:r.from_site||'',fromSiteName:r.from_site_name||'',res:r.reservation_no||'',
    outTicket:r.out_note||'',outDate:r.out_date||'',site:r.site_id||'',siteName:r.site_name||'',party:r.party||'',isNew:!!r.is_new,
    drum:r.drum_name?{name:r.drum_name,lower:+r.drum_lower,cur:+r.drum_upper,
      upper:+(r.orig_upper!=null?r.orig_upper:r.drum_upper),
      origLower:+(r.orig_lower!=null?r.orig_lower:r.drum_lower),
      origUpper:+(r.orig_upper!=null?r.orig_upper:r.drum_upper),cuts:[]}:null,
    read:r.read_start!=null?{start:+r.read_start,end:+r.read_end}:null}));
  const byId=new Map(lines.map(L=>[L.id,L])), K={GRN:'IN',SRN:'RT',OBN:'DN',RTN:'RN'};
  tickets=d.notes.map(n=>({id:n.id,type:K[n.kind],date:n.note_date,project:n.project||'',res:n.reservation_no||'',ref:n.ref||'',site:n.site_id||'',siteName:n.site_name||'',
    removed:n.removed_on||'',reverses:n.reverses||'',dest:n.dest||'site',party:n.party||'',purpose:n.purpose||'',partyRef:n.party_ref||'',by:n.by_name||'',requestedBy:n.requested_by||'',
    receiver:n.receiver||'',vehicle:n.vehicle||'',driver:n.driver||'',driverNic:n.driver_nic||'',contact:n.contact||'',issuedBy:n.issued_by||'',issuedContact:n.issued_contact||'',items:[]}));
  const tb=new Map(tickets.map(t=>[t.id,t]));
  /* stale entries would point at lines that no longer exist */
  LID.clear(); RET.clear();
  d.lines.forEach(x=>{ if(x.returns_line!=null) RET.set(+x.returns_line,(RET.get(+x.returns_line)||0)+(+x.qty||0)); });
  d.lines.slice().sort((a,b)=>a.line_no-b.line_no).forEach(x=>{ const t=tb.get(x.note_id), L=byId.get(x.item_id); if(!t||!L) return;
    /* LID maps an item id to the id of the LINE that put it on this note.
       An inbound note's items are bare ids and an outbound note's are
       objects; taking one line off needs the line's own id either way,
       and wh_lines.id is the only thing that identifies a line. */
    LID.set(t.id+'|'+L.id, x.id);
    if(t.type!=='DN'){ t.items.push(L.id); return; }
    const cut=x.cut_from!=null?{from:+x.cut_from,to:+x.cut_to}:null;
    t.items.push({lineId:L.id,lid:x.id,qty:+x.qty,cut,remarks:x.remarks||''});
    if(L.drum&&cut) L.drum.cuts.push({ticket:t.id,date:t.date,site:t.site||t.party,from:cut.from,to:cut.to,len:+x.qty}); });
  /* THE NOTE'S SITE IS NOW ITS ROWS' SITE. Nothing writes
     wh_notes.site_id for an inbound any more, so a return would title
     itself "Returned from  ·" - blank, looking like lost data. Where
     the rows agree on one site the note shows it, exactly as before.
     Where they do not, it says how many rather than picking one row's
     answer and presenting it as the note's. Old notes already carrying
     a site keep it: this only fills a blank. */
  tickets.forEach(t=>{ if(t.type==='DN'||t.site) return;
    const m=new Map();
    t.items.forEach(x=>{ const L=byId.get(x.lineId??x); if(L&&L.fromSite) m.set(L.fromSite,L.fromSiteName||''); });
    if(!m.size) return;
    t.sites=[...m.keys()];
    if(m.size===1){ t.site=t.sites[0]; t.siteName=m.get(t.site)||''; }
    else { t.siteName=m.size+' sites'; }
  });
  pins=new Set(d.materials.filter(m=>m.pinned).map(m=>m.code));
  mins={}; d.materials.forEach(m=>{ if(+m.min_qty>0) mins[m.code]=+m.min_qty; });
  for(const k in LOOK) LOOK[k].length=0;
  (d.lookups||[]).forEach(x=>{ if(LOOK[x.kind]) LOOK[x.kind].push(x.name); });
  for(const k in LOOK) LOOK[k].sort((a,b)=>a.localeCompare(b));
  /* the names the rest of the page already reads */
  PROJECTS=LOOK.project; PARTIES=LOOK.party; SOURCES=LOOK.source; VENDORS=LOOK.vendor;
  newMats=new Map(); lines.filter(L=>L.isNew&&L.code&&!MC.has(L.code)).forEach(L=>{ if(!newMats.has(L.code)) newMats.set(L.code,{code:L.code,name:L.name,cat:L.cat,first:L.inDate||L.outDate}); });
}
let loading=null;
async function reload(){
  if(loading) return loading;
  loading=(async()=>{ const d=await DB.whLoad(); loading=null;
    if(d.error){ $('#loading').textContent=d.error; $('#loading').hidden=false; return false; }
    fromDB(d); fillSelects(); renderAll();
    if(iSel&&tById(iSel)) showDispatch(tById(iSel)); if(rSel&&tById(rSel)) showInbound(tById(rSel));
    $('#loading').hidden=true; return true; })();
  return loading;
}
function fillSelects(){
  const keep=$('#projSel').value;
  $('#projSel').innerHTML='<option value="">All projects</option>'+PROJECTS.map(p=>`<option>${esc(p)}</option>`).join('');
  $('#projSel').value=PROJECTS.includes(keep)?keep:'';
  $('#needMat').innerHTML='<option value="">any cable</option>'+[...new Map(lines.filter(L=>L.drum).map(L=>[L.code,L])).values()].map(L=>`<option value="${esc(L.code)}">${esc(L.name)}</option>`).join('');
}
/* "+ New project…" in any project list opens a small field right under it
   (no browser prompt - some app windows block those). Saved for everybody. */
document.addEventListener('change',e=>{
  const el=e.target; if(el.tagName!=='SELECT'||el.value!==NEWPJ) return;
  askProject(el);
});
function askProject(sel){
  const host=sel.closest('.f')||sel.parentNode;
  let box=host.querySelector('.npj');
  if(!box){ box=document.createElement('div'); box.className='npj';
    box.innerHTML='<input class="in" placeholder="New project name" maxlength="60"><button class="btn sm pri" type="button">Add</button><button class="btn sm" type="button">Cancel</button>';
    host.appendChild(box); }
  const inp=box.querySelector('input'), [add,cancel]=box.querySelectorAll('button');
  const close=(v)=>{ box.remove(); sel.value=v||''; sel.dispatchEvent(new Event('input')); if(sel.onchange) sel.onchange({target:sel}); };
  cancel.onclick=()=>close('');
  add.onclick=async()=>{
    const name=inp.value.trim(); if(!name){ inp.focus(); return; }
    add.disabled=true;
    try{ await lookAdd('project',name);
      document.querySelectorAll('select').forEach(s=>{ if(![...s.options].some(o=>o.textContent===NEWPJ)) return;
        if(![...s.options].some(o=>o.textContent===name)){ const o=document.createElement('option'); o.textContent=name; s.insertBefore(o,s.lastElementChild); } });
      fillSelects(); toast(`Project "${name}" added`); close(name); }
    catch(err){ add.disabled=false; toast(err.message); }
  };
  inp.onkeydown=ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); add.click(); } if(ev.key==='Escape') cancel.click(); };
  setTimeout(()=>inp.focus(),0);
}

/* ================= HELPERS ================= */
const $ = s=>document.querySelector(s);
const esc = s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n=>Number(n||0).toLocaleString();
const dshort = d=>{ if(!d) return '—'; const [y,m,dd]=d.split('-'); return `${dd} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]}`; };
const tById = id=>tickets.find(t=>t.id===id);
const lById = id=>lines.find(L=>L.id===id);
const inProj = L => !proj || L.project===proj;
const tkCls = id=>id.startsWith('OBN')?'dn':id.startsWith('SRN')?'rt':'';
const tkChip = id=> id?`<span class="tk ${tkCls(id)}" onclick="event.stopPropagation();openTicket('${id}')">${id}</span>`:'<span style="color:var(--dim)">—</span>';
function toast(t){ const e=$('#toast'); e.textContent=t; e.classList.add('on'); clearTimeout(e._t); e._t=setTimeout(()=>e.classList.remove('on'),2200); }
function whereOf(L){
  if(L.drum) return {cls:'wh',top:`${L.loc} · drum ${L.drum.name}`,sub:`${fmt(L.qty)} m left · reading ${L.drum.lower}–${L.drum.cur}`};
  if(L.status==='out'&&L.party) return {cls:'tp',top:`With ${L.party} · 3rd party`,sub:`outbound ${dshort(L.outDate)} on ${L.outTicket}`};
  if(L.status==='out') return {cls:'st',top:`At site ${L.site} · ${L.siteName}`,sub:`outbound ${dshort(L.outDate)} on ${L.outTicket}${L.pending?' · direct issue, receive it later':''}`};
  return {cls:'wh',top:`In stock · bin ${L.loc}`,sub:`${L.source==='return'?'returned from '+L.fromSite:'received'} ${dshort(L.inDate)} on ${L.inTicket}`};
}
function stock(){
  const by=new Map();
  lines.filter(inProj).forEach(L=>{
    let s=by.get(L.code); if(!s){s={code:L.code,name:L.name,cat:L.cat,uom:L.uom,inQty:0,outQty:0,locs:new Set(),sites:new Set(),projects:new Set(),isNew:!!L.isNew,drums:0};by.set(L.code,s)}
    if(L.drum){ s.inQty+=L.qty; s.outQty+=L.drum.cuts.reduce((a,c)=>a+c.len,0); s.drums++; s.locs.add(L.loc); }
    else if(L.status==='out'){ s.outQty+=L.qty; s.sites.add(L.site||L.party); } else { s.inQty+=L.qty; s.locs.add(L.loc); }
    s.projects.add(L.project);
  });
  by.forEach(s=>{s.min=mins[s.code]||0; s.state=!s.min?'':s.inQty<s.min?'short':s.inQty<s.min*1.5?'low':'ok'});
  return by;
}
const PIN='<svg viewBox="0 0 24 24" fill="none"><path d="M15 3l6 6-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" fill="FILL" stroke="#9DB8F5" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const pinBtn = c => `<button class="pin ${pins.has(c)?'on':''}" title="${pins.has(c)?'Unpin from dashboard':'Pin to dashboard'}" onclick="event.stopPropagation();togglePin('${c}')">${PIN.replace('FILL',pins.has(c)?'#759beb':'none')}</button>`;
async function togglePin(c){ const on=!pins.has(c); try{ await DB.whPin(c,on); on?pins.add(c):pins.delete(c); toast(on?'Pinned. It shows on the Overview now.':'Unpinned from the Overview.'); renderAll(); }catch(e){ toast(e.message); } }
function hlt(text,q){ text=esc(text); if(!q) return text; const i=text.toLowerCase().indexOf(q.toLowerCase()); return i<0?text:text.slice(0,i)+'<mark>'+text.slice(i,i+q.length)+'</mark>'+text.slice(i+q.length); }

/* ================= GLOBAL FIND ================= */
function find(q){
  q=q.trim(); const box=$('#gr'); if(q.length<2){box.hidden=true;return}
  const lq=q.toLowerCase();
  const tk=tickets.filter(t=>[t.id,t.site,t.siteName,t.project,t.ref,t.res,t.party,t.partyRef].join(' ').toLowerCase().includes(lq)).slice(0,5);
  const it=lines.filter(L=>[L.sn,L.code,L.name,L.drum&&L.drum.name,L.site,L.fromSite,L.party,L.res].join(' ').toLowerCase().includes(lq)).slice(0,10);
  // tickets that contain a matching SN
  const viaSn=tickets.filter(t=>!tk.includes(t)&&t.items.some(x=>{const L=lById(x.lineId??x);return L&&L.sn&&L.sn.toLowerCase().includes(lq)})).slice(0,4);
  let h='';
  if(it.length) h+='<h5>Items · current location</h5>'+it.map(L=>{const w=whereOf(L);return `<div class="fi" onclick="showItem(${L.id})"><div class="t"><b>${L.drum?'<span class="drumtag">'+hlt(L.drum.name,q)+'</span> · ':''}${hlt(L.name,q)}</b><span>${hlt(L.code,q)}${L.sn?' · SN '+hlt(L.sn,q)+(isDummy(L.sn)?' <span class="dmy" style="font-size:9.5px">fix</span>':''):''}${L.res?' · RSV '+hlt(L.res,q):''}</span></div><div class="where ${w.cls}"><b>${esc(w.top)}</b>${esc(w.sub)}</div></div>`}).join('');
  if(tk.length||viaSn.length) h+='<h5>Tickets</h5>'+[...tk,...viaSn].map(t=>`<div class="fi" onclick="openTicket('${t.id}')"><span class="tk ${tkCls(t.id)}">${hlt(t.id,q)}</span><div class="t"><b>${ticketTitle(t)}</b><span>${dshort(t.date)} · ${esc(t.project)} · ${t.items.length} item${t.items.length===1?'':'s'}${viaSn.includes(t)?' · contains this SN':''}</span></div></div>`).join('');
  box.innerHTML=h||'<div class="empty">Nothing matches.</div>'; box.hidden=false;
}
function destTitle(t){ return t.dest==='party'?`To ${esc(t.party)} · 3rd party · ${esc(t.purpose)}`:`To ${t.site} · ${esc(t.siteName)}`; }
/* raw text - every caller escapes it */
const siteCell=t=>t.site||(t.sites&&t.sites.length>1?t.sites.join(' · '):'');
function ticketTitle(t){ return t.type==='DN'?destTitle(t):t.type==='RT'?`Returned from ${esc(siteCell(t))}${t.site&&t.siteName?' · '+esc(t.siteName):''}`:`New stock · ${esc(t.ref||'')}`; }
function showItem(id){ $('#gr').hidden=true; const L=lById(id); go('inv'); setInvMode('lines'); $('#q').value=L.sn||(L.drum&&L.drum.name)||L.code; setSeg('#fSt','all'); fSt='all'; renderInv(id); }
$('#gq').oninput=e=>find(e.target.value);
$('#gq').onfocus=e=>find(e.target.value);
document.addEventListener('click',e=>{ if(!e.target.closest('.find')) $('#gr').hidden=true; });

/* ================= OVERVIEW ================= */
function renderOv(){
  const S=stock(); const all=[...S.values()];
  const L=lines.filter(inProj);
  $('#kIn').textContent=fmt(L.filter(x=>x.status==='in'&&!x.drum).reduce((a,x)=>a+x.qty,0)); $('#kInS').textContent=`items · ${all.filter(s=>s.inQty).length} materials`;
  const atSite=L.filter(x=>x.status==='out'); $('#kSt').textContent=fmt(atSite.length); $('#kStS').textContent=`${new Set(atSite.filter(x=>x.site).map(x=>x.site)).size} sites · ${atSite.filter(x=>x.party).length} with 3rd parties`;
  const ym=today().slice(0,7); $('#kTkL').textContent='Movements · '+new Date().toLocaleString('en',{month:'short'});
  const nov=tickets.filter(t=>(t.date||'').startsWith(ym)&&(!proj||t.project===proj));
  $('#kTk').textContent=nov.length; $('#kTkS').textContent=`${nov.filter(t=>t.type==='IN').length} GRN · ${nov.filter(t=>t.type==='RT').length} SRN · ${nov.filter(t=>t.type==='DN').length} outbound`;
  const dr=L.filter(x=>x.drum); $('#kDr').textContent=fmt(dr.reduce((a,x)=>a+x.qty,0))+' m'; $('#kDrS').textContent=`on ${dr.length} drums`;
  const sh=all.filter(s=>s.state==='short'); $('#kSh').textContent=sh.length; $('#kNw').textContent=newMats.size; $('#kNwS').textContent=`not in Material Codes · ${L.filter(x=>isDummy(x.sn)).length} dummy SNs to fix`;
  $('#pgrid').innerHTML=[...pins].map(c=>S.get(c)).filter(Boolean).map(s=>{
    const pct=s.min?Math.min(100,s.inQty/(s.min*2)*100):100;
    return `<div class="pt ${s.state}"><button class="unpin" title="Unpin" onclick="togglePin('${s.code}')">${PIN.replace('FILL','#759beb')}</button>
      <div class="cat">${esc(s.cat)}${s.isNew?'<span class="newtag">NEW</span>':''}${s.drums?` · ${s.drums} drum${s.drums>1?'s':''}`:''}</div>
      <div class="nm" title="${esc(s.name)}">${esc(s.name)}</div><div class="cd">${s.code}${s.sites.size?` · ${s.outQty} at ${s.sites.size} site${s.sites.size>1?'s':''}`:''}</div>
      <div class="row"><div class="q">${fmt(s.inQty)}<small>${s.uom}</small></div>
      <div class="min">${s.min?`min ${fmt(s.min)}`:'no minimum'}<br>${s.state==='short'?`<b style="color:var(--bad)">short ${fmt(s.min-s.inQty)}</b>`:s.state==='low'?'<b style="color:var(--warn)">running low</b>':s.state==='ok'?'<span style="color:var(--ok)">enough</span>':''}</div></div>
      <div class="bar"><b style="width:${pct}%"></b></div></div>`}).join('')||'<div class="empty">Nothing pinned yet.</div>';
  $('#shList').innerHTML=sh.map(s=>`<div class="li"><div class="t"><b>${esc(s.name)}</b><span>${s.code} · ${esc(s.cat)}</span></div><div class="r"><span class="x">${fmt(s.inQty)}</span> / ${fmt(s.min)}<br><span style="color:var(--dim)">need ${fmt(s.min-s.inQty)} ${s.uom}</span></div></div>`).join('')||'<div class="empty">No shortages.</div>';
  $('#tkList').innerHTML=[...tickets].filter(t=>!proj||t.project===proj).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id)).slice(0,10).map(t=>`<div class="li click" onclick="openTicket('${t.id}')"><span class="tk ${tkCls(t.id)}">${t.id}</span><div class="t"><b>${ticketTitle(t)}</b><span>${dshort(t.date)} · ${esc(t.project)}</span></div><div class="r">${t.items.length} item${t.items.length===1?'':'s'}</div></div>`).join('');
}

/* ================= INVENTORY ================= */
let invMode='lines', fSt='all', fPin='0';
function setSeg(sel,val){ document.querySelectorAll(sel+' button').forEach(b=>b.classList.toggle('on',Object.values(b.dataset)[0]===val)); }
function setInvMode(m){ invMode=m; setSeg('#invMode',m); renderInv(); }
function renderInv(hiId){
  selSync();
  const q=$('#q').value.trim().toLowerCase(), cat=$('#fCat').value; const S=stock();
  if(invMode==='stock'){
    let rows=[...S.values()].filter(s=>(!cat||s.cat===cat)&&(!q||(s.code+' '+s.name).toLowerCase().includes(q)));
    if(fSt==='in') rows=rows.filter(s=>s.inQty>0); if(fSt==='out') rows=rows.filter(s=>s.sites.size);
    if(fPin==='1') rows=rows.filter(s=>pins.has(s.code)); if(fPin==='s') rows=rows.filter(s=>s.state==='short');
    rows.sort((a,b)=>CATS.indexOf(a.cat)-CATS.indexOf(b.cat)||a.name.localeCompare(b.name));
    $('#tbl').innerHTML=`<thead><tr><th style="width:44px">Pin</th><th>Material code</th><th>Material name</th><th>Category</th><th>Projects</th><th>UoM</th><th style="text-align:right">On hand</th><th style="text-align:right">Issued</th><th style="text-align:right">Minimum</th><th>Status</th><th>Bin locations</th><th>Issued to sites</th></tr></thead><tbody>${
      rows.map(s=>`<tr><td>${pinBtn(s.code)}</td><td class="code">${s.code}${s.isNew?'<span class="newtag">NEW</span>':''}</td><td class="name" title="${esc(s.name)}">${esc(s.name)}</td><td><span class="chip">${esc(s.cat)}</span></td><td>${[...s.projects].map(p=>`<span class="chip pj">${esc(p)}</span>`).join(' ')}</td><td>${s.uom}</td><td class="num">${fmt(s.inQty)}</td><td class="num" style="color:var(--site)">${fmt(s.outQty)}</td><td class="num"><input class="in minin mono" value="${s.min||''}" placeholder="—" onchange="setMin('${s.code}',this.value)"></td><td>${s.state?`<span class="st ${s.state}">${{short:'SHORT '+fmt(s.min-s.inQty),low:'LOW',ok:'OK'}[s.state]}</span>`:''}</td><td class="dt">${[...s.locs].join(', ')}</td><td class="dt" style="color:var(--site)">${[...s.sites].join(', ')}</td></tr>`).join('')}</tbody>`;
  } else {
    let rows=lines.filter(inProj).filter(L=>(!cat||L.cat===cat)&&(!q||[L.code,L.name,L.sn,L.site,L.siteName,L.fromSite,L.loc,L.inTicket,L.outTicket,L.drum&&L.drum.name,L.party,L.res].join(' ').toLowerCase().includes(q)));
    if(fSt==='in') rows=rows.filter(L=>L.status==='in'); if(fSt==='out') rows=rows.filter(L=>L.status==='out'); if(fSt==='rt') rows=rows.filter(L=>L.source==='return'); if(fSt==='pend') rows=rows.filter(L=>L.pending); if(fSt==='tp') rows=rows.filter(L=>L.party);
    /* 010: how it arrived, now that 056 records it. These sit with the
       other source filters rather than in their own tabs - the Inventory
       tab already IS the list, and a separate tab would be the same rows
       drawn by a second piece of code that could disagree with this one. */
    if(fSt==='local') rows=rows.filter(L=>L.source==='local');
    if(fSt==='redep') rows=rows.filter(L=>L.source==='redep');
    if(fPin==='1') rows=rows.filter(L=>pins.has(L.code)); if(fPin==='s') rows=rows.filter(L=>(S.get(L.code)||{}).state==='short'); if(fPin==='d') rows=rows.filter(L=>isDummy(L.sn)); if(fPin==='u') rows=rows.filter(L=>!L.code);
    rows.sort((a,b)=>(b.outDate||b.inDate).localeCompare(a.outDate||a.inDate));
    $('#tbl').innerHTML=`<thead><tr>${OWNER()?'<th style="width:34px"><input type="checkbox" class="tickbox" onchange="selAllShown(this.checked)" title="Select every row shown"></th>':''}<th style="width:44px">Pin</th><th>Material code</th><th>Material name</th><th>Category</th><th>Site ID / party</th><th>Site name</th><th>Project</th><th>UoM</th><th style="text-align:right">Qty</th><th>SN / drum</th><th>Inbound date</th><th>Inbound ref</th><th>From</th><th>Reservation no</th><th>Current location</th><th>Outbound date</th><th>Outbound ref</th><th>Status</th><th style="width:40px"></th></tr></thead><tbody>${
      rows.map(L=>{ const site=L.status==='out'?(L.party||L.site):L.fromSite, sname=L.status==='out'?L.siteName:L.fromSiteName;
        const where=L.status==='out'?(L.party?`<span class="loc-tp">3P · ${esc(L.party)}</span>`:`<span class="loc-site">Site ${L.site}</span>`):esc(L.loc);
        const st=L.drum?`<span class="st wh">ON DRUM</span>`:L.pending?'<span class="st low">DIRECT ISSUE · NOT RECEIVED</span>':L.party?'<span class="st tp">WITH 3RD PARTY</span>'+condChip(L.cond):L.status==='out'?'<span class="st out">ISSUED TO SITE</span>':L.source==='return'?'<span class="st rt">RETURNED · IN STOCK</span>'+condChip(L.cond):'<span class="st wh">IN STOCK</span>';
        const sn=L.drum?`<span class="drumtag">${esc(L.drum.name)}</span> <span style="color:var(--dim)">${L.drum.lower}–${L.drum.cur}</span>`:L.read?`<span style="color:#ffd9a8">reading ${L.read.start}–${L.read.end}</span>`:(editSn===L.id?`<input class="in mono" style="padding:4px 8px;width:190px" placeholder="real SN" onkeydown="if(event.key==='Enter')setSN(${L.id},this.value)" onblur="setSN(${L.id},this.value)" autofocus>`:snHtml(L.sn)+(isDummy(L.sn)?`<button class="fixsn" onclick="editSn=${L.id};renderInv(${L.id})">set real SN</button>`:''));
        const out=L.drum?(L.drum.cuts.length?L.drum.cuts.map(c=>tkChip(c.ticket)).join(' '):'—'):tkChip(L.outTicket);
        return `<tr data-row="${L.id}" class="${L.id===hiId?'hl':''}${selIds.has(L.id)?' sel':''}">${OWNER()?`<td>${tickBox(L)}</td>`:''}<td>${pinBtn(L.code)}</td><td class="code">${L.code}${L.isNew?'<span class="newtag">NEW</span>':''}</td><td class="name" title="${esc(L.name)}">${esc(L.name)}</td><td><span class="chip">${esc(L.cat)}</span></td><td class="code" style="color:${L.party?'var(--tp)':L.status==='out'?'var(--site)':'var(--ink)'}">${site||'<span style="color:var(--dim)">—</span>'}</td><td>${esc(sname)||'<span style="color:var(--dim)">—</span>'}</td><td><span class="chip pj">${esc(L.project)}</span></td><td>${L.uom}</td><td class="num">${fmt(L.qty)}</td><td class="sn">${sn}</td><td class="dt">${L.inDate}</td><td>${tkChip(L.inTicket)}</td><td>${originOf(L)||'<span style="color:var(--dim)">—</span>'}</td><td class="rsv">${L.res||'<span style="color:var(--dim)">—</span>'}</td><td class="dt">${where}</td><td class="dt">${L.outDate||(L.drum&&L.drum.cuts.length?'cuts →':'—')}</td><td>${out}</td><td>${st}</td><td>${rowEdit(L.id,L.sn||L.code||L.name)}</td></tr>`}).join('')}</tbody>`;
  }
  drawSelBar();
  $('#nInv').textContent=lines.length;
}
let editSn=null;
async function setSN(id,v){ if(editSn!==id) return; editSn=null; v=v.trim(); const L=lById(id); if(v&&v!==L.sn){ try{ await DB.whSetSN(id,v); toast(`${L.sn} → ${v}`); L.sn=v; }catch(e){ toast(e.message); } } renderAll(); }
async function setMin(c,v){ const n=parseFloat(v); try{ await DB.whMin(c,n>0?n:null); if(n>0) mins[c]=n; else delete mins[c]; renderAll(); }catch(e){ toast(e.message); } }

/* ================= TICKET LISTS ================= */
let rSel=null, iSel=null, rFilter='';
function ticketMatches(t,q){ if(!q) return true; q=q.toLowerCase(); return [t.id,t.site,t.siteName,t.project,t.ref,t.requestedBy,t.res,t.party,t.partyRef].join(' ').toLowerCase().includes(q)||t.items.some(x=>{const L=lById(x.lineId??x);return L&&[L.sn,L.code,L.drum&&L.drum.name].join(' ').toLowerCase().includes(q)}); }
function renderRList(){
  const q=$('#rq').value.trim();
  $('#rList').innerHTML=tickets.filter(t=>t.type!=='DN'&&(!rFilter||t.type===rFilter)&&(!proj||t.project===proj)&&ticketMatches(t,q)).sort((a,b)=>b.date.localeCompare(a.date)).map(t=>`<div class="tic ${rSel===t.id?'on':''}" onclick="openTicket('${t.id}')"><div class="a"><span class="tk ${tkCls(t.id)}">${t.id}</span><span class="st ${t.type==='RT'?'rt':'wh'}">${t.type==='RT'?'SRN · SITE RETURN':'GRN · NEW STOCK'}</span><span class="d">${dshort(t.date)}</span></div><div class="b">${ticketTitle(t)}</div><div class="c">${esc(t.project)} · ${t.items.length} item${t.items.length===1?'':'s'} · by ${esc(t.by)}${t.res?` · <span class="rsv">RSV ${t.res}</span>`:''}</div></div>`).join('')||'<div class="empty">No tickets.</div>';
  $('#nRc').textContent=tickets.filter(t=>t.type!=='DN').length;
}
function renderIList(){
  const q=$('#iq').value.trim();
  $('#iList').innerHTML=tickets.filter(t=>t.type==='DN'&&(!proj||t.project===proj)&&ticketMatches(t,q)).sort((a,b)=>b.date.localeCompare(a.date)).map(t=>`<div class="tic ${iSel===t.id?'on':''}" onclick="openTicket('${t.id}')"><div class="a"><span class="tk dn">${t.id}</span><span class="d">${dshort(t.date)}</span></div><div class="b">${t.dest==='party'?`<span style="color:var(--tp)">${esc(t.party)}</span> · 3rd party · ${esc(t.purpose)}`:`${t.site} · ${esc(t.siteName)}`}</div><div class="c">${esc(t.project)} · ${t.items.length} item${t.items.length===1?'':'s'} · asked by ${esc(t.requestedBy)}</div></div>`).join('')||'<div class="empty">No outbound notes.</div>';
  $('#nDn').textContent=tickets.filter(t=>t.type==='DN').length;
}
function openTicket(id){
  $('#gr').hidden=true; const t=tById(id); if(!t) return;
  if(t.type==='DN'){ iSel=id; go('iss'); renderIList(); showDispatch(t); }
  else { rSel=id; go('rcv'); renderRList(); showInbound(t); }
}

/* ================= RECEIVE ================= */
function showInbound(t){
  const items=t.items.map(lById);
  const kv=(k,v)=>`<div class="f"><label>${k}</label><div class="in" style="background:rgba(5,10,28,.25)">${v||'—'}</div></div>`;
  $('#rPane').innerHTML=`<div class="h"><span class="tk ${tkCls(t.id)}" style="font-size:14px">${t.id}</span><h3>${t.type==='RN'?'Inbound · returned from site (RTN)':t.type==='RT'?'Inbound · site return (SRN)':'Inbound · new stock (GRN)'}</h3>${t.type==='RN'&&t.reverses?`<span class="tk dn" title="the note this reverses" onclick="openTicket('${esc(t.reverses)}')" style="cursor:pointer;margin-left:8px">↩ ${esc(t.reverses)}</span>`:''}<div class="sp"></div><button class="btn sm" onclick="printNote('${t.id}')">Print note</button>${noteEditBtn(t)}<button class="btn sm danger" onclick="delNote('${t.id}')" title="Delete this note and remove what it booked in">Delete note</button></div>
  <div class="pbody">
    ${t.type==='RT'?`<div class="box rt"><h4>Site return details</h4><div class="fh five">${kv('Site ID',`<span class="mono">${esc(siteCell(t))}</span>`)}${kv('Site name',esc(t.siteName))}${kv('Removed on',t.removed?dshort(t.removed):'<span style="color:var(--dim)">not known</span>')}${kv('Inbound date',dshort(t.date))}${kv('Returned by',esc(t.by))}</div><div class="fh">${kv('Return note',esc(t.ref))}${kv('Project',esc(t.project))}</div></div>`
    :`<div class="box"><h4>Delivery</h4><div class="fh">${kv('Inbound date',dshort(t.date))}${kv('Project',esc(t.project))}${kv('Reservation no',`<span class="mono">${esc(t.res)}</span>`)}${kv('Received by',esc(t.by))}</div><div class="fh">${kv('Supplier DN / PO',esc(t.ref))}</div></div>`}
    <div class="rows"><table><thead><tr><th style="width:36px">#</th><th style="width:120px">Code</th><th>Material name</th><th style="width:100px">Category</th><th style="width:60px">UoM</th><th style="width:70px;text-align:right">Qty</th><th style="width:220px">SN / drum / reading</th>${t.type==='RT'?'<th style="width:100px">Condition</th>':''}<th style="width:240px">Current location</th><th style="width:40px"></th></tr></thead><tbody>
    ${items.map((L,i)=>{const w=whereOf(L);return `<tr><td class="dt">${i+1}</td><td class="code">${L.code}</td><td class="name">${esc(L.name)}</td><td><span class="chip">${esc(L.cat)}</span></td><td>${L.uom}</td><td class="num">${fmt(L.drum?L.drum.upper-L.drum.lower:L.qty)}</td><td class="sn">${L.drum?`<span class="drumtag">${esc(L.drum.name)}</span> ${L.drum.lower}–${L.drum.upper} m`:L.read?`<span style="color:#ffd9a8">reading ${L.read.start}–${L.read.end}</span>`:snHtml(L.sn)}</td>${t.type==='RT'?`<td>${L.cond&&L.cond!=='Good'?condChip(L.cond):'<span class="st ok">GOOD</span>'}</td>`:''}<td class="dt"><span style="color:${w.cls==='st'?'var(--site)':'var(--ok)'}">${esc(w.top)}</span></td><td>${rowEdit(L.id,L.sn||L.name)}${rowDel(t,L.id,L.sn||L.name)}</td></tr>`}).join('')}
    </tbody></table></div>
  </div>`;
}
let nIn=null;
function newInbound(){ rSel=null; renderRList(); /* ONE blank row. It used to start with three, which is a guess about
     how many things are on the paper - usually wrong, and the empties sit
     there looking like work not done. + Add row costs one click. */
  nIn={type:'IN',rows:[{}]}; drawInbound(); }
function drawInbound(){
  const R=nIn.type==='RT', today=window.today();
  $('#rPane').innerHTML=`<div class="h"><h3>New inbound</h3><span class="k">gets its ticket no when saved</span><div class="sp"></div>
    <div class="seg"><button class="${!R?'on':''}" onclick="nIn.type='IN';keepHead();drawInbound()">New stock</button><button class="${R?'on':''}" onclick="nIn.type='RT';keepHead();drawInbound()">Return from site</button></div></div>
  <div class="pbody">
    ${R?`<div class="box rt"><h4>Site return details</h4><div class="fh">
      <div class="f"><label>Removed on · optional</label><input class="in mono" type="date" id="nRem" value="${nIn.removed||''}"><small>leave empty if not known</small></div>
      <div class="f"><label>Inbound date</label><input class="in mono" type="date" id="nDate" value="${nIn.date||today}"><small>the day it reached the warehouse</small></div>
      <div class="f"><label>Returned by</label><input class="in" id="nBy" placeholder="team / rigger" value="${esc(nIn.by||'')}"></div>
    </div><div class="fh"><div class="f"><label>Return note no</label><input class="in mono" id="nRef" placeholder="paper note no" value="${esc(nIn.ref||'')}"></div><div class="f"><label>Project</label><select class="in" id="nPj"><option value="">Pick a project…</option>${PROJECTS.map(p=>`<option>${esc(p)}</option>`).join('')}<option>${NEWPJ}</option></select></div></div></div>`
    :`<div class="box"><h4>Delivery</h4><div class="fh">
      <div class="f"><label>Inbound date</label><input class="in mono" type="date" id="nDate" value="${nIn.date||today}"></div>
      <div class="f"><label>Project</label><select class="in" id="nPj"><option value="">Pick a project…</option>${PROJECTS.map(p=>`<option>${esc(p)}</option>`).join('')}<option>${NEWPJ}</option></select></div>
      <div class="f"><label>Local purchase</label><button class="dbtn ${nIn.local?'on':''}" style="margin-top:0;padding:9px 12px" onclick="keepHead();nIn.local=!nIn.local;if(nIn.local){nIn.res='';nIn.wh=''}drawInbound()">${nIn.local?'● Local purchase':'Mark as local purchase'}</button></div>
      <div class="f"><label>REDEP</label><button class="dbtn ${nIn.redep?'on':''}" style="margin-top:0;padding:9px 12px" onclick="keepHead();nIn.redep=!nIn.redep;drawInbound()">${nIn.redep?'● Redeployed':'Mark as REDEP'}</button><small>${nIn.redep?'REDEP wins over how the note itself is typed':'material moved here, no site return behind it'}</small></div>
      <div class="f"><label>Vendor · who owns it</label>${lookBox('vendor','nVen',nIn.vendor,'Dialog, Mobitel, Hutch…')}<small>written onto every row, correctable per row later</small></div>
      <div class="f"><label>Received by</label><input class="in" id="nBy" value="${esc(nIn.by||ME())}"></div>
    </div><div class="fh"><div class="f"><label>From warehouse</label>${lookBox('source','nWh',nIn.wh,nIn.local?'local purchase - no warehouse':'type or pick a warehouse',nIn.local?'disabled':'')}<small>${nIn.local?'a local purchase comes from nobody\'s warehouse':'type a new name to add it'}</small></div><div class="f"><label>Supplier DN / PO</label><input class="in mono" id="nRef" placeholder="e.g. Huawei DN 89501" value="${esc(nIn.ref||'')}"></div></div></div>`}
    <div class="rows"><table><thead><tr><th style="width:36px">#</th><th style="width:210px">Material code</th><th>Material name</th><th style="width:130px">Category</th><th style="width:84px">UoM</th><th style="width:84px">Qty</th><th style="width:150px">Reservation</th><th style="width:110px">Site ID</th><th style="width:210px">SN</th>${R?'<th style="width:120px">Condition</th>':''}<th style="width:130px">WH location</th><th style="width:170px">Remarks</th><th style="width:40px"></th></tr></thead><tbody id="nBody"></tbody></table></div>
    <button class="btn sm" style="margin-top:10px" onclick="nIn.rows.push({});drawRows()">+ Add row</button>
    <button class="btn sm" style="margin-top:10px;margin-left:6px" onclick="openImport()">⇪ Paste from Excel</button>
  </div>
  <div class="ff"><div class="msg" id="nMsg">Type a code or part of a name. Codes in Material Codes fill in by themselves. Cable on a drum → <b style="color:#ffd9a8">Drum</b>${R?'; a loose cable piece → <b style="color:#ffd9a8">Cable</b> and write its two readings':''}.</div><button class="btn" onclick="newInbound()">Clear</button><button class="btn pri" onclick="saveInbound()">Save inbound</button></div>`;
  drawRows();
}
function keepHead(){ ['nRem:removed','nDate:date','nBy:by','nRef:ref','nWh:wh','nVen:vendor'].forEach(p=>{const [i,k]=p.split(':');const e=$('#'+i);if(e)nIn[k]=e.value}); }
/* A row only offers Drum / Roll once it IS cable - by its category, or
   by its unit. Before that the row is one line with nothing extra on
   it. The same test hides "SN unreadable": a drum has no serial that
   could be unreadable. */
const CABLECATS=['Cables','Fibers','Jumpers'];
const isCableRow=r=>!!(r.drum||r.cable)||CABLECATS.includes(r.cat)||r.uom==='M'||r.uom==='ROLL';
function mcState(r,i){
  if(!r.code) return '';
  if(r.known){
    const m=MC.get(r.code);
    return '<span class="mstate ok">✓ '+esc(m&&m.name?m.name:'in Material Codes')+'</span>';
  }
  const ready=!!(String(r.name||'').trim()&&r.cat);
  return '<span class="mstate nw">● not in Material Codes</span>'
    + (OWNER()
        ? '<button class="addmc" '+(ready?'':'disabled title="give it a name and a category first"')
          +' onclick="addCodeHere('+i+')">+ Add '+esc(r.code)+' to Material Codes</button>'
        : '<span class="mstate nw">it will show on New materials</span>');
}
/* The same add as the New materials tab, reachable from the row. It is
   owner-only because materials_write is is_owner(); for anyone else the
   row just says where the code will turn up. */
async function addCodeHere(i){
  const r=nIn.rows[i];
  if(!OWNER()){ toast('Only the owner adds to Material Codes.'); return; }
  const name=String(r.name||'').trim();
  if(!r.code||!name||!r.cat){ toast('A code needs its name and category before it can be added.'); return; }
  const type=TYPE_OF[r.cat]||r.cat;
  try{
    await DB.whAddMaterial(r.code,name,type);
    MC.set(r.code,{code:r.code,name:name,cat:type});
    newMats.delete(r.code);
    r.known=true;
    lines.forEach(L=>{ if(L.code===r.code) L.isNew=false; });
    toast(r.code+' added to Material Codes');
    drawRows();
  }catch(e){ toast(e.message||String(e)); }
}
function drawRows(){
  $('#nBody').innerHTML=nIn.rows.map((r,i)=>{
        /* WHAT THE CODE TURNED OUT TO BE, on the row. A code that resolves
       shows its Material Codes description, because the number means
       nothing on its own and he is checking the box against the row.
       A code that does not resolve says so AND offers to add it right
       here - that is the moment he knows what the thing is, and sending
       him to another tab to say so is how it ends up never said. */
    const st=mcState(r,i);
    const d=r.drum, RT=nIn.type==='RT', c=r.cable, ncol=RT?13:12, tw=snTwin(r.sn);
    const cl=c&&r.ra!==''&&r.rb!==''&&r.ra!=null&&r.rb!=null?Math.abs(+r.rb-+r.ra):'';
    return `<tr><td class="dt">${i+1}</td>
    <td class="cell"><input class="in mono" value="${esc(r.q??r.code??'')}" placeholder="code or name" oninput="acType(${i},this)" onblur="setTimeout(()=>closeAc(${i},this),180)">${st}
      ${isCableRow(r)?`<button class="dbtn ${d&&r.pack!=='roll'?'on':''}" onclick="toggleDrum(${i},'drum')">${d&&r.pack!=='roll'?'● Drum':'+ Drum'}</button> <button class="dbtn ${d&&r.pack==='roll'?'on':''}" onclick="toggleDrum(${i},'roll')">${d&&r.pack==='roll'?'● Roll':'+ Roll'}</button>${!d&&!c?'<span class="mstate lenok">a plain length is fine - add Drum or Roll only if it is on one</span>':''}`:''}${RT?` <button class="dbtn ${c?'on':''}" onclick="toggleRCable(${i})">${c?'● Cable':'+ Cable'}</button>`:''}<div class="ac" id="ac${i}" hidden></div></td>
    <td><input class="in" value="${esc(r.name||'')}" placeholder="${r.code&&!r.known?'type the material name':'fills from Material Codes'}" ${r.known?'readonly':''} oninput="nIn.rows[${i}].name=this.value"></td>
    <td>${r.known?`<input class="in" readonly value="${esc(r.cat)}">`:`<select class="in" onchange="nIn.rows[${i}].cat=this.value"><option value="">category · later</option>${CATS.map(c=>`<option ${r.cat===c?'selected':''}>${c}</option>`).join('')}</select>`}</td>
    <td><select class="in" onchange="nIn.rows[${i}].uom=this.value">${['EA','M','SET','ROLL','BOX'].map(u=>`<option ${(r.uom||'EA')===u?'selected':''}>${u}</option>`).join('')}</select></td>
    <td><input class="in mono" id="iq${i}" style="text-align:right" value="${d?Math.max(0,(d.upper||0)-(d.lower||0)):c?cl:(r.qty||1)}" ${d||c?'readonly':''} placeholder="${c?'readings':''}" oninput="nIn.rows[${i}].qty=+this.value"></td>
    <td><input class="in mono" value="${esc(r.res||'')}" placeholder="${nIn.type==='RT'?'if there is one':'4900000123'}" oninput="nIn.rows[${i}].res=this.value"></td>
    <td><input class="in mono" value="${esc(r.site||'')}" placeholder="${nIn.type==='RT'?'where from':'optional'}" oninput="nIn.rows[${i}].site=this.value.toUpperCase();const n=siteLookup(this.value);if(n)nIn.rows[${i}].siteName=n"></td>
    <td><input class="in mono" value="${esc(r.sn||'')}" placeholder="${d?'drum has no SN':c?'cable has no SN':'scan or type'}" ${d||c?'readonly':''} oninput="nIn.rows[${i}].sn=this.value;snWarn(${i},0)"><span id="snw0_${i}">${tw?twinSays(tw):''}</span></td>
    ${RT?`<td><select class="in" onchange="nIn.rows[${i}].cond=this.value" style="${r.cond&&r.cond!=='Good'?'color:'+(r.cond==='Faulty'?'var(--bad)':'var(--site)'):''}">${CONDS.map(x=>`<option ${(r.cond||'Good')===x?'selected':''}>${x}</option>`).join('')}</select></td>`:''}
    <td><input class="in mono" list="lk_location" value="${esc(r.loc||'')}" placeholder="where it sits" oninput="nIn.rows[${i}].loc=this.value"><datalist id="lk_location">${lookList('location').map(x=>`<option>${esc(x)}</option>`).join('')}</datalist></td>
    <td><input class="in" value="${esc(r.remarks||'')}" placeholder="anything worth noting" oninput="nIn.rows[${i}].remarks=this.value"></td>
    <td class="rowx"><button class="tick${r.ok?' on':''}" title="${r.ok?'Checked - press to unlock':'Mark this row checked'}" onclick="nIn.rows[${i}].ok=!nIn.rows[${i}].ok;drawRows()">✓</button><button class="btn sm" style="padding:6px 9px" onclick="nIn.rows.splice(${i},1);drawRows()">✕</button></td></tr>
    ${c?`<tr class="drumrow"><td colspan="${ncol}"><div class="drumbox">
      <div><label>Start reading (m)</label><input class="in mono" style="text-align:right" value="${r.ra??''}" placeholder="marking at one end" oninput="nIn.rows[${i}].ra=this.value;rCabLen(${i})"></div>
      <div><label>End reading (m)</label><input class="in mono" style="text-align:right" value="${r.rb??''}" placeholder="marking at the other" oninput="nIn.rows[${i}].rb=this.value;rCabLen(${i})"></div>
      <div></div><div class="len" id="rl${i}">${manText(r)}</div></div></td></tr>`:''}
    ${d?`<tr class="drumrow"><td colspan="${ncol}"><div class="drumbox">
      <div><label>Drum name</label><input class="in mono" value="${esc(d.name||'')}" placeholder="you name it, e.g. BLK16-04" oninput="nIn.rows[${i}].drum.name=this.value"></div>
      <div><label>Lower reading (m)</label><input class="in mono" style="text-align:right" value="${d.lower??''}" placeholder="inner end" oninput="nIn.rows[${i}].drum.lower=+this.value;drumLen(${i})"></div>
      <div><label>Upper reading (m)</label><input class="in mono" style="text-align:right" value="${d.upper??''}" placeholder="outer end" oninput="nIn.rows[${i}].drum.upper=+this.value;drumLen(${i})"></div>
      <div class="len" id="dl${i}">Cable on drum: <b>${fmt(Math.max(0,(d.upper||0)-(d.lower||0)))} m</b> · cuts are taken from the outer end, so the upper reading counts down.</div>
    </div></td></tr>`:''}`}).join('');
}
function toggleRCable(i){ const r=nIn.rows[i]; r.cable=!r.cable; if(r.cable){ delete r.drum; r.uom='M'; r.sn=''; } drawRows(); }
function rCabLen(i){ const r=nIn.rows[i]; $('#rl'+i).innerHTML=manText(r); if(r.ra!==''&&r.rb!==''&&r.ra!=null&&r.rb!=null) $('#iq'+i).value=Math.abs(+r.rb-+r.ra); }
function toggleDrum(i,pack){ const r=nIn.rows[i]; pack=pack||'drum';
  /* pressing the one already on turns it off; pressing the other swaps
     which word it is without losing readings already typed */
  if(r.drum&&(r.pack||'drum')===pack){ delete r.drum; delete r.pack; }
  else if(r.drum){ r.pack=pack; }
  else { delete r.cable; r.drum={name:'',lower:'',upper:''}; r.pack=pack; r.uom='M'; r.loc=r.loc||'DY-01'; }
  drawRows(); }
function drumLen(i){ const d=nIn.rows[i].drum; $('#dl'+i).querySelector('b').textContent=fmt(Math.max(0,(d.upper||0)-(d.lower||0)))+' m'; }
function lookup(code){ return MC.get(code)||newMats.get(code); }
function acType(i,el){
  const v=el.value.trim(); nIn.rows[i].q=v; const box=$('#ac'+i);
  if(v.length<2){box.hidden=true;return}
  const lv=v.toLowerCase(), hits=[];
  for(const m of [...newMats.values(),...MC.values()]){ if(m.code.startsWith(v)||m.name.toLowerCase().includes(lv)){hits.push(m); if(hits.length>=8)break;} }
  const isCode=/^\d{6,}$/.test(v), exact=lookup(v);
  box.innerHTML=hits.map(m=>`<div onmousedown="pickMat(${i},'${m.code}')"><code>${m.code}</code><span>${esc(m.name)}</span><em>${esc(shortCat(m.cat))}</em></div>`).join('')+(isCode&&!exact?`<div class="add" onmousedown="newCode(${i},'${v}')"><code>${esc(v)}</code><span>Not in Material Codes. Add it as a new material</span><em>NEW</em></div>`:'')||`<div style="color:var(--dim);cursor:default">No match. Type the full code to add it as new.</div>`;
  box.hidden=false;
}
function closeAc(i,el){ const b=$('#ac'+i); if(b) b.hidden=true; const v=el.value.trim(); if(/^\d{6,}$/.test(v)&&nIn.rows[i].code!==v){ lookup(v)?pickMat(i,v):newCode(i,v);} }
function pickMat(i,code){ const m=lookup(code); const r=nIn.rows[i]; Object.assign(r,{code,q:code,name:m.name,cat:shortCat(m.cat),known:MC.has(code)}); if(/CBL|CABLE/i.test(m.name)) r.uom='M'; drawRows(); }
function newCode(i,code){ Object.assign(nIn.rows[i],{code,q:code,name:'',cat:'',known:false}); drawRows(); }
async function saveInbound(){
  keepHead(); const ok=nIn.rows.filter(r=>r.code||r.name); const msg=$('#nMsg');
  if(!ok.length){toast('Add at least one material');return}
  /* A NAME, AND NOTHING ELSE, IS ENOUGH. This used to demand a category
     for any code it did not recognise, which fought the person loading a
     warehouse from paper at exactly the moment they had least to go on -
     and it contradicted the New materials tab, which exists to categorise
     things later. The category defaults to Other below and the row can be
     corrected from Inventory with the pencil. A name is still wanted,
     because a line with no name is not a record of anything. */
  if(ok.find(r=>!r.name||!String(r.name).trim())){msg.innerHTML='<b style="color:var(--new)">Every row needs a material name. Everything else can wait.</b>';return}
  if(ok.find(r=>r.drum&&(!r.drum.name||!(+r.drum.upper>+r.drum.lower)))){msg.innerHTML='<b style="color:var(--warn)">Each drum needs a name, and the upper reading must be above the lower.</b>';return}
  if(ok.find(r=>r.cable&&(r.ra==null||r.rb==null||r.ra===''||r.rb===''))){msg.innerHTML='<b style="color:var(--warn)">A returned cable piece needs its start and end readings.</b>';return}
  /* 061 made the site a per-row answer in the database and moved the
     refusal into the item loop. The PAGE kept asking the note for it -
     and the return form has no note-level site box - so a return typed
     the way his sheet has it, a site against every row, was refused
     before it ever reached wh_inbound. Checked on the rendered page
     first: one row carrying AUS0123, refused. It now asks the same
     question of the same place, and names the row, as the function does. */
  if(nIn.type==='RT'){ const b=ok.findIndex(r=>!String(r.site||'').trim());
    if(b>=0){msg.innerHTML='<b style="color:var(--new)">Row '+(b+1)+' of a site return needs the site ID it came from.</b>';return} }
  const pj=$('#nPj').value; if(!pj||pj===NEWPJ){msg.innerHTML='<b style="color:var(--warn)">Pick the project.</b>';return}
  keepHead();
  const p={kind:nIn.type==='RT'?'SRN':'GRN',from_wh:(nIn.wh||'').trim(),is_local:!!nIn.local,
    vendor:(nIn.vendor||'').trim(),source:nIn.redep?'redep':'',date:nIn.date||today(),project:pj,ref:nIn.ref||'',
    removed_on:nIn.removed||'',by:nIn.by||ME(),
    items:ok.map(r=>({code:r.code||'',name:r.name,cat:r.cat||'Other',uom:(r.drum||r.cable)?'M':(r.uom||'EA'),qty:+(r.qty||1),sn:r.sn||'',bin:r.loc||'',
      remarks:r.remarks||'',
      /* 061: the row's own answer, when it has one. wh_inbound falls
         back to the note's, so a delivery with one reservation is
         unchanged. */
      reservation_no:r.res||'',site_id:r.site||'',site_name:r.siteName||'',
      cond:nIn.type==='RT'?(r.cond||'Good'):null,is_new:!!(r.code&&!r.known),
      pack:r.drum?(r.pack||'drum'):null,
      drum_name:r.drum?r.drum.name.trim():null,drum_lower:r.drum?+r.drum.lower:null,drum_upper:r.drum?+r.drum.upper:null,
      read_start:r.cable?+r.ra:null,read_end:r.cable?+r.rb:null}))};
  const btn=event&&event.target; if(btn) btn.disabled=true;
  try{ const id=await DB.whInbound(p); rSel=id;
    /* A warehouse name typed for the first time joins the list, so the
       next note picks it instead of retyping it slightly differently.
       After the note is filed, never before: a name is only real once
       something actually arrived from it. Failing to remember it must
       not fail the note that is already saved. */
    /* every new name this note introduced, through the one add */
    await lookAdd('source',p.from_wh);
    await lookAdd('vendor',p.vendor);
    for(const it of p.items) await lookAdd('location',it.bin); toast(`${id} saved · ${ok.length} item${ok.length===1?'':'s'} in stock`); await reload(); nIn=null; if(tById(id)) showInbound(tById(id)); }
  catch(e){ msg.innerHTML=`<b style="color:var(--bad)">${esc(e.message)}</b>`; }
  finally{ if(btn) btn.disabled=false; }
}

/* ================= ISSUE OUT ================= */
function modelOf(n){ n=n.replace(/^HUA_|^Huawei_|^HW_?|^Hua_/i,''); if(/_/.test(n)){ const p=n.split('_'); n=p.slice(0,2).join('_'); } return n.length>22?n.slice(0,22):n; }
function noteRows(t){ // one printed line per item; drums print their cut
  return t.items.map(x=>{ const L=lById(x.lineId); const short=L.pending?L.name.replace(/ \(local purchase\)/,'').slice(0,26):L.sn?modelOf(L.name).split('_')[0]:modelOf(L.name);
    return {desc: L.drum?`Cable drum ${L.drum.name} · ${x.cut.to}→${x.cut.from} m`:`${short}${L.sn?' - '+L.sn:''}${x.cut?' · '+x.cut.to+'→'+x.cut.from+' m':''}`, unit:L.uom==='M'?'M':'PCS', qty:x.qty, remarks:x.remarks||'', code:L.code, L, x}; });
}
function showDispatch(t){
  const R=noteRows(t);
  $('#iPane').innerHTML=`<div class="h"><span class="tk dn" style="font-size:14px">${t.id}</span><h3>${destTitle(t)}</h3><div class="sp"></div><button class="btn sm" onclick="printNote('${t.id}')">Print / Save PDF</button>${noteEditBtn(t)}<button class="btn sm" onclick="openReturn('${t.id}')" title="Book material back in from this note">↩ Return</button>${noteEditBtn(t)}<button class="btn sm danger" onclick="delNote('${t.id}')" title="Delete this note and put its stock back">Delete note</button></div>
  <div class="pbody">
    <div class="box"><h4>Outbound details</h4><div class="fh five">
      ${[['Date',dshort(t.date)],...(t.dest==='party'?[['3rd party',t.party],['Purpose',t.purpose],['Their ref / PO',t.partyRef]]:[]),['Project',t.project],['Requested by',t.requestedBy],['Issued by',t.issuedBy],['Receiver',t.receiver],['Vehicle no',t.vehicle],['Driver name',t.driver],['Driver NIC',t.driverNic],['Contact no',t.contact],['Issuer contact',t.issuedContact],['Items',t.items.length+(t.items.length===1?' line':' lines')]].map(([k,v])=>`<div class="f"><label>${k}</label><div class="in" style="background:rgba(5,10,28,.25)">${esc(v)||'<span style="color:var(--dim)">—</span>'}</div></div>`).join('')}
    </div></div>
    <div class="rows"><table><thead><tr><th style="width:36px">No</th><th style="width:120px">Code</th><th>Items &amp; description</th><th style="width:60px">Unit</th><th style="width:80px;text-align:right">Issued</th><th style="width:110px">Remarks</th><th style="width:200px">Current location</th><th style="width:40px"></th></tr></thead><tbody>
    ${R.map((r,i)=>{const w=whereOf(r.L);return `<tr><td class="dt">${i+1}</td><td class="code">${r.code}</td><td class="name" style="max-width:none">${esc(r.desc)}</td><td>${r.unit}</td><td class="num">${fmt(r.qty)}</td><td class="dt">${esc(r.remarks)}</td><td class="dt" style="color:${r.L.drum?'#ffd9a8':w.cls==='tp'?'var(--tp)':w.cls==='st'?'var(--site)':'var(--ok)'}">${r.L.drum?'cut from '+esc(r.L.drum.name):esc(w.top)}</td><td>${rowEdit(r.L.id,r.L.sn||r.L.name)}${rowDel(t,r.L.id,r.L.sn||r.L.name)}</td></tr>`}).join('')}
    </tbody></table></div>
  </div>`;
}
let nDn=null;
function newDispatch(){ iSel=null; renderIList(); nDn={dest:'site',party:'',purpose:'Repair',partyRef:'',date:today(),site:'',siteName:'',project:'',requestedBy:'',receiver:'',vehicle:'',driver:'',driverNic:'',contact:'',issuedBy:ME(),issuedContact:'',rows:[{}]}; drawDispatch(); }
function drawDispatch(){
  const f=(k,l,ph,cls='')=>`<div class="f"><label>${l}</label><input class="in ${cls}" value="${esc(nDn[k])}" placeholder="${ph}" oninput="nDn['${k}']=this.value${k==='site'?";const n=siteLookup(this.value);if(n){nDn.siteName=n;$('#dSn').value=n}":''}" ${k==='siteName'?'id="dSn"':''}></div>`;
  $('#iPane').innerHTML=`<div class="h"><span class="tk dn" style="font-size:14px">OBN · new</span><h3>New outbound</h3><span class="k">gets its note no when saved</span></div>
  <div class="pbody">
    <div class="box ${nDn.dest==='party'?'tpb':''}"><div style="display:flex;align-items:center;gap:12px;margin-bottom:10px"><h4 style="margin:0">Outbound details</h4><div class="seg"><button class="${nDn.dest!=='party'?'on':''}" onclick="nDn.dest='site';drawDispatch()">To site</button><button class="${nDn.dest==='party'?'on':''}" onclick="nDn.dest='party';drawDispatch()">To 3rd party</button></div></div><div class="fh five">
      <div class="f"><label>Date</label><input class="in mono" type="date" value="${nDn.date}" oninput="nDn.date=this.value"></div>
      ${nDn.dest==='party'?`<div class="f"><label>3rd party company</label><input class="in" list="parties" value="${esc(nDn.party)}" placeholder="Fame, DAR, Browns…" oninput="nDn.party=this.value"><datalist id="parties">${PARTIES.map(x=>`<option>${x}</option>`).join('')}</datalist><small>type a new name to add it</small></div>
      <div class="f"><label>Purpose</label><select class="in" onchange="nDn.purpose=this.value">${PURPOSES.map(x=>`<option ${x===nDn.purpose?'selected':''}>${x}</option>`).join('')}</select></div>`:`${f('site','Site ID','e.g. ZZ0071','mono')}${f('siteName','Site name','fills from Site Access')}`}
      <div class="f"><label>Project</label><select class="in" onchange="nDn.project=this.value"><option value="">Pick a project…</option>${PROJECTS.map(p=>`<option ${p===nDn.project?'selected':''}>${esc(p)}</option>`).join('')}<option>${NEWPJ}</option></select></div>
      ${f('requestedBy','Requested by','Mr. …')}
      ${f('receiver','Receiver','')}${f('vehicle','Vehicle no','','mono')}${f('driver','Driver name','')}${f('driverNic','Driver NIC','','mono')}${f('contact','Receiver contact no','','mono')}${f('issuedBy','Issued by','')}${f('issuedContact','Issuer contact no','','mono')}${nDn.dest==='party'?f('partyRef','Their ref / PO','e.g. BR-RMA-2240','mono'):''}
    </div></div>
    <div class="pick" style="margin-bottom:12px"><input class="in" id="pq" style="width:100%" placeholder="Quick add from stock: scan an SN, or type code / name / drum…" oninput="pickSearch(this.value)" onblur="setTimeout(()=>$('#pr').hidden=true,180)"><div class="ac" id="pr" hidden></div></div>
    <div class="rows"><table><thead><tr><th style="width:36px">#</th><th style="width:220px">Material code</th><th>Material name</th><th style="width:130px">Category</th><th style="width:84px">UoM</th><th style="width:90px">Qty</th><th style="width:200px">SN</th><th style="width:140px">Remarks</th><th style="width:40px"></th></tr></thead><tbody id="dBody"></tbody></table></div>
    <button class="btn sm" style="margin-top:10px" onclick="nDn.rows.push({});drawDRows()">+ Add row</button>
  </div>
  <div class="ff"><div class="msg" id="dMsg">Type a code, SN or name in a row. Stock links itself; anything else (local purchase, not received yet) goes out as a <b style="color:var(--warn)">direct issue</b> and waits for you to receive it later.</div><button class="btn" onclick="newDispatch()">Clear</button><button class="btn pri" onclick="saveDispatch()">Save outbound</button></div>`;
  drawDRows();
}
function drawDRows(){
  $('#dBody').innerHTML=nDn.rows.map((r,i)=>{
    const L=r.lineId?lById(r.lineId):null, ro=L?'readonly':'';
    const has=r.code||r.name;
    const st=!has?'':L?`<span class="mstate ok">✓ in stock · ${esc(L.drum?'drum '+L.drum.name:L.loc)}</span>`:`<span class="mstate" style="color:var(--warn)">● direct issue · receive later${r.code&&!r.known?' · new code':''}</span>`;
    const cab=r.cable, dtw=snTwin(r.sn, r.lineId||undefined);
    return `<tr><td class="dt">${i+1}</td>
    <td class="cell"><input class="in mono" value="${esc(r.q??r.code??'')}" placeholder="code, SN or name" oninput="dAc(${i},this)" onblur="setTimeout(()=>dClose(${i},this),180)">${st}
      ${L||!isCableRow(r)?'':`<button class="dbtn ${cab?'on':''}" onclick="toggleCable(${i})">${cab?'● Cable':'+ Cable'}</button>`}<div class="ac" id="dac${i}" hidden></div></td>
    <td><input class="in" value="${esc(r.name||'')}" placeholder="${has?'type the material name':'fills in, or type it'}" ${L||r.known?'readonly':''} oninput="nDn.rows[${i}].name=this.value"></td>
    <td>${L||r.known?`<input class="in" readonly value="${esc(r.cat||'')}">`:`<select class="in" onchange="nDn.rows[${i}].cat=this.value"><option value="">category · later</option>${CATS.map(c=>`<option ${r.cat===c?'selected':''}>${c}</option>`).join('')}</select>`}</td>
    <td><select class="in" ${L?'disabled':''} onchange="nDn.rows[${i}].uom=this.value">${['EA','M','SET','ROLL','BOX','PKT'].map(u=>`<option ${(r.uom||'EA')===u?'selected':''}>${u}</option>`).join('')}</select></td>
    <td><input class="in mono" id="dq${i}" style="text-align:right" value="${(L&&L.drum&&r.whole)?fmt(L.drum.cur-L.drum.lower):cab?(r.qty||''):(r.qty??1)}" ${cab||(L&&!L.drum)||(L&&L.drum&&r.whole)?'readonly':''} placeholder="${cab?'from readings':''}" oninput="nDn.rows[${i}].qty=+this.value"></td>
    <td><input class="in mono" value="${esc(r.sn||'')}" ${ro||cab?'readonly':''} placeholder="${cab?'—':'scan or type'}" oninput="nDn.rows[${i}].sn=this.value;snWarn(${i},1)"><span id="snw1_${i}">${L?'':(dtw?twinSays(dtw):'')}</span></td>
    <td><input class="in" value="${esc(r.remarks||'')}" oninput="nDn.rows[${i}].remarks=this.value"></td>
    <td class="rowx"><button class="tick${r.ok?' on':''}" title="${r.ok?'Checked - press to unlock':'Mark this row checked'}" onclick="nDn.rows[${i}].ok=!nDn.rows[${i}].ok;drawDRows()">✓</button><button class="btn sm" style="padding:6px 9px" onclick="nDn.rows.splice(${i},1);drawDRows()">✕</button></td></tr>
    ${cab?cableRow(i,r,L):''}`}).join('');
}
/* Which end moves decides what the handover reading says. Cutting from
   the upper end drops it; cutting from the lower end raises it. */
const hrText=(d,r)=>{ const q=+r.qty||0;
  if((r.cutEnd||'upper')==='lower') return q?d.lower+' → '+(d.lower+q):d.lower+' → …';
  return q?d.cur+' → '+(d.cur-q):d.cur+' → …'; };
function drumHow(i,how){ const r=nDn.rows[i];
  if(how==='whole'){ r.whole=true; delete r.cutEnd; }
  else { delete r.whole; r.cutEnd=how; }
  drawDRows(); }
function cableRow(i,r,L){
  if(L&&L.drum){ const d=L.drum, how=r.whole?'whole':(r.cutEnd||'upper');
    /* A drum can do three things, and until now it could only do one.
       Sending it whole is not a third kind of line - it is the ordinary
       whole-item path an RRU takes - so the only thing this picks is
       which numbers to send. */
    const chip=(k,t)=>`<button class="dbtn ${how===k?'on':''}" onclick="drumHow(${i},'${k}')">${how===k?'● ':''}${t}</button>`;
    return `<tr class="drumrow"><td colspan="9"><div class="drumbox">
      <div><label>Drum</label><input class="in mono" readonly value="${esc(d.name)} · ${esc(modelOf(L.name))} · ${fmt(d.cur-d.lower)} m left" title="${esc(L.name)}"></div>
      <div style="grid-column:span 2"><label>What is going</label><div class="drumhow">${chip('upper','Cut from upper')}${chip('lower','Cut from lower')}${chip('whole','Send the whole drum')}</div></div>
      ${r.whole?'':`<div><label>Cut length (m)</label><input class="in mono" style="text-align:right" value="${r.qty||''}" placeholder="how much" oninput="nDn.rows[${i}].qty=+this.value;updCab(${i})"></div>
      <div><label>Handover reading</label><input class="in mono" readonly id="hr${i}" value="${hrText(d,r)}"></div>`}
      <div class="len" id="cl${i}">${r.whole?`the whole drum goes · <b style="color:var(--ok)">${fmt(d.cur-d.lower)} m</b>, reading ${d.lower}–${d.cur}`:cutText(L,r.qty)}</div></div></td></tr>`; }
  return `<tr class="drumrow"><td colspan="9"><div class="drumbox">
      <div><label>Start reading (m)</label><input class="in mono" style="text-align:right" value="${r.ra??''}" placeholder="marking at one end" oninput="nDn.rows[${i}].ra=this.value;updCab(${i})"></div>
      <div><label>End reading (m)</label><input class="in mono" style="text-align:right" value="${r.rb??''}" placeholder="marking at the other" oninput="nDn.rows[${i}].rb=this.value;updCab(${i})"></div>
      <div></div>
      <div class="len" id="cl${i}">${manText(r)}</div></div></td></tr>`;
}
function manText(r){ if(r.ra===''||r.rb===''||r.ra==null||r.rb==null) return 'Write both markings on the cable piece. Qty is worked out from them.'; const n=Math.abs(+r.rb-+r.ra); return `Reading <b>${r.ra} → ${r.rb}</b> = ${fmt(n)} m`; }
function updCab(i){ const r=nDn.rows[i], L=r.lineId?lById(r.lineId):null;
  if(L&&L.drum){ const hb=$('#hr'+i); if(hb) hb.value=hrText(L.drum,r); $('#cl'+i).innerHTML=cutText(L,r.qty); $('#dq'+i).value=r.qty||''; }
  else { $('#cl'+i).innerHTML=manText(r); if(r.ra!==''&&r.rb!==''&&r.ra!=null&&r.rb!=null){ r.qty=Math.abs(+r.rb-+r.ra); $('#dq'+i).value=r.qty; } } }
function toggleCable(i){ const r=nDn.rows[i]; r.cable=!r.cable; if(r.cable){ r.uom='M'; r.qty=''; r.sn=''; } drawDRows(); }
function cutText(L,len){ const d=L.drum; if(!len) return `reading now ${d.lower}–${d.cur} · ${fmt(d.cur-d.lower)} m on drum`; if(len>d.cur-d.lower) return `<span style="color:var(--bad)">only ${fmt(d.cur-d.lower)} m left on this drum</span>`; return `hand over ${d.cur} → ${d.cur-len} · drum keeps <b style="color:var(--ok)">${fmt(d.cur-len-d.lower)} m</b>`; }
const usedIds=()=>new Set(nDn.rows.map(r=>r.lineId).filter(Boolean));
function stockHits(v,n){ const lv=v.toLowerCase(), u=usedIds(); return lines.filter(L=>L.status==='in'&&!u.has(L.id)&&(!L.drum||L.qty>0)&&[L.sn,L.code,L.name,L.drum&&L.drum.name].join(' ').toLowerCase().includes(lv)).slice(0,n); }
function dAc(i,el){
  const v=el.value.trim(); const r=nDn.rows[i]; r.q=v; const box=$('#dac'+i);
  if(v.length<2){box.hidden=true;return}
  const lv=v.toLowerCase(); const sh=stockHits(v,6); const mc=[];
  for(const m of [...newMats.values(),...MC.values()]){ if(m.code.startsWith(v)||m.name.toLowerCase().includes(lv)){mc.push(m); if(mc.length>=5)break;} }
  box.innerHTML=(sh.length?'<div style="cursor:default;color:var(--ok);font-family:Space Mono;font-size:10.5px;letter-spacing:.1em">IN STOCK</div>':'')+
    sh.map(L=>`<div onmousedown="dPickLine(${i},${L.id})"><code>${L.code}</code><span>${L.drum?'<b style="color:#ffd9a8">drum '+esc(L.drum.name)+'</b> · ':''}${esc(L.name)}</span><em>${L.drum?fmt(L.qty)+' m left':esc(L.sn||fmt(L.qty)+' '+L.uom)}</em>${originOf(L)}<span class="loc" style="flex:none">${esc(L.loc)}</span></div>`).join('')+
    (mc.length?'<div style="cursor:default;color:var(--warn);font-family:Space Mono;font-size:10.5px;letter-spacing:.1em">NOT IN STOCK · DIRECT ISSUE, RECEIVE LATER</div>':'')+
    mc.map(m=>`<div onmousedown="dPickMC(${i},'${m.code}')"><code>${m.code}</code><span>${esc(m.name)}</span><em>${esc(shortCat(m.cat))}</em></div>`).join('')+
    `<div class="add" onmousedown="dFree(${i})"><span>Use “${esc(v)}” as typed (local purchase, no code yet)</span><em>MANUAL</em></div>`;
  box.hidden=false;
}
function dClose(i,el){ const b=$('#dac'+i); if(b) b.hidden=true; const r=nDn.rows[i]; const v=el.value.trim(); if(!v||r.code===v||r.lineId||(r.name&&!r.code)) return;
  const sn=lines.find(L=>L.status==='in'&&L.sn&&L.sn.toLowerCase()===v.toLowerCase()); if(sn) return dPickLine(i,sn.id);
  if(/^\d{6,}$/.test(v)){ return MC.get(v)||newMats.get(v)?dPickMC(i,v):(Object.assign(r,{code:v,q:v,name:'',cat:'',known:false}),drawDRows()); }
}
function dPickLine(i,id){ const L=lById(id); nDn.rows[i]={q:L.sn||(L.drum&&L.drum.name)||L.code,lineId:id,code:L.code,name:L.name,cat:L.cat,uom:L.drum?'M':L.uom,qty:L.drum?'':L.qty,sn:L.sn||'',cable:!!L.drum,known:true,remarks:nDn.rows[i].remarks||''}; drawDRows(); }
function dPickMC(i,code){ const m=lookup(code); const r=nDn.rows[i]; const cab=/CBL|CABLE/i.test(m.name); Object.assign(r,{lineId:null,q:code,code,name:m.name,cat:shortCat(m.cat),known:MC.has(code),uom:cab?'M':'EA',cable:cab,qty:cab?'':1}); drawDRows(); }
function dFree(i){ const r=nDn.rows[i]; Object.assign(r,{lineId:null,code:'',name:r.q,q:'',known:false,cat:'',qty:1}); drawDRows(); }
function pickSearch(v){
  v=v.trim(); const box=$('#pr'); if(v.length<2){box.hidden=true;return}
  const hits=stockHits(v,10);
  box.innerHTML=hits.map(L=>`<div onmousedown="addPick(${L.id})"><code>${L.code}</code><span>${L.drum?'<b style="color:#ffd9a8">drum '+esc(L.drum.name)+'</b> · ':''}${esc(L.name)}</span><em>${L.drum?fmt(L.qty)+' m left':L.sn||fmt(L.qty)+' '+L.uom}</em>${originOf(L)}<span class="loc" style="flex:none">${esc(L.loc)}</span></div>`).join('')||'<div style="color:var(--dim);cursor:default">Not in stock. Type it in a row below to issue it directly.</div>';
  box.hidden=false;
}
function addPick(id){ let i=nDn.rows.findIndex(r=>!r.code&&!r.name&&!r.q); if(i<0){nDn.rows.push({});i=nDn.rows.length-1} dPickLine(i,id); $('#pq').value=''; $('#pq').focus(); }
async function saveDispatch(){
  const m=$('#dMsg'), bad=t=>{m.innerHTML=`<b style="color:var(--site)">${esc(t)}</b>`};
  if(nDn.dest==='party'?!nDn.party.trim():!nDn.site.trim()) return bad(nDn.dest==='party'?'Type the 3rd party company.':'Type the site ID first.');
  if(!nDn.project||nDn.project===NEWPJ) return bad('Pick the project.');
  const rows=nDn.rows.filter(r=>r.lineId||r.code||r.name);
  if(!rows.length) return bad('Add at least one item.');
  for(const r of rows){ const L=r.lineId&&lById(r.lineId);
    if(L&&L.drum&&!r.whole&&(!(+r.qty>0)||+r.qty>L.qty)) return bad(`Give drum ${L.drum.name} a cut length that fits what is left on it, or send the whole drum.`);
    if(!L&&!r.name) return bad('Every manual row needs a material name.');
    if(!L&&r.cable&&(r.ra==null||r.rb==null||r.ra===''||r.rb==='')) return bad('A cable piece needs its start and end readings.');
    if(!L&&!(+r.qty>0)) return bad('Every manual row needs a quantity.'); }
  const p={date:nDn.date||today(),project:nDn.project,dest:nDn.dest,site_id:nDn.dest==='site'?nDn.site.trim().toUpperCase():'',site_name:nDn.dest==='site'?nDn.siteName:'',
    party:nDn.dest==='party'?nDn.party.trim():'',purpose:nDn.dest==='party'?nDn.purpose:'',party_ref:nDn.dest==='party'?nDn.partyRef:'',
    requested_by:nDn.requestedBy,receiver:nDn.receiver,vehicle:nDn.vehicle,driver:nDn.driver,driver_nic:nDn.driverNic,contact:nDn.contact,issued_by:nDn.issuedBy||ME(),issued_contact:nDn.issuedContact,
    items:rows.map(r=>{ const L=r.lineId&&lById(r.lineId);
      if(L) return {item_id:L.id,whole:!!(L.drum&&r.whole),cut:(L.drum&&!r.whole)?+r.qty:null,
        cut_end:(L.drum&&!r.whole)?(r.cutEnd||'upper'):null,remarks:r.remarks||''};
      return {code:r.code||'',name:r.name,cat:r.cat||'Other',uom:r.cable?'M':(r.uom||'EA'),qty:+r.qty,sn:r.sn||'',is_new:!!(r.code&&!MC.has(r.code)),
        read_start:r.cable?+r.ra:null,read_end:r.cable?+r.rb:null,remarks:r.remarks||''}; })};
  const btn=event&&event.target; if(btn) btn.disabled=true;
  try{ const id=await DB.whOutbound(p); iSel=id; const pend=rows.filter(r=>!r.lineId).length;
    toast(`${id} saved · ${rows.length} item${rows.length===1?'':'s'} to ${p.site_id||p.party}${pend?` · ${pend} direct issue`:''}`);
    await reload(); if(tById(id)) showDispatch(tById(id)); }
  catch(e){ bad(e.message); }
  finally{ if(btn) btn.disabled=false; }
}

/* ================= PRINTED NOTE (A4 → PDF) ================= */
/* The Tooway Engineers logo, kept inside the page so the note never prints without it. */
const TOOWAY_LOGO='data:image/png;base64,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';
function noteHTML(t){
  const R=noteRows(t), PER=25, pages=[]; for(let i=0;i<Math.max(1,R.length);i+=PER) pages.push(R.slice(i,i+PER));
  const dt=String(t.date||'').split('-').reverse().join('/'), party=t.dest==='party';
  const V=v=>v?`<span class="v">${esc(v)}</span>`:'<span class="v e"></span>';
  const row=(k,v)=>`<div class="kv"><label>${k}</label>${V(v)}</div>`;
  return pages.map((P,pi)=>`<div class="pn dn-page">
    <div class="hd"><div class="lg"><img src="${TOOWAY_LOGO}" alt="Tooway Engineers (Pvt) Ltd"></div>
      <div><div class="co">Tooway Engineers Private Limited</div><div class="ad"><span>No. 23/D, Katulanda, Dekatana.</span><span>info@tooway.lk</span><span>0703471374</span></div></div></div>
    <div class="sub"><h3>Material Dispatch / Return Note</h3><span>${esc(dt)}${t.project?' · '+esc(t.project):''}</span></div>
    <img class="wm" src="${TOOWAY_LOGO}" alt="">
    <div class="dt">
      <div class="site"><label>${t.type==='IN'?'Received from':t.type==='RT'?'Returned from':party?'Issued to':'Going to'}</label>
        <div class="big">${esc(t.type==='IN'?(t.ref||'New stock'):party?t.party:siteCell(t))}</div><div class="nm">${esc(t.type==='IN'?(t.res?'Reservation '+t.res:''):party?(t.purpose||'3rd party'):t.siteName)}</div>
        <div class="pj">${[t.project,dt].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="req"><h4>Requested</h4>${row('Requested by',t.requestedBy)}</div>
      <div class="ho"><h4>Hand-over</h4>${row('Receiver',t.receiver)}${row('Vehicle no',t.vehicle)}${row('Driver name',t.driver)}${row('Driver NIC',t.driverNic)}${row('Contact no',t.contact)}</div>
    </div>
    <table><colgroup><col style="width:5.5%"><col style="width:27%"><col style="width:26%"><col style="width:7%"><col style="width:8%"><col style="width:9%"><col style="width:17.5%"></colgroup>
      <thead><tr><th>No</th><th>Items &amp; Description</th><th>Serial No</th><th>Unit</th><th>Issued Qty</th><th>Returned Qty</th><th>Remarks</th></tr></thead>
      <tbody>${Array.from({length:PER},(_,i)=>{ const r=P[i], n=pi*PER+i+1; if(!r) return `<tr><td class="n">${n}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
        const L=r.L, x=r.x, desc=L.drum?`Cable drum ${L.drum.name}`:(L.pending?L.name.replace(/ \(local purchase\)/,''):modelOf(L.name).replace(/_/g,' '));
        const sn=x.cut?`${x.cut.to} → ${x.cut.from} m`:(L.sn||'');
        return `<tr><td class="n">${n}</td><td class="hw">${esc(desc)}</td><td class="hw s">${esc(sn)}</td><td class="c hw">${r.unit}</td><td class="c hw">${String(r.qty).padStart(2,'0')}</td><td></td><td class="hw">${esc(r.remarks)}</td></tr>`; }).join('')}</tbody></table>
    <div class="sg">
      <div><h4>Issued by</h4>${row('Name',t.issuedBy)}${row('Contact no',t.issuedContact)}${row('Signature &amp; date','')}</div>
      <div><h4>Received by</h4>${row('Name',t.receiver)}${row('Contact no',t.contact)}${row('Signature &amp; date','')}</div>
    </div>
    <div class="ft"><span>${esc(t.id)} · printed from Tooway Warehouse</span><span>Page ${pi+1} of ${pages.length}</span></div>
  </div>`).join('');
}
/* Waits for the logo before the print dialog opens, so it is never missing from the PDF. */
async function printNote(id){
  $('#printArea').innerHTML=noteHTML(tById(id));
  await Promise.all([...$('#printArea').querySelectorAll('img')].map(i=>i.decode?i.decode().catch(()=>{}):null));
  window.print();
}

/* ================= DRUMS ================= */
function renderDrums(){
  const need=+$('#need').value||0, nm=$('#needMat').value;
  const D=lines.filter(L=>L.drum&&inProj(L));
  $('#nDr').textContent=D.length;
  $('#dGrid').innerHTML=D.sort((a,b)=>a.drum.name.localeCompare(b.drum.name)).map(L=>{
    const d=L.drum, tot=d.origUpper-d.origLower, left=d.cur-d.lower, pl=left/tot*100;
    const match=!nm||L.code===nm; const fits=need&&match&&left>=need;
    const cls=need?(fits?'fit':'nofit'):(left<tot*.2?'lowd':'');
    return `<div class="drum ${cls}">
      <div style="display:flex;align-items:center;gap:10px"><div class="nm">${esc(d.name)}</div><span class="chip">${esc(L.cat)}</span><span class="chip pj">${esc(L.project)}</span><div style="flex:1"></div><span class="dt mono" style="font-size:11.5px;color:var(--soft)">${esc(L.loc)}</span></div>
      <div class="mt"><code>${L.code}</code> · ${esc(L.name)}</div>
      <div class="rd"><div class="left" style="width:${pl}%"></div><div class="used" style="width:${100-pl}%"></div>${fits?`<div class="need" style="left:${(left-need)/tot*100}%;width:${need/tot*100}%"></div>`:''}</div>
      <div class="rdl"><span>lower ${d.lower}</span><span style="color:#bff0d6">now ${d.cur}</span><span>upper ${d.upper}</span></div>
      <div class="dq"><b>${fmt(left)} m</b><span>${L.status==='out'?`issued whole on ${esc(L.outTicket||'a note')}`:`left of ${fmt(tot)} m · in ${esc(L.inTicket)}`}</span></div>
      ${need&&match?`<div class="plan ${fits?'':'no'}">${fits?`Cut ${need} m: reading ${d.cur} → ${d.cur-need}. Leaves ${fmt(left-need)} m.`:`Not enough: ${fmt(left)} m left, ${fmt(need-left)} m short.`}</div>`:''}
      <div class="cuts">${d.cuts.length?d.cuts.map(c=>`<div>${tkChip(c.ticket)}<span>${dshort(c.date)} · ${c.site}</span><span style="margin-left:auto">${c.to}→${c.from}</span><b style="color:var(--ink)">${c.len} m</b></div>`).join(''):'<div>No cuts yet.</div>'}</div>
    </div>`}).join('');
}
$('#need').oninput=renderDrums; $('#needMat').onchange=renderDrums;

/* ================= NEW MATERIALS ================= */
function renderNm(){
  const S=stock();
  $('#nmTbl').innerHTML=`<thead><tr><th>Material code</th><th>Material name</th><th>Category</th><th>First received</th><th style="text-align:right">On hand</th><th></th></tr></thead><tbody>${
    [...newMats.values()].map(m=>`<tr><td class="code">${m.code}<span class="newtag">NEW</span></td><td><input class="in" style="width:100%" value="${esc(m.name)}" onchange="renameNew('${m.code}',this.value)"></td><td><span class="chip">${esc(m.cat)}</span></td><td class="dt">${m.first}</td><td class="num">${fmt((S.get(m.code)||{inQty:0}).inQty)}</td><td><button class="btn sm pri" onclick="addMC('${m.code}')">Add to Material Codes</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">Every code in the warehouse is in Material Codes.</td></tr>'}</tbody>`;
  $('#nNew').textContent=newMats.size;
}
async function renameNew(c,v){ v=v.trim(); if(!v) return; try{ await DB.whRename(c,v); newMats.get(c).name=v; lines.forEach(L=>{if(L.code===c)L.name=v}); renderAll(); }catch(e){ toast(e.message); } }
async function addMC(c){ if(!OWNER()){ toast('Only the owner adds to Material Codes.'); return; } const m=newMats.get(c); try{ await DB.whAddMaterial(c,m.name,TYPE_OF[m.cat]||m.cat); MC.set(c,{code:c,name:m.name,cat:TYPE_OF[m.cat]||m.cat}); newMats.delete(c); lines.forEach(L=>{if(L.code===c)L.isNew=false}); toast(`${c} added to Material Codes`); renderAll(); }catch(e){ toast(e.message); } }
async function addAllMC(){ for(const c of [...newMats.keys()]) await addMC(c); }

/* ================= WIRING ================= */
function renderAll(){ renderOv(); renderInv(); renderRList(); renderIList(); renderDrums(); renderNm(); }
function go(v){ document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.v===v)); document.querySelectorAll('.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v)); }
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>go(t.dataset.v));
const seg=(sel,key,fn)=>document.querySelectorAll(sel+' button').forEach(b=>b.onclick=()=>{document.querySelectorAll(sel+' button').forEach(x=>x.classList.toggle('on',x===b)); fn(b.dataset[key]);});
seg('#invMode','m',v=>{invMode=v;renderInv()}); seg('#fSt','s',v=>{fSt=v;renderInv()}); seg('#fPin','p',v=>{fPin=v;renderInv()});
seg('#rf','f',v=>{rFilter=v;renderRList()});
$('#q').oninput=()=>renderInv(); $('#fCat').onchange=()=>renderInv(); $('#rq').oninput=renderRList; $('#iq').oninput=renderIList;
$('#fCat').innerHTML+=CATS.map(c=>`<option>${c}</option>`).join('');
$('#projSel').onchange=e=>{proj=e.target.value;renderAll()};
$('#need').oninput=renderDrums; $('#needMat').onchange=renderDrums;
window.today=today;
(async function boot(){
  document.documentElement.dataset.tool='warehouse';
  try{ const r=await DB.materialsLoad(); (r.rows||[]).forEach(m=>{ const c=String(m.code||'').trim(); if(c) MC.set(c,{code:c,name:m.descr||m.desc||m.name||'',cat:m.type||''}); }); }catch(e){ console.warn('Material Codes did not load:',e.message); }
  try{ SITES=buildSiteIndex(await DB.load('site_access')); }catch(e){ SITES={}; }
  const ok=await reload(); if(!ok) return;
  newInbound(); newDispatch(); go('ov');
  try{ DB.whSubscribe(()=>reload()); }catch(e){}
})();

/* ---- editing -------------------------------------------------------

   ONE SHEET, FOUR PLACES. The same form is wanted on a GRN, an SRN, an
   OBN and in the Inventory tab, and three of those draw their own pane.
   One sheet used by all four is less code than four inline edit modes
   and cannot drift between them.

   ONLY WHAT CHANGED IS SENT, AND THAT IS LOAD-BEARING. wh_update_item
   decides whether an edit touches stock by whether the KEY is there:
   p ? 'qty'. Posting the whole form every time would make every edit a
   stock edit, so correcting a name on something that had already gone
   out would come back "the quantity of X cannot change" - refused for a
   field the typist never touched. Sending only the boxes that actually
   changed keeps a word edit a word edit. The server's rules are not
   softened by this; the payload is smaller, the guards are the same.

   NOTHING HERE PRE-JUDGES WHAT MAY CHANGE. Every refusal comes from the
   function, by name, and is shown inside the sheet rather than as a
   toast that slides away while the person is still reading it.

   EDITING IS may_read, NOT is_owner, matching 050: a mistyped driver's
   name is for whoever typed it to fix. Deleting stays owner-only. */
let ESC_H=null;
function closeSheet(){ const e=$('#esh'); if(e) e.remove();
  if(ESC_H){ document.removeEventListener('keydown',ESC_H); ESC_H=null; } }
function editSheet(o){
  closeSheet();
  const fld=f=>{
    const hint=f.hint?`<small>${esc(f.hint)}</small>`:'';
    if(f.type==='select') return `<div class="f"><label>${esc(f.label)}</label><select class="in" data-k="${f.k}">${f.opts.map(v=>`<option${String(f.v||'')===String(v)?' selected':''}>${esc(v)}</option>`).join('')}</select>${hint}</div>`;
    return `<div class="f"><label>${esc(f.label)}</label><input class="in${f.mono?' mono':''}" type="${f.type||'text'}" data-k="${f.k}" value="${esc(f.v==null?'':String(f.v))}"${f.ph?` placeholder="${esc(f.ph)}"`:''}>${hint}</div>`;
  };
  const d=document.createElement('div');
  d.id='esh'; d.className='esh';
  d.innerHTML=`<div class="ebox" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
    <h3>${esc(o.title)}</h3>${o.sub?`<p class="esub">${esc(o.sub)}</p>`:''}
    <div class="egrid">${o.fields.map(fld).join('')}</div>
    <p class="eerr" id="eerr" hidden></p>
    <div class="erow"><button class="btn sm" id="ecan">Cancel</button><div class="sp"></div><button class="btn pri sm" id="esav">Save changes</button></div></div>`;
  document.body.appendChild(d);
  const box=d.querySelector('.ebox');
  const was=new Map(o.fields.map(f=>[f.k,f.v==null?'':String(f.v)]));
  const say=m=>{ const e=$('#eerr'); e.textContent=m||''; e.hidden=!m; };
  $('#ecan').onclick=closeSheet;
  d.onclick=ev=>{ if(ev.target===d) closeSheet(); };
  ESC_H=ev=>{ if(ev.key==='Escape') closeSheet(); };
  document.addEventListener('keydown',ESC_H);
  $('#esav').onclick=async()=>{
    const changed={};
    box.querySelectorAll('[data-k]').forEach(e=>{ const k=e.getAttribute('data-k');
      if(e.value!==was.get(k)) changed[k]=e.value; });
    if(!Object.keys(changed).length){ say('Nothing has been changed.'); return; }
    const b=$('#esav'); b.disabled=true; say('');
    try{ await o.save(changed); closeSheet(); await reload(); if(o.after) o.after(); }
    catch(e2){ say(e2.message||String(e2)); b.disabled=false; }
  };
  const first=box.querySelector('.in'); if(first) first.focus();
}

/* WHAT EACH EDIT MAY SEND, DECLARED. The payload is assembled from
   whichever boxes changed, so there is no one object literal holding the
   key set - and wh-payload.test.js refuses to guess at a payload built by
   a function call, which is the right answer for a checker. So the page
   states its side here: these are the only keys either edit can send.
   The test compares these declarations against the keys wh_update_note
   and wh_update_item actually read, and whOnly() below throws on a key
   that is not declared, so the declaration cannot drift from what is
   sent without something saying so. */
const WH_SENDS_wh_update_note={id:1,note_date:1,project:1,ref:1,reservation_no:1,site_name:1,
  removed_on:1,purpose:1,party_ref:1,by_name:1,requested_by:1,receiver:1,vehicle:1,driver:1,
  driver_nic:1,contact:1,issued_by:1,issued_contact:1};
const WH_SENDS_wh_update_item={id:1,name:1,code:1,cat:1,uom:1,bin:1,sn:1,cond:1,project:1,vendor:1,source:1,
  drum_name:1,drum_lower:1,drum_upper:1,read_start:1,read_end:1,qty:1};
function whOnly(declared,p,fn){
  for(const k in p) if(!declared[k])
    throw new Error('The page tried to send "'+k+'", which '+fn+' does not read. That is a fault in the page, not in anything you typed.');
  return p;
}

/* The note's own words. site_id, destination and party are NOT offered:
   wh_update_note does not change them, because they are what the note
   moved stock to rather than how it was written up. */
const NOTE_F={
  IN:[['date','Inbound date','date'],['project','Project'],['res','Reservation no'],['ref','Supplier DN / PO'],['siteName','Site name'],['by','Received by']],
  RT:[['date','Inbound date','date'],['project','Project'],['ref','Return note no'],['siteName','Site name'],['removed','Removed on','date'],['by','Returned by']],
  DN:[['date','Issue date','date'],['project','Project'],['siteName','Site name'],['purpose','Purpose'],['partyRef','Third-party ref'],['requestedBy','Requested by'],['receiver','Receiver'],['vehicle','Vehicle'],['driver','Driver'],['driverNic','Driver NIC'],['contact','Driver contact'],['issuedBy','Issued by'],['issuedContact','Issued-by contact']]
};
const NOTE_COL={date:'note_date',project:'project',res:'reservation_no',ref:'ref',siteName:'site_name',
  removed:'removed_on',by:'by_name',purpose:'purpose',partyRef:'party_ref',requestedBy:'requested_by',
  receiver:'receiver',vehicle:'vehicle',driver:'driver',driverNic:'driver_nic',contact:'contact',
  issuedBy:'issued_by',issuedContact:'issued_contact'};
function editNote(id){
  const t=tById(id); if(!t) return;
  editSheet({
    title:'Edit '+id, sub:'The words on the note. Nothing here moves stock.',
    fields:(NOTE_F[t.type]||NOTE_F.IN).map(([k,label,type])=>({k,label,type,v:t[k]||'',mono:type==='date'||k==='res'||k==='ref'})),
    save:async ch=>{ const p={id}; for(const k in ch) p[NOTE_COL[k]]=ch[k];
      await DB.whUpdateNote(whOnly(WH_SENDS_wh_update_note,p,'wh_update_note')); toast(id+' updated'); },
    after:()=>{ const t2=tById(id); if(t2) (t2.type==='DN'?showDispatch:showInbound)(t2); }
  });
}

/* One item. The keys here ARE the keys wh_update_item reads - bin, not
   loc - so the sheet and the function cannot disagree about a name. */
function editItem(id){
  const L=lById(id); if(!L) return;
  const f=[{k:'name',label:'Material name',v:L.name},
    {k:'code',label:'Material code',v:L.code,mono:true,hint:'empty leaves it uncategorised - it shows on New materials'},
    {k:'cat',label:'Category',type:'select',opts:CATS,v:L.cat},
    {k:'uom',label:'Unit',type:'select',opts:['EA','M','SET','ROLL','BOX','PKT'],v:L.uom},
    {k:'bin',label:'Bin / location',v:L.loc,mono:true},
    {k:'sn',label:'Serial',v:L.sn,mono:true},
    {k:'project',label:'Project',v:L.project,hint:'empty for a local purchase that belongs to no project'},
    {k:'vendor',label:'Vendor · who owns it',v:L.vendor,hint:'Dialog, Mobitel, Hutch'},
    {k:'source',label:'How it arrived',type:'select',opts:['new','return','direct','local','redep'],v:L.source==='pending'?'direct':L.source}];
  if(L.cond||L.source==='return') f.push({k:'cond',label:'Condition',type:'select',opts:['Good','Faulty','Scrap'],v:L.cond||'Good'});
  if(L.drum){ f.push({k:'drum_name',label:'Drum name',v:L.drum.name,mono:true,hint:'a printed note draws this name from here, so it will read differently afterwards'},
    {k:'drum_lower',label:'Lower reading',v:L.drum.lower,mono:true},
    {k:'drum_upper',label:'Upper reading',v:L.drum.upper,mono:true}); }
  else if(L.read) f.push({k:'read_start',label:'Start reading',v:L.read.start,mono:true},
    {k:'read_end',label:'End reading',v:L.read.end,mono:true});
  else f.push({k:'qty',label:'Quantity',v:L.qty,mono:true});
  editSheet({
    title:'Edit '+(L.sn||(L.drum&&L.drum.name)||L.code||L.name),
    sub:L.status==='out'
      ? 'This went out on '+(L.outTicket||'an outbound note')+'. The words can still be corrected; the quantity cannot - the note is the record of what was sent.'
      : 'Correct whatever was typed wrong.',
    fields:f,
    save:async ch=>{ const p=Object.assign({id},ch);
      await DB.whUpdateItem(whOnly(WH_SENDS_wh_update_item,p,'wh_update_item')); toast('Updated'); },
    after:()=>{ if(invMode==='lines'&&$('#tbl')) renderInv(id); }
  });
}
const noteEditBtn=t=>`<button class="btn sm" onclick="editNote('${esc(t.id)}')" title="Correct the words on ${esc(t.id)}">✎ Edit</button>`;
const rowEdit=(itemId,label)=>`<button class="redit" title="Correct ${esc(String(label))}" onclick="editItem(${itemId})">✎</button>`;

/* ---- bringing a sheet in --------------------------------------------

   He is loading years of warehouse by hand, and most of it is already
   typed - into Excel, on somebody's laptop. This is the shortest path
   from that to here.

   IT FILLS THE GRID, IT DOES NOT WRITE TO THE DATABASE. Imported rows
   land in the inbound form exactly as if they had been typed: the same
   validation, the same Drum and Cable chips, the same save. An import
   that wrote straight to wh_items would be a second way in with its own
   rules, and the one thing this tool cannot afford is two ways in that
   disagree. Review-then-save is also how a column that landed in the
   wrong place gets caught, which is the usual thing to go wrong.

   PASTE IS THE INTERFACE, because it is what Excel already does.
   Selecting cells and copying puts tab-separated text on the clipboard,
   so pasting needs no file, no upload and no library. A .csv or .txt
   file can be chosen instead. A .xlsx cannot be read here - it is a zip
   of XML, and parsing it would mean shipping a library to do what
   Ctrl+C already does - so the sheet says so rather than failing
   quietly.

   HEADERS ARE MATCHED LOOSELY AND REPORTED EXACTLY. "Material Code",
   "material_code" and "CODE" all find the same field; anything not
   recognised is listed by name as ignored rather than silently dropped.
   A sheet with no header row still imports - the columns are then taken
   in the order the form shows them, and it says so. */
const IMP_FIELDS=[
  ['code',    ['code','material code','materialcode','item code','mat code','sap code']],
  ['name',    ['name','material name','description','descr','material','item']],
  ['cat',     ['cat','category','type']],
  ['uom',     ['uom','unit','units']],
  ['qty',     ['qty','quantity','qnty','nos','count']],
  ['sn',      ['sn','serial','serial no','serial number','esn']],
  ['loc',     ['loc','bin','location','wh location','warehouse location','rack','store','shelf']],
  ['remarks', ['remarks','remark','note','notes','comment','comments']],
  ['drumName',['drum','drum name','drum no','roll','roll no']],
  ['drumLower',['lower','drum lower','lower reading','from']],
  ['drumUpper',['upper','drum upper','upper reading','to']],
  /* His sheet's columns. Without these four the import read his file,
     said nothing, and dropped them - which is the failure mode this
     whole thing is supposed to avoid.
     "reservation no box no" is "Reservation No/Box No" after impNorm
     flattens the slash, which is the point of normalising at all. */
  ['site',       ['site','site id','siteid']],
  ['siteName',   ['site name','sitename']],
  ['reservation',['reservation','reservation no','reservation no box no','rsv','box no']],
  ['wh',         ['wh','warehouse','from wh','source wh','from warehouse']],
  ['vendor',     ['vendor','owner','operator']]
];
const impNorm=h=>String(h==null?'':h).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
function impField(header){
  const n=impNorm(header);
  for(const pair of IMP_FIELDS) if(pair[1].includes(n)) return pair[0];
  return null;
}
/* A delimiter-separated parser that understands quotes, because a
   material name with a comma in it is not an error. Tabs win when both
   are present, since that is what a spreadsheet paste gives. */
function impParse(text){
  const t=String(text||'').replace(/\r\n?/g,'\n').replace(/\n+$/,'');
  if(!t.trim()) return [];
  const d=t.includes('\t')?'\t':',';
  const rows=[]; let row=[], cur='', q=false;
  for(let i=0;i<t.length;i++){
    const c=t[i];
    if(q){ if(c==='"'){ if(t[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; continue; }
    if(c==='"'){ q=true; continue; }
    if(c===d){ row.push(cur); cur=''; continue; }
    if(c==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; continue; }
    cur+=c;
  }
  row.push(cur); rows.push(row);
  return rows.filter(r=>r.some(c=>String(c).trim()!==''));
}
/* A header row is one where enough cells name a field we know. Otherwise
   the first line is data and the columns go in form order. */
const IMP_ORDER=['code','name','cat','uom','qty','sn','loc','remarks'];
/* Where each imported column ends up. site, reservation and site name
   are per row and go straight on it - 061 made that real. wh and vendor
   are still note-level, so they are lifted to the note only when the
   whole sheet agrees; see impLift. */
const IMP_NOTE_LEVEL=['wh','vendor'];
function impPlan(rows){
  if(!rows.length) return null;
  const first=rows[0];
  const hit=first.map(impField);
  const named=hit.filter(Boolean).length;
  const header=named>=Math.max(2,Math.ceil(first.length/2));
  const map=header?hit:first.map((_,i)=>IMP_ORDER[i]||null);
  const ignored=header?first.filter((h,i)=>!hit[i]&&String(h).trim()!=='').map(String):[];
  return { header:header, map:map, ignored:ignored, body:rows.slice(header?1:0) };
}
function impRows(plan){
  return plan.body.map(r=>{
    const o={};
    plan.map.forEach((k,i)=>{ if(!k) return; const v=String(r[i]==null?'':r[i]).trim(); if(v!=='') o[k]=v; });
    const row={ name:o.name||'', code:o.code||'', q:o.code||'', cat:o.cat||'', uom:o.uom||'EA',
                qty:o.qty?(+String(o.qty).replace(/[^0-9.\-]/g,'')||1):1, sn:o.sn||'', loc:o.loc||'',
                remarks:o.remarks||'',
                res:o.reservation||'', site:(o.site||'').toUpperCase(),
                siteName:o.siteName||(o.site?siteLookup(o.site):'')||'',
                _wh:o.wh||'', _vendor:o.vendor||'' };
    if(o.code&&MC.has(o.code)){ const m=MC.get(o.code);
      row.name=row.name||m.name; row.cat=row.cat||shortCat(m.cat); row.known=true; }
    if(o.drumName){ row.drum={name:o.drumName,lower:+o.drumLower||0,upper:+o.drumUpper||0};
      row.pack='drum'; row.uom='M'; }
    return row;
  }).filter(r=>r.name||r.code||(r.drum&&r.drum.name));
}
/* wh and vendor are written once per note, not per row, so a sheet can
   only set them if it agrees with itself. One distinct value: take it.
   More than one: say which, take none, and leave them to the pencil -
   guessing which warehouse 300 rows came from is not this tool's job. */
function impLift(rows,key){
  const seen=[...new Set(rows.map(r=>r[key]).filter(v=>v&&v.trim()))];
  return { one: seen.length===1?seen[0]:'', many: seen.length>1?seen:[] };
}
let IMP=null;
function openImport(){
  if(!nIn){ toast('Open an inbound note first.'); return; }
  IMP={ text:'', plan:null, rows:[] };
  drawImport();
}
function impRead(el){
  const f=el.files&&el.files[0]; if(!f) return;
  if(/\.xlsx$/i.test(f.name)){
    $('#impMsg').textContent='An .xlsx cannot be read here. Open it, select the rows and paste them above, or save it as CSV.';
    return;
  }
  const r=new FileReader();
  r.onload=()=>{ IMP.text=String(r.result||''); const t=$('#impText'); if(t) t.value=IMP.text; impScan(); };
  r.readAsText(f);
}
function impScan(){
  const rows=impParse(IMP.text);
  IMP.plan=impPlan(rows);
  IMP.rows=IMP.plan?impRows(IMP.plan):[];
  const m=$('#impMsg'); if(!m) return;
  if(!IMP.rows.length){ m.textContent=IMP.text.trim()?'Nothing in that looks like a row.':''; impCount(); return; }
  const cols=IMP.plan.map.filter(Boolean);
  const wh=impLift(IMP.rows,'_wh'), ven=impLift(IMP.rows,'_vendor');
  IMP.lift={wh:wh.one,vendor:ven.one};
  const notes=[];
  if(wh.one)  notes.push('from warehouse <b>'+esc(wh.one)+'</b>');
  if(ven.one) notes.push('vendor <b>'+esc(ven.one)+'</b>');
  const clash=[];
  if(wh.many.length)  clash.push('warehouse ('+esc(wh.many.join(', '))+')');
  if(ven.many.length) clash.push('vendor ('+esc(ven.many.join(', '))+')');
  m.innerHTML='<b>'+IMP.rows.length+'</b> row'+(IMP.rows.length===1?'':'s')
    +' · columns read: '+esc(cols.join(', '))
    +(IMP.plan.header?'':' <i>(no header row found, columns taken in form order)</i>')
    +(notes.length?'<br>will set '+notes.join(' and ')+' on the note':'')
    +(clash.length?'<br><span style="color:var(--warn)">rows disagree on '+clash.join(' and ')
       +' - these are written once per note, so none is taken; set them per item afterwards</span>':'')
    +(IMP.plan.ignored.length?'<br><span style="color:var(--warn)">ignored: '+esc(IMP.plan.ignored.join(', '))+'</span>':'');
  impCount();
}
function impCount(){ const b=$('#esav'); if(b) b.textContent=IMP.rows.length?('Add '+IMP.rows.length+' row'+(IMP.rows.length===1?'':'s')):'Add rows'; }
function drawImport(){
  const html='<div class="f"><label>Paste from Excel</label>'
    +'<textarea class="in" id="impText" rows="7" placeholder="Select the cells in Excel, copy, and paste here." oninput="IMP.text=this.value;impScan()" style="font-family:\'Space Mono\';font-size:12px;resize:vertical"></textarea>'
    +'<small>or choose a .csv / .txt file <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onchange="impRead(this)" style="margin-left:6px"></small></div>'
    +'<p class="esub" id="impMsg" style="margin:12px 0 0"></p>';
  sheet({ title:'Bring a sheet in', save:'Add rows',
    sub:'The rows land in the form, not in the database - check them and press Save inbound as usual. A .xlsx cannot be read here; copy its cells or save it as CSV.',
    html:html, onSave:impApply });
  setTimeout(function(){ const t=$('#impText'); if(t) t.focus(); },30);
}
function impApply(){
  if(!IMP||!IMP.rows.length) throw new Error('Nothing to add yet - paste some rows first.');
  if(IMP.lift){ if(IMP.lift.wh&&!nIn.wh) nIn.wh=IMP.lift.wh;
                if(IMP.lift.vendor&&!nIn.vendor) nIn.vendor=IMP.lift.vendor; }
  IMP.rows.forEach(r=>{ delete r._wh; delete r._vendor; });
  const blank=nIn.rows.filter(r=>Object.keys(r).length===0).length;
  nIn.rows=nIn.rows.filter(r=>Object.keys(r).length>0).concat(IMP.rows);
  const n=IMP.rows.length; IMP=null;
  toast(n+' row'+(n===1?'':'s')+' added'+(blank?' · the blank row was replaced':''));
  drawInbound();
}

/* ---- material coming back -------------------------------------------

   FILED AGAINST THE NOTE THAT SENT IT. The form is opened from an
   outbound note and lists that note's own lines, so the link back to the
   OBN is made by where you are standing rather than by matching a serial
   afterwards. There is nothing to get wrong.

   WHAT THE SERVER DOES WITH IT, so the form can be read honestly:
   returning all of a line flips that row back into stock - the same row,
   not a second one. Returning part of it splits the row. Returning a
   length that was cut off a drum books a loose Cable piece, because the
   drum is physically shorter for ever and cannot be un-cut. The form
   says which of the three a line will take.

   A line already fully returned is shown and disabled rather than
   hidden, because "where did the other six go" is a question the note
   should answer on its face. */
/* Only the top level: line_id, qty, cond, bin and remarks live inside
   items[] and are read as it->>'...', not p->>'...'. */
const WH_SENDS_wh_return={obn:1,date:1,by:1,ref:1,items:1};
let RTN=null;
/* How much of each outbound line has already come back. Summed from
   wh_lines.returns_line when the page loads, the same way the server
   works it out, rather than kept as a second copy on the item. */
function returnableLines(t){
  return (t.items||[]).map(x=>{
    const L=lById(x.lineId); if(!L) return null;
    const back=RET.get(x.lid)||0;
    return { lid:x.lid, L, sent:+x.qty, back, left:+x.qty-back, cut:x.cut };
  }).filter(Boolean);
}
function openReturn(id){
  const t=tById(id); if(!t) return;
  const rows=returnableLines(t);
  if(!rows.length){ toast('This note has no lines to return.'); return; }
  RTN={ obn:id, date:today(), by:ME(), ref:'', rows:rows.map(r=>({...r, take:'', cond:'Good', bin:'', remarks:''})) };
  drawReturn();
}
/* What a line will DO depends on how much is typed into it, so the hint
   changes as it is typed. It is updated in place - rebuilding the sheet,
   or even the table body, would destroy the box being typed into. */
function rtnShape(i){
  const r=RTN.rows[i]; if(!r) return '';
  if(r.cut) return 'books in as a loose Cable piece - the drum stays short';
  if(+r.take>0&&+r.take<r.left) return 'splits the row · '+fmt(r.left-(+r.take))+' stays out';
  return 'flips the row back into stock';
}
function rtnHint(i){ const e=$('#rsh'+i); if(e) e.textContent=rtnShape(i); }
function drawReturn(){
  const t=tById(RTN.obn);
  const body=RTN.rows.map((r,i)=>{
    const what=r.L.sn||(r.cut?`${r.L.drum?r.L.drum.name:r.L.name} · cut ${r.cut.to}→${r.cut.from} m`:r.L.name);
    if(r.left<=0) return `<tr class="done"><td>${esc(what)}</td><td class="num">${fmt(r.sent)}</td><td colspan="4">all of it is already back</td></tr>`;
    return `<tr><td>${esc(what)}<small id="rsh${i}">${esc(rtnShape(i))}</small></td>
      <td class="num">${fmt(r.left)}</td>
      <td><input class="in mono" style="width:84px" value="${esc(r.take)}" placeholder="${fmt(r.left)}" oninput="RTN.rows[${i}].take=this.value;rtnHint(${i})"></td>
      <td><select class="in" onchange="RTN.rows[${i}].cond=this.value">${['Good','Faulty','Scrap'].map(c=>`<option${r.cond===c?' selected':''}>${c}</option>`).join('')}</select></td>
      <td><input class="in mono" style="width:110px" value="${esc(r.bin)}" placeholder="where it goes" oninput="RTN.rows[${i}].bin=this.value"></td>
      <td><input class="in" value="${esc(r.remarks)}" oninput="RTN.rows[${i}].remarks=this.value"></td></tr>`;
  }).join('');
  const html=`<div class="egrid" style="grid-template-columns:1fr 1fr">
      <div class="f"><label>Returned on</label><input class="in mono" type="date" value="${RTN.date}" oninput="RTN.date=this.value"></div>
      <div class="f"><label>Returned by</label><input class="in" value="${esc(RTN.by)}" oninput="RTN.by=this.value"></div>
      <div class="f"><label>Paper note no · optional</label><input class="in mono" value="${esc(RTN.ref)}" oninput="RTN.ref=this.value"></div>
    </div>
    <table class="rtbl"><thead><tr><th>What went out</th><th class="num">Still out</th><th>Coming back</th><th>Condition</th><th>WH location</th><th>Remarks</th></tr></thead><tbody>${body}</tbody></table>`;
  sheet({ title:'Return against '+RTN.obn,
    sub:'Leave a quantity empty to leave that line where it is. '+(t&&t.site?('It came back from '+t.site+'. '):'')+'The drum is never un-cut: a returned length books in as its own Cable piece.',
    html, save:'Book the return in', onSave:saveReturn });
}
async function saveReturn(){
  const items=RTN.rows.filter(r=>r.left>0&&+r.take>0)
    .map(r=>({line_id:r.lid, qty:+r.take, cond:r.cond, bin:r.bin, remarks:r.remarks}));
  if(!items.length) throw new Error('Put a quantity against at least one line.');
  const over=RTN.rows.find(r=>+r.take>r.left);
  if(over) throw new Error('Only '+fmt(over.left)+' of that line is still out.');
  const p={obn:RTN.obn, date:RTN.date, by:RTN.by, ref:RTN.ref, items};
  const id=await DB.whReturn(whOnly(WH_SENDS_wh_return,p,'wh_return'));
  toast(id+' booked in · '+items.length+' line'+(items.length===1?'':'s')+' back');
  RTN=null;
}

/* ---- taking several off at once -------------------------------------

   Loading a real warehouse by hand means typing things twice, and one
   row at a time is not a tool for cleaning that up.

   ONE RPC PER ROW, ON PURPOSE, AND THE REFUSALS ARE REPORTED PER ROW.
   wh_delete_item refuses by name - it went out on OBN-26-0004, its drum
   has been cut, it is on two other notes - and every one of those is a
   fact about one item. A single batch call would have to either roll the
   whole lot back because of one bad row, or drop the reasons on the
   floor. So each row is attempted on its own, the ones that went are
   counted, and the ones that would not are listed with exactly what the
   server said about each. A batch that is half refused is not a failure;
   it is the answer.

   The selection is kept by id, so filtering or searching the table does
   not quietly lose or widen it, and anything that no longer exists after
   a reload drops out of it.

   Owner only, because wh_delete_item is is_owner(). */
let selIds=new Set();
function selSync(){ const live=new Set(lines.map(L=>L.id));
  for(const id of [...selIds]) if(!live.has(id)) selIds.delete(id); }
function invTick(id,on){ on?selIds.add(id):selIds.delete(id); drawSelBar();
  const tr=document.querySelector('#tbl tr[data-row="'+id+'"]'); if(tr) tr.classList.toggle('sel',!!on); }
function selClear(){ selIds.clear(); renderInv(); }
function selAllShown(on){
  document.querySelectorAll('#tbl tbody input.tickbox').forEach(b=>{ b.checked=on;
    const id=+b.getAttribute('data-id'); on?selIds.add(id):selIds.delete(id);
    const tr=b.closest('tr'); if(tr) tr.classList.toggle('sel',on); });
  drawSelBar();
}
function drawSelBar(){
  const bar=$('#selBar'); if(!bar) return;
  const n=selIds.size;
  bar.hidden=!(n&&invMode==='lines'&&OWNER());
  if(bar.hidden) return;
  bar.innerHTML=`<b>${n}</b> row${n===1?'':'s'} selected<div class="sp"></div>`
    +`<button class="btn sm" onclick="selClear()">Clear</button>`
    +`<button class="btn sm danger" onclick="removeSelected()">Remove ${n} item${n===1?'':'s'}</button>`;
}
const tickBox=L=>OWNER()&&invMode==='lines'
  ? `<input type="checkbox" class="tickbox" data-id="${L.id}"${selIds.has(L.id)?' checked':''} onchange="invTick(${L.id},this.checked)" title="Select for removal">`
  : '';
async function removeSelected(){
  const ids=[...selIds]; if(!ids.length) return;
  const label=id=>{ const L=lById(id); return L?(L.sn||(L.drum&&L.drum.name)||L.code||L.name):('item '+id); };
  const ok=await window.Ask.twice([
    { title:'Remove '+ids.length+' item'+(ids.length===1?'':'s')+'?',
      body:'Each one is tried on its own. Anything that has gone out, or whose drum has been cut, is refused and left exactly as it is - the rest still go.',
      no:'Cancel', yes:'Continue' },
    { title:'Remove '+ids.length+' for good?',
      body:'This cannot be undone from here. You will get a list of anything that would not go, and why.',
      no:'No, keep them', yes:'Remove them' }
  ]);
  if(!ok) return;
  const gone=[], kept=[];
  for(const id of ids){
    const what=label(id);
    try{ await DB.whDeleteItem(id); gone.push(what); }
    catch(e){ kept.push({what, why:(e&&e.message)||String(e)}); }
  }
  selIds.clear();
  await reload();
  if(!kept.length){ toast(gone.length+' removed'); return; }
  reportSheet('Removed '+gone.length+' of '+ids.length,
    kept.length+' '+(kept.length===1?'was':'were')+' refused, and nothing about '+(kept.length===1?'it':'them')+' has changed.',
    kept.map(k=>`<div class="rrow"><b>${esc(k.what)}</b><span>${esc(k.why)}</span></div>`).join(''));
}
/* THE SAME BOX, WITH ARBITRARY CONTENT AND ONE ACTION. editSheet draws a
   form from a field list and reportSheet draws a read-only list; the
   return form is neither - it is a small grid whose rows redraw as they
   are typed into. Rather than a third copy of the overlay, this takes the
   html and a save handler. onSave throwing keeps the sheet open and shows
   the message, exactly as the edit sheet does, so a refusal from the
   server is read where it happened. */
function sheet(o){
  const had=!!$('#esh');
  closeSheet();
  const d=document.createElement('div'); d.id='esh'; d.className='esh';
  d.innerHTML=`<div class="ebox wide" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
    <h3>${esc(o.title)}</h3>${o.sub?`<p class="esub">${esc(o.sub)}</p>`:''}
    ${o.html}
    <p class="eerr" id="eerr" hidden></p>
    <div class="erow"><button class="btn sm" id="ecan">Cancel</button><div class="sp"></div>
      <button class="btn pri sm" id="esav">${esc(o.save||'Save')}</button></div></div>`;
  document.body.appendChild(d);
  const say=m=>{ const e=$('#eerr'); e.textContent=m||''; e.hidden=!m; };
  $('#ecan').onclick=closeSheet;
  d.onclick=ev=>{ if(ev.target===d) closeSheet(); };
  ESC_H=ev=>{ if(ev.key==='Escape') closeSheet(); };
  document.addEventListener('keydown',ESC_H);
  $('#esav').onclick=async()=>{
    const b=$('#esav'); b.disabled=true; say('');
    try{ await o.onSave(); closeSheet(); await reload(); }
    catch(e){ say(e.message||String(e)); b.disabled=false; }
  };
  return had;
}

/* The same box as the edit sheet, with a list instead of a form. */
function reportSheet(title,sub,html){
  closeSheet();
  const d=document.createElement('div'); d.id='esh'; d.className='esh';
  d.innerHTML=`<div class="ebox" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h3>${esc(title)}</h3><p class="esub">${esc(sub)}</p><div class="rlist">${html}</div>
    <div class="erow"><div class="sp"></div><button class="btn pri sm" id="ecan">Close</button></div></div>`;
  document.body.appendChild(d);
  $('#ecan').onclick=closeSheet;
  d.onclick=ev=>{ if(ev.target===d) closeSheet(); };
  ESC_H=ev=>{ if(ev.key==='Escape') closeSheet(); };
  document.addEventListener('keydown',ESC_H);
}

/* ---- deleting ------------------------------------------------------

   A note is not a record of itself, it is the reason the stock moved, so
   deleting one UNDOES it: everything it sent comes back, every drum cut
   is given back, and anything that only existed because of the note goes
   with it. The server does all of that and the delete in one transaction
   - half an undo would be worse than none - and refuses by name when it
   cannot, so the reason is on screen rather than in a log.

   The note NUMBER is not given back. OBN-26-1117 is spent whether or not
   the note survives, the same as a spoiled page in the paper book. Two
   notes with one number is the thing worth avoiding; a gap is not. */
async function delNote(id){
  const t=(tickets||[]).find(x=>x.id===id);
  const n=t?t.items.length:0;
  const back=t&&t.kind==='OBN'
    ? 'Everything on it comes back into stock, and any drum cut is given back.'
    : 'The items it booked in are removed. If any of them has already gone out, nothing is deleted and it will say which.';
  const ok=await window.Ask.twice([
    { title:'Delete '+id+'?', body:back, no:'Cancel', yes:'Continue' },
    { title:'Delete '+id+' for good?',
      body:(n?n+(n===1?' line goes':' lines go')+' with it. ':'')+'The note number is not re-used.',
      no:'No, keep it', yes:'Delete it' }
  ]);
  if(!ok) return;
  try{
    const r=await DB.whDeleteNote(id);
    const bits=[];
    if(r&&r.restored) bits.push(r.restored+' back in stock');
    if(r&&r.drums) bits.push(r.drums+' drum'+(r.drums===1?'':'s')+' restored');
    if(r&&r.removed) bits.push(r.removed+' removed');
    toast(id+' deleted'+(bits.length?' · '+bits.join(' · '):''));
    await reload();
  }catch(e){ toast(e.message||String(e)); }
}

/* One thing on its own - a row typed twice, a dummy that should not be
   there. The server refuses anything that has moved, and says where it
   went, because the right answer then is to delete that note instead. */
async function delItem(id,label){
  const ok=await window.Ask.twice([
    { title:'Delete '+(label||'this item')+'?', body:'It leaves the warehouse list. If it has already gone out, nothing is deleted and it will say where it went.', no:'Cancel', yes:'Continue' },
    { title:'Delete '+(label||'this item')+' for good?', body:'This cannot be undone from here.', no:'No, keep it', yes:'Delete it' }
  ]);
  if(!ok) return;
  try{ await DB.whDeleteItem(id); toast('Deleted'); await reload(); }
  catch(e){ toast(e.message||String(e)); }
}

/* ---- one line off a note ------------------------------------------

   Deleting the whole note is the wrong size of tool when one row of five
   is wrong. This takes that row off and undoes exactly that row: the item
   comes back into stock, or its drum cut is given back, or - if it only
   ever existed as part of this note - it goes with the line.

   The last line is refused by the server: a note with no lines is not a
   note, it is a number with a date on it, and deleting the note is what
   that actually means. */
function rowDel(t,itemId,label){
  const lid=LID.get(t.id+'|'+itemId);
  if(!lid||!OWNER()) return '';
  return `<button class="rdel" title="Take this line off ${esc(t.id)}" onclick="delLine('${esc(t.id)}',${lid},'${esc(String(label)).replace(/'/g,"&#39;")}')">✕</button>`;
}
async function delLine(noteId,lineId,label){
  const ok=await window.Ask.twice([
    { title:'Take '+label+' off '+noteId+'?',
      body:'Only this line. Whatever it moved is put back - into stock, or onto its drum - and the rest of the note is untouched.',
      no:'Cancel', yes:'Continue' },
    { title:'Remove '+label+'?', body:'The other lines stay. This cannot be undone from here.',
      no:'No, keep it', yes:'Remove it' }
  ]);
  if(!ok) return;
  try{ const r=await DB.whDeleteLine(lineId); toast((r&&r.what?r.what:label)+' removed from '+noteId); await reload(); }
  catch(e){ toast(e.message||String(e)); }
}
