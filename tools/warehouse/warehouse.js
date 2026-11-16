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
let PROJECTS=[], PARTIES=[], SITES={};
const pad=(n,w=2)=>String(n).padStart(w,'0');
let lines=[], tickets=[], pins=new Set(), mins={}, newMats=new Map(), proj='';
const condChip=c=>c&&c!=='Good'?`<span class="st ${c==='Faulty'?'short':'out'}" style="margin-left:6px">${c.toUpperCase()}</span>`:'';
const isDummy=sn=>/^DMY-/.test(sn||'');
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
async function wDummy(row,redraw){ try{ row.sn=await DB.whNext('DMY'); redraw(); }catch(e){ toast(e.message); } }

function fromDB(d){
  lines=d.items.map(r=>({id:r.id,code:r.code||'',name:r.name,cat:r.cat||'Other',uom:r.uom||'EA',qty:+r.qty,sn:r.sn||'',loc:r.bin||'',project:r.project||'',
    status:r.status,source:r.source==='direct'?'pending':r.source,pending:r.source==='direct',cond:r.cond||'',
    inTicket:r.in_note||'',inDate:r.in_date||'',fromSite:r.from_site||'',fromSiteName:r.from_site_name||'',res:r.reservation_no||'',
    outTicket:r.out_note||'',outDate:r.out_date||'',site:r.site_id||'',siteName:r.site_name||'',party:r.party||'',isNew:!!r.is_new,
    drum:r.drum_name?{name:r.drum_name,lower:+r.drum_lower,upper:+r.drum_upper,cur:+r.drum_cur,cuts:[]}:null,
    read:r.read_start!=null?{start:+r.read_start,end:+r.read_end}:null}));
  const byId=new Map(lines.map(L=>[L.id,L])), K={GRN:'IN',SRN:'RT',OBN:'DN'};
  tickets=d.notes.map(n=>({id:n.id,type:K[n.kind],date:n.note_date,project:n.project||'',res:n.reservation_no||'',ref:n.ref||'',site:n.site_id||'',siteName:n.site_name||'',
    removed:n.removed_on||'',dest:n.dest||'site',party:n.party||'',purpose:n.purpose||'',partyRef:n.party_ref||'',by:n.by_name||'',requestedBy:n.requested_by||'',
    receiver:n.receiver||'',vehicle:n.vehicle||'',driver:n.driver||'',contact:n.contact||'',issuedBy:n.issued_by||'',items:[]}));
  const tb=new Map(tickets.map(t=>[t.id,t]));
  d.lines.slice().sort((a,b)=>a.line_no-b.line_no).forEach(x=>{ const t=tb.get(x.note_id), L=byId.get(x.item_id); if(!t||!L) return;
    if(t.type!=='DN'){ t.items.push(L.id); return; }
    const cut=x.cut_from!=null?{from:+x.cut_from,to:+x.cut_to}:null;
    t.items.push({lineId:L.id,qty:+x.qty,cut,remarks:x.remarks||''});
    if(L.drum&&cut) L.drum.cuts.push({ticket:t.id,date:t.date,site:t.site||t.party,from:cut.from,to:cut.to,len:+x.qty}); });
  pins=new Set(d.materials.filter(m=>m.pinned).map(m=>m.code));
  mins={}; d.materials.forEach(m=>{ if(+m.min_qty>0) mins[m.code]=+m.min_qty; });
  PARTIES=d.parties.map(p=>p.name); PROJECTS=d.projects.map(p=>p.name);
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
/* "+ New project…" in any project list adds one, for everybody. */
document.addEventListener('change',async e=>{
  const el=e.target; if(el.tagName!=='SELECT'||el.value!==NEWPJ) return;
  const name=(prompt('New project name')||'').trim();
  if(!name){ el.selectedIndex=0; el.dispatchEvent(new Event('change')); return; }
  try{ await DB.whAddProject(name); if(!PROJECTS.includes(name)) PROJECTS.push(name); PROJECTS.sort();
    const o=document.createElement('option'); o.textContent=name; el.insertBefore(o,el.lastElementChild); el.value=name; el.dispatchEvent(new Event('change')); fillSelects(); }
  catch(err){ toast(err.message); el.selectedIndex=0; }
});

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
function ticketTitle(t){ return t.type==='DN'?destTitle(t):t.type==='RT'?`Returned from ${t.site} · ${esc(t.siteName)}`:`New stock · ${esc(t.ref||'')}`; }
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
    if(fPin==='1') rows=rows.filter(L=>pins.has(L.code)); if(fPin==='s') rows=rows.filter(L=>(S.get(L.code)||{}).state==='short'); if(fPin==='d') rows=rows.filter(L=>isDummy(L.sn));
    rows.sort((a,b)=>(b.outDate||b.inDate).localeCompare(a.outDate||a.inDate));
    $('#tbl').innerHTML=`<thead><tr><th style="width:44px">Pin</th><th>Material code</th><th>Material name</th><th>Category</th><th>Site ID / party</th><th>Site name</th><th>Project</th><th>UoM</th><th style="text-align:right">Qty</th><th>SN / drum</th><th>Inbound date</th><th>Inbound ref</th><th>Reservation no</th><th>Current location</th><th>Outbound date</th><th>Outbound ref</th><th>Status</th></tr></thead><tbody>${
      rows.map(L=>{ const site=L.status==='out'?(L.party||L.site):L.fromSite, sname=L.status==='out'?L.siteName:L.fromSiteName;
        const where=L.status==='out'?(L.party?`<span class="loc-tp">3P · ${esc(L.party)}</span>`:`<span class="loc-site">Site ${L.site}</span>`):esc(L.loc);
        const st=L.drum?`<span class="st wh">ON DRUM</span>`:L.pending?'<span class="st low">DIRECT ISSUE · NOT RECEIVED</span>':L.party?'<span class="st tp">WITH 3RD PARTY</span>'+condChip(L.cond):L.status==='out'?'<span class="st out">ISSUED TO SITE</span>':L.source==='return'?'<span class="st rt">RETURNED · IN STOCK</span>'+condChip(L.cond):'<span class="st wh">IN STOCK</span>';
        const sn=L.drum?`<span class="drumtag">${esc(L.drum.name)}</span> <span style="color:var(--dim)">${L.drum.lower}–${L.drum.cur}</span>`:L.read?`<span style="color:#ffd9a8">reading ${L.read.start}–${L.read.end}</span>`:(editSn===L.id?`<input class="in mono" style="padding:4px 8px;width:190px" placeholder="real SN" onkeydown="if(event.key==='Enter')setSN(${L.id},this.value)" onblur="setSN(${L.id},this.value)" autofocus>`:snHtml(L.sn)+(isDummy(L.sn)?`<button class="fixsn" onclick="editSn=${L.id};renderInv(${L.id})">set real SN</button>`:''));
        const out=L.drum?(L.drum.cuts.length?L.drum.cuts.map(c=>tkChip(c.ticket)).join(' '):'—'):tkChip(L.outTicket);
        return `<tr class="${L.id===hiId?'hl':''}"><td>${pinBtn(L.code)}</td><td class="code">${L.code}${L.isNew?'<span class="newtag">NEW</span>':''}</td><td class="name" title="${esc(L.name)}">${esc(L.name)}</td><td><span class="chip">${esc(L.cat)}</span></td><td class="code" style="color:${L.party?'var(--tp)':L.status==='out'?'var(--site)':'var(--ink)'}">${site||'<span style="color:var(--dim)">—</span>'}</td><td>${esc(sname)||'<span style="color:var(--dim)">—</span>'}</td><td><span class="chip pj">${esc(L.project)}</span></td><td>${L.uom}</td><td class="num">${fmt(L.qty)}</td><td class="sn">${sn}</td><td class="dt">${L.inDate}</td><td>${tkChip(L.inTicket)}</td><td class="rsv">${L.res||'<span style="color:var(--dim)">—</span>'}</td><td class="dt">${where}</td><td class="dt">${L.outDate||(L.drum&&L.drum.cuts.length?'cuts →':'—')}</td><td>${out}</td><td>${st}</td></tr>`}).join('')}</tbody>`;
  }
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
  $('#rPane').innerHTML=`<div class="h"><span class="tk ${tkCls(t.id)}" style="font-size:14px">${t.id}</span><h3>${t.type==='RT'?'Inbound · site return (SRN)':'Inbound · new stock (GRN)'}</h3><div class="sp"></div><button class="btn sm">Print note</button></div>
  <div class="pbody">
    ${t.type==='RT'?`<div class="box rt"><h4>Site return details</h4><div class="fh five">${kv('Site ID',`<span class="mono">${t.site}</span>`)}${kv('Site name',esc(t.siteName))}${kv('Removed on',t.removed?dshort(t.removed):'<span style="color:var(--dim)">not known</span>')}${kv('Inbound date',dshort(t.date))}${kv('Returned by',esc(t.by))}</div><div class="fh">${kv('Return note',esc(t.ref))}${kv('Project',esc(t.project))}</div></div>`
    :`<div class="box"><h4>Delivery</h4><div class="fh">${kv('Inbound date',dshort(t.date))}${kv('Project',esc(t.project))}${kv('Reservation no',`<span class="mono">${esc(t.res)}</span>`)}${kv('Received by',esc(t.by))}</div><div class="fh">${kv('Supplier DN / PO',esc(t.ref))}</div></div>`}
    <div class="rows"><table><thead><tr><th style="width:36px">#</th><th style="width:120px">Code</th><th>Material name</th><th style="width:100px">Category</th><th style="width:60px">UoM</th><th style="width:70px;text-align:right">Qty</th><th style="width:220px">SN / drum / reading</th>${t.type==='RT'?'<th style="width:100px">Condition</th>':''}<th style="width:240px">Current location</th></tr></thead><tbody>
    ${items.map((L,i)=>{const w=whereOf(L);return `<tr><td class="dt">${i+1}</td><td class="code">${L.code}</td><td class="name">${esc(L.name)}</td><td><span class="chip">${esc(L.cat)}</span></td><td>${L.uom}</td><td class="num">${fmt(L.drum?L.drum.upper-L.drum.lower:L.qty)}</td><td class="sn">${L.drum?`<span class="drumtag">${esc(L.drum.name)}</span> ${L.drum.lower}–${L.drum.upper} m`:L.read?`<span style="color:#ffd9a8">reading ${L.read.start}–${L.read.end}</span>`:snHtml(L.sn)}</td>${t.type==='RT'?`<td>${L.cond&&L.cond!=='Good'?condChip(L.cond):'<span class="st ok">GOOD</span>'}</td>`:''}<td class="dt"><span style="color:${w.cls==='st'?'var(--site)':'var(--ok)'}">${esc(w.top)}</span></td></tr>`}).join('')}
    </tbody></table></div>
  </div>`;
}
let nIn=null;
function newInbound(){ rSel=null; renderRList(); nIn={type:'IN',rows:[{},{},{}]}; drawInbound(); }
function drawInbound(){
  const R=nIn.type==='RT', today=window.today();
  $('#rPane').innerHTML=`<div class="h"><h3>New inbound</h3><span class="k">gets its ticket no when saved</span><div class="sp"></div>
    <div class="seg"><button class="${!R?'on':''}" onclick="nIn.type='IN';keepHead();drawInbound()">New stock</button><button class="${R?'on':''}" onclick="nIn.type='RT';keepHead();drawInbound()">Return from site</button></div></div>
  <div class="pbody">
    ${R?`<div class="box rt"><h4>Site return details</h4><div class="fh five">
      <div class="f"><label>Site ID</label><input class="in mono" id="nSite" placeholder="e.g. ZZ0042" value="${esc(nIn.site||'')}" oninput="const n=siteLookup(this.value);if(n)$('#nSiteN').value=n"></div>
      <div class="f"><label>Site name</label><input class="in" id="nSiteN" placeholder="fills from Site Access" value="${esc(nIn.siteName||'')}"></div>
      <div class="f"><label>Removed on · optional</label><input class="in mono" type="date" id="nRem" value="${nIn.removed||''}"><small>leave empty if not known</small></div>
      <div class="f"><label>Inbound date</label><input class="in mono" type="date" id="nDate" value="${nIn.date||today}"><small>the day it reached the warehouse</small></div>
      <div class="f"><label>Returned by</label><input class="in" id="nBy" placeholder="team / rigger" value="${esc(nIn.by||'')}"></div>
    </div><div class="fh"><div class="f"><label>Return note no</label><input class="in mono" id="nRef" placeholder="paper note no" value="${esc(nIn.ref||'')}"></div><div class="f"><label>Project</label><select class="in" id="nPj">${PROJECTS.map(p=>`<option>${esc(p)}</option>`).join('')}<option>${NEWPJ}</option></select></div><div class="f"><label>Default bin</label><input class="in mono" id="nLoc" value="RB-01"></div></div></div>`
    :`<div class="box"><h4>Delivery</h4><div class="fh">
      <div class="f"><label>Inbound date</label><input class="in mono" type="date" id="nDate" value="${nIn.date||today}"></div>
      <div class="f"><label>Project</label><select class="in" id="nPj">${PROJECTS.map(p=>`<option>${esc(p)}</option>`).join('')}<option>${NEWPJ}</option></select></div>
      <div class="f"><label>Reservation no</label><input class="in mono" id="nRes" placeholder="e.g. 4900000123" value="${esc(nIn.res||'')}"></div>
      <div class="f"><label>Received by</label><input class="in" id="nBy" value="${esc(nIn.by||ME())}"></div>
    </div><div class="fh"><div class="f"><label>Supplier DN / PO</label><input class="in mono" id="nRef" placeholder="e.g. Huawei DN 89501" value="${esc(nIn.ref||'')}"></div><div class="f"><label>Default bin</label><input class="in mono" id="nLoc" value="A-01-01"><small>each row can change it</small></div></div></div>`}
    <div class="rows"><table><thead><tr><th style="width:36px">#</th><th style="width:210px">Material code</th><th>Material name</th><th style="width:130px">Category</th><th style="width:84px">UoM</th><th style="width:84px">Qty</th><th style="width:210px">SN</th>${R?'<th style="width:120px">Condition</th>':''}<th style="width:130px">Bin</th><th style="width:40px"></th></tr></thead><tbody id="nBody"></tbody></table></div>
    <button class="btn sm" style="margin-top:10px" onclick="nIn.rows.push({});drawRows()">+ Add row</button>
  </div>
  <div class="ff"><div class="msg" id="nMsg">Type a code or part of a name. Codes in Material Codes fill in by themselves. Cable on a drum → <b style="color:#ffd9a8">Drum</b>${R?'; a loose cable piece → <b style="color:#ffd9a8">Cable</b> and write its two readings':''}.</div><button class="btn" onclick="newInbound()">Clear</button><button class="btn pri" onclick="saveInbound()">Save inbound</button></div>`;
  drawRows();
}
function keepHead(){ ['nSite:site','nSiteN:siteName','nRem:removed','nDate:date','nBy:by','nRef:ref','nRes:res'].forEach(p=>{const [i,k]=p.split(':');const e=$('#'+i);if(e)nIn[k]=e.value}); }
function drawRows(){
  $('#nBody').innerHTML=nIn.rows.map((r,i)=>{
    const st=!r.code?'':r.known?'<span class="mstate ok">✓ in Material Codes</span>':'<span class="mstate nw">● new code → New materials</span>';
    const d=r.drum, RT=nIn.type==='RT', c=r.cable, ncol=RT?10:9;
    const cl=c&&r.ra!==''&&r.rb!==''&&r.ra!=null&&r.rb!=null?Math.abs(+r.rb-+r.ra):'';
    return `<tr><td class="dt">${i+1}</td>
    <td class="cell"><input class="in mono" value="${esc(r.q??r.code??'')}" placeholder="code or name" oninput="acType(${i},this)" onblur="setTimeout(()=>closeAc(${i},this),180)">${st}
      <button class="dbtn ${d?'on':''}" onclick="toggleDrum(${i})">${d?'● Drum':'+ Drum'}</button>${RT?` <button class="dbtn ${c?'on':''}" onclick="toggleRCable(${i})">${c?'● Cable':'+ Cable'}</button>`:''}<div class="ac" id="ac${i}" hidden></div></td>
    <td><input class="in" value="${esc(r.name||'')}" placeholder="${r.code&&!r.known?'type the material name':'fills from Material Codes'}" ${r.known?'readonly':''} oninput="nIn.rows[${i}].name=this.value"></td>
    <td>${r.known?`<input class="in" readonly value="${esc(r.cat)}">`:`<select class="in" onchange="nIn.rows[${i}].cat=this.value"><option value="">pick…</option>${CATS.map(c=>`<option ${r.cat===c?'selected':''}>${c}</option>`).join('')}</select>`}</td>
    <td><select class="in" onchange="nIn.rows[${i}].uom=this.value">${['EA','M','SET','ROLL','BOX'].map(u=>`<option ${(r.uom||'EA')===u?'selected':''}>${u}</option>`).join('')}</select></td>
    <td><input class="in mono" id="iq${i}" style="text-align:right" value="${d?Math.max(0,(d.upper||0)-(d.lower||0)):c?cl:(r.qty||1)}" ${d||c?'readonly':''} placeholder="${c?'readings':''}" oninput="nIn.rows[${i}].qty=+this.value"></td>
    <td><input class="in mono" value="${esc(r.sn||'')}" placeholder="${d?'drum has no SN':c?'cable has no SN':'scan or type'}" ${d||c?'readonly':''} oninput="nIn.rows[${i}].sn=this.value" style="${isDummy(r.sn)?'color:#F2B05E':''}">${d||c?'':`<button class="nosn" onclick="wDummy(nIn.rows[${i}],drawRows)">${isDummy(r.sn)?'● dummy SN':'SN unreadable → dummy'}</button>`}</td>
    ${RT?`<td><select class="in" onchange="nIn.rows[${i}].cond=this.value" style="${r.cond&&r.cond!=='Good'?'color:'+(r.cond==='Faulty'?'var(--bad)':'var(--site)'):''}">${CONDS.map(x=>`<option ${(r.cond||'Good')===x?'selected':''}>${x}</option>`).join('')}</select></td>`:''}
    <td><input class="in mono" value="${esc(r.loc||'')}" placeholder="default" oninput="nIn.rows[${i}].loc=this.value"></td>
    <td><button class="btn sm" style="padding:6px 9px" onclick="nIn.rows.splice(${i},1);drawRows()">✕</button></td></tr>
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
function toggleDrum(i){ const r=nIn.rows[i]; if(r.drum) delete r.drum; else { delete r.cable; r.drum={name:'',lower:'',upper:''}; r.uom='M'; r.loc=r.loc||'DY-01'; } drawRows(); }
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
  if(ok.find(r=>!r.known&&(!r.name||!r.cat))){msg.innerHTML='<b style="color:var(--new)">A new code needs its name and category first.</b>';return}
  if(ok.find(r=>r.drum&&(!r.drum.name||!(+r.drum.upper>+r.drum.lower)))){msg.innerHTML='<b style="color:var(--warn)">Each drum needs a name, and the upper reading must be above the lower.</b>';return}
  if(ok.find(r=>r.cable&&(r.ra==null||r.rb==null||r.ra===''||r.rb===''))){msg.innerHTML='<b style="color:var(--warn)">A returned cable piece needs its start and end readings.</b>';return}
  if(nIn.type==='RT'&&!nIn.site){msg.innerHTML='<b style="color:var(--new)">A site return needs the site ID it came from.</b>';return}
  const pj=$('#nPj').value; if(!pj||pj===NEWPJ){msg.innerHTML='<b style="color:var(--warn)">Pick the project.</b>';return}
  const p={kind:nIn.type==='RT'?'SRN':'GRN',date:nIn.date||today(),project:pj,reservation_no:nIn.type==='RT'?'':(nIn.res||''),ref:nIn.ref||'',
    site_id:nIn.site||'',site_name:nIn.siteName||'',removed_on:nIn.removed||'',by:nIn.by||ME(),bin:$('#nLoc').value,
    items:ok.map(r=>({code:r.code||'',name:r.name,cat:r.cat||'Other',uom:(r.drum||r.cable)?'M':(r.uom||'EA'),qty:+(r.qty||1),sn:r.sn||'',bin:r.loc||'',
      cond:nIn.type==='RT'?(r.cond||'Good'):null,is_new:!!(r.code&&!r.known),
      drum_name:r.drum?r.drum.name.trim():null,drum_lower:r.drum?+r.drum.lower:null,drum_upper:r.drum?+r.drum.upper:null,
      read_start:r.cable?+r.ra:null,read_end:r.cable?+r.rb:null}))};
  const btn=event&&event.target; if(btn) btn.disabled=true;
  try{ const id=await DB.whInbound(p); rSel=id; toast(`${id} saved · ${ok.length} item${ok.length===1?'':'s'} in stock`); await reload(); nIn=null; if(tById(id)) showInbound(tById(id)); }
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
  $('#iPane').innerHTML=`<div class="h"><span class="tk dn" style="font-size:14px">${t.id}</span><h3>${destTitle(t)}</h3><div class="sp"></div><button class="btn sm" onclick="printNote('${t.id}')">Print / Save PDF</button></div>
  <div class="pbody">
    <div class="box"><h4>Outbound details</h4><div class="fh five">
      ${[['Date',dshort(t.date)],...(t.dest==='party'?[['3rd party',t.party],['Purpose',t.purpose],['Their ref / PO',t.partyRef]]:[]),['Project',t.project],['Requested by',t.requestedBy],['Issued by',t.issuedBy],['Receiver',t.receiver],['Vehicle no',t.vehicle],['Driver / NIC',t.driver],['Contact no',t.contact],['Items',t.items.length+(t.items.length===1?' line':' lines')]].map(([k,v])=>`<div class="f"><label>${k}</label><div class="in" style="background:rgba(5,10,28,.25)">${esc(v)||'<span style="color:var(--dim)">—</span>'}</div></div>`).join('')}
    </div></div>
    <div class="rows"><table><thead><tr><th style="width:36px">No</th><th style="width:120px">Code</th><th>Items &amp; description</th><th style="width:60px">Unit</th><th style="width:80px;text-align:right">Issued</th><th style="width:110px">Remarks</th><th style="width:200px">Current location</th></tr></thead><tbody>
    ${R.map((r,i)=>{const w=whereOf(r.L);return `<tr><td class="dt">${i+1}</td><td class="code">${r.code}</td><td class="name" style="max-width:none">${esc(r.desc)}</td><td>${r.unit}</td><td class="num">${fmt(r.qty)}</td><td class="dt">${esc(r.remarks)}</td><td class="dt" style="color:${r.L.drum?'#ffd9a8':w.cls==='tp'?'var(--tp)':w.cls==='st'?'var(--site)':'var(--ok)'}">${r.L.drum?'cut from '+esc(r.L.drum.name):esc(w.top)}</td></tr>`}).join('')}
    </tbody></table></div>
  </div>`;
}
let nDn=null;
function newDispatch(){ iSel=null; renderIList(); nDn={dest:'site',party:'',purpose:'Repair',partyRef:'',date:today(),site:'',siteName:'',project:PROJECTS[0]||'',requestedBy:'',receiver:'',vehicle:'',driver:'',contact:'',issuedBy:ME(),rows:[{},{},{}]}; drawDispatch(); }
function drawDispatch(){
  const f=(k,l,ph,cls='')=>`<div class="f"><label>${l}</label><input class="in ${cls}" value="${esc(nDn[k])}" placeholder="${ph}" oninput="nDn['${k}']=this.value${k==='site'?";const n=siteLookup(this.value);if(n){nDn.siteName=n;$('#dSn').value=n}":''}" ${k==='siteName'?'id="dSn"':''}></div>`;
  $('#iPane').innerHTML=`<div class="h"><span class="tk dn" style="font-size:14px">OBN · new</span><h3>New outbound</h3><span class="k">gets its note no when saved</span></div>
  <div class="pbody">
    <div class="box ${nDn.dest==='party'?'tpb':''}"><div style="display:flex;align-items:center;gap:12px;margin-bottom:10px"><h4 style="margin:0">Outbound details</h4><div class="seg"><button class="${nDn.dest!=='party'?'on':''}" onclick="nDn.dest='site';drawDispatch()">To site</button><button class="${nDn.dest==='party'?'on':''}" onclick="nDn.dest='party';drawDispatch()">To 3rd party</button></div></div><div class="fh five">
      <div class="f"><label>Date</label><input class="in mono" type="date" value="${nDn.date}" oninput="nDn.date=this.value"></div>
      ${nDn.dest==='party'?`<div class="f"><label>3rd party company</label><input class="in" list="parties" value="${esc(nDn.party)}" placeholder="Fame, DAR, Browns…" oninput="nDn.party=this.value"><datalist id="parties">${PARTIES.map(x=>`<option>${x}</option>`).join('')}</datalist><small>type a new name to add it</small></div>
      <div class="f"><label>Purpose</label><select class="in" onchange="nDn.purpose=this.value">${PURPOSES.map(x=>`<option ${x===nDn.purpose?'selected':''}>${x}</option>`).join('')}</select></div>`:`${f('site','Site ID','e.g. ZZ0071','mono')}${f('siteName','Site name','fills from Site Access')}`}
      <div class="f"><label>Project</label><select class="in" onchange="nDn.project=this.value">${PROJECTS.map(p=>`<option ${p===nDn.project?'selected':''}>${esc(p)}</option>`).join('')}<option>${NEWPJ}</option></select></div>
      ${f('requestedBy','Requested by','Mr. …')}
      ${f('receiver','Receiver','')}${f('vehicle','Vehicle no','','mono')}${f('driver','Driver name / NIC','')}${f('contact','Contact no','','mono')}${f('issuedBy','Issued by','')}${nDn.dest==='party'?f('partyRef','Their ref / PO','e.g. BR-RMA-2240','mono'):''}
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
    const cab=r.cable;
    return `<tr><td class="dt">${i+1}</td>
    <td class="cell"><input class="in mono" value="${esc(r.q??r.code??'')}" placeholder="code, SN or name" oninput="dAc(${i},this)" onblur="setTimeout(()=>dClose(${i},this),180)">${st}
      ${L?'':`<button class="dbtn ${cab?'on':''}" onclick="toggleCable(${i})">${cab?'● Cable':'+ Cable'}</button>`}<div class="ac" id="dac${i}" hidden></div></td>
    <td><input class="in" value="${esc(r.name||'')}" placeholder="${has?'type the material name':'fills in, or type it'}" ${L||r.known?'readonly':''} oninput="nDn.rows[${i}].name=this.value"></td>
    <td>${L||r.known?`<input class="in" readonly value="${esc(r.cat||'')}">`:`<select class="in" onchange="nDn.rows[${i}].cat=this.value"><option value="">pick…</option>${CATS.map(c=>`<option ${r.cat===c?'selected':''}>${c}</option>`).join('')}</select>`}</td>
    <td><select class="in" ${L?'disabled':''} onchange="nDn.rows[${i}].uom=this.value">${['EA','M','SET','ROLL','BOX','PKT'].map(u=>`<option ${(r.uom||'EA')===u?'selected':''}>${u}</option>`).join('')}</select></td>
    <td><input class="in mono" id="dq${i}" style="text-align:right" value="${cab?(r.qty||''):(r.qty??1)}" ${cab||(L&&!L.drum)?'readonly':''} placeholder="${cab?'from readings':''}" oninput="nDn.rows[${i}].qty=+this.value"></td>
    <td><input class="in mono" value="${esc(r.sn||'')}" ${ro||cab?'readonly':''} placeholder="${cab?'—':'scan or type'}" oninput="nDn.rows[${i}].sn=this.value" style="${isDummy(r.sn)?'color:#F2B05E':''}">${L||cab?'':`<button class="nosn" onclick="wDummy(nDn.rows[${i}],drawDRows)">${isDummy(r.sn)?'● dummy SN':'SN unreadable → dummy'}</button>`}</td>
    <td><input class="in" value="${esc(r.remarks||'')}" oninput="nDn.rows[${i}].remarks=this.value"></td>
    <td><button class="btn sm" style="padding:6px 9px" onclick="nDn.rows.splice(${i},1);drawDRows()">✕</button></td></tr>
    ${cab?cableRow(i,r,L):''}`}).join('');
}
function cableRow(i,r,L){
  if(L&&L.drum){ const d=L.drum;
    return `<tr class="drumrow"><td colspan="9"><div class="drumbox">
      <div><label>Drum</label><input class="in mono" readonly value="${esc(d.name)} · ${fmt(d.cur-d.lower)} m left"></div>
      <div><label>Cut length (m)</label><input class="in mono" style="text-align:right" value="${r.qty||''}" placeholder="how much" oninput="nDn.rows[${i}].qty=+this.value;updCab(${i})"></div>
      <div><label>Handover reading</label><input class="in mono" readonly id="hr${i}" value="${r.qty?d.cur+' → '+(d.cur-r.qty):d.cur+' → …'}"></div>
      <div class="len" id="cl${i}">${cutText(L,r.qty)}</div></div></td></tr>`; }
  return `<tr class="drumrow"><td colspan="9"><div class="drumbox">
      <div><label>Start reading (m)</label><input class="in mono" style="text-align:right" value="${r.ra??''}" placeholder="marking at one end" oninput="nDn.rows[${i}].ra=this.value;updCab(${i})"></div>
      <div><label>End reading (m)</label><input class="in mono" style="text-align:right" value="${r.rb??''}" placeholder="marking at the other" oninput="nDn.rows[${i}].rb=this.value;updCab(${i})"></div>
      <div></div>
      <div class="len" id="cl${i}">${manText(r)}</div></div></td></tr>`;
}
function manText(r){ if(r.ra===''||r.rb===''||r.ra==null||r.rb==null) return 'Write both markings on the cable piece. Qty is worked out from them.'; const n=Math.abs(+r.rb-+r.ra); return `Reading <b>${r.ra} → ${r.rb}</b> = ${fmt(n)} m`; }
function updCab(i){ const r=nDn.rows[i], L=r.lineId?lById(r.lineId):null;
  if(L&&L.drum){ $('#hr'+i).value=r.qty?L.drum.cur+' → '+(L.drum.cur-r.qty):L.drum.cur+' → …'; $('#cl'+i).innerHTML=cutText(L,r.qty); $('#dq'+i).value=r.qty||''; }
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
    sh.map(L=>`<div onmousedown="dPickLine(${i},${L.id})"><code>${L.code}</code><span>${esc(L.name)}${L.drum?' · <b style="color:#ffd9a8">drum '+esc(L.drum.name)+'</b>':''}</span><em>${L.drum?fmt(L.qty)+' m left':esc(L.sn||fmt(L.qty)+' '+L.uom)}</em><span class="loc" style="flex:none">${esc(L.loc)}</span></div>`).join('')+
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
  box.innerHTML=hits.map(L=>`<div onmousedown="addPick(${L.id})"><code>${L.code}</code><span>${esc(L.name)}${L.drum?' · <b style="color:#ffd9a8">drum '+esc(L.drum.name)+'</b>':''}</span><em>${L.drum?fmt(L.qty)+' m left':L.sn||fmt(L.qty)+' '+L.uom}</em><span class="loc" style="flex:none">${esc(L.loc)}</span></div>`).join('')||'<div style="color:var(--dim);cursor:default">Not in stock. Type it in a row below to issue it directly.</div>';
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
    if(L&&L.drum&&(!(+r.qty>0)||+r.qty>L.qty)) return bad(`Give drum ${L.drum.name} a cut length that fits what is left on it.`);
    if(!L&&!r.name) return bad('Every manual row needs a material name.');
    if(!L&&r.cable&&(r.ra==null||r.rb==null||r.ra===''||r.rb==='')) return bad('A cable piece needs its start and end readings.');
    if(!L&&!(+r.qty>0)) return bad('Every manual row needs a quantity.'); }
  const p={date:nDn.date||today(),project:nDn.project,dest:nDn.dest,site_id:nDn.dest==='site'?nDn.site.trim().toUpperCase():'',site_name:nDn.dest==='site'?nDn.siteName:'',
    party:nDn.dest==='party'?nDn.party.trim():'',purpose:nDn.dest==='party'?nDn.purpose:'',party_ref:nDn.dest==='party'?nDn.partyRef:'',
    requested_by:nDn.requestedBy,receiver:nDn.receiver,vehicle:nDn.vehicle,driver:nDn.driver,contact:nDn.contact,issued_by:nDn.issuedBy||ME(),
    items:rows.map(r=>{ const L=r.lineId&&lById(r.lineId);
      if(L) return {item_id:L.id,cut:L.drum?+r.qty:null,remarks:r.remarks||''};
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
function noteHTML(t){
  const R=noteRows(t), pages=[]; for(let i=0;i<Math.max(1,R.length);i+=25) pages.push(R.slice(i,i+25));
  const hw=v=>esc(v||'');
  return pages.map((P,pi)=>`<div class="pn dn-page">
    <div class="dn-head"><div class="dn-mark">TW</div>
      <div><div class="dn-co">Tooway Engineers Private Limited</div>
      <div class="dn-addr"><span>No. 23/D, Katulanda, Dekatana.</span><span>info@tooway.lk</span><span>0703471374</span></div></div>
      <div class="dn-no"><small>NOTE NO</small><b>${t.id}</b></div></div>
    <span class="dn-title">Material Dispatch / Return Note</span>
    <div class="dn-f">
      <div><label>Date:</label><span>${t.date.split('-').reverse().join('/')}</span></div><div><label>Receiver:</label><span>${hw(t.receiver)}</span></div>
      <div><label>Requested By:</label><span>${hw(t.requestedBy)}</span></div><div><label>Vehicle No:</label><span>${hw(t.vehicle)}</span></div>
      <div><label>Site Name &amp; ID:</label><span>${hw(t.dest==='party'?t.party+' (3rd party · '+t.purpose+')':t.site+' '+t.siteName)}</span></div><div><label>Driver Name / NIC:</label><span>${hw(t.driver)}</span></div>
      <div><label>Project:</label><span>${hw(t.project)}</span></div><div><label>Contact No:</label><span>${hw(t.contact)}</span></div>
    </div>
    <table><colgroup><col style="width:9%"><col style="width:44%"><col style="width:9%"><col style="width:9%"><col style="width:10%"><col style="width:19%"></colgroup>
      <thead><tr><th>No</th><th>Items &amp; Description</th><th>Unit</th><th>Issued Qty</th><th>Returned Qty</th><th>Remarks</th></tr></thead>
      <tbody>${Array.from({length:25},(_,i)=>{const r=P[i];const n=pi*25+i+1;return `<tr><td>${n}</td><td class="hw">${r?esc(r.desc):''}</td><td class="hw c">${r?r.unit:''}</td><td class="hw c">${r?pad(r.qty):''}</td><td></td><td class="hw">${r?esc(r.remarks):''}</td></tr>`}).join('')}</tbody></table>
    <div class="dn-sig">
      <div class="g"><b>Issued by</b><div><div>Name:<span>${hw(t.issuedBy)}</span></div><div>Signature &amp; Date:<span></span></div></div></div>
      <div class="g"><b>Received by</b><div><div>Name:<span>${hw(t.receiver)}</span></div><div>Signature &amp; Date:<span></span></div></div></div>
      <div class="g"><b>Returned by</b><div><div>Name:<span></span></div><div>Signature &amp; Date:<span></span></div></div></div>
      <div class="g"><b>Accepted by</b><div><div>Name:<span></span></div><div>Signature &amp; Date:<span></span></div></div></div>
    </div>
    <div class="dn-foot"><span>${t.id} · ${t.items.length} lines · printed from Tooway Warehouse</span><span>Page ${pi+1} of ${pages.length}</span></div>
  </div>`).join('');
}
function printNote(id){ $('#printArea').innerHTML=noteHTML(tById(id)); window.print(); }

/* ================= DRUMS ================= */
function renderDrums(){
  const need=+$('#need').value||0, nm=$('#needMat').value;
  const D=lines.filter(L=>L.drum&&inProj(L));
  $('#nDr').textContent=D.length;
  $('#dGrid').innerHTML=D.sort((a,b)=>a.drum.name.localeCompare(b.drum.name)).map(L=>{
    const d=L.drum, tot=d.upper-d.lower, left=d.cur-d.lower, pl=left/tot*100;
    const match=!nm||L.code===nm; const fits=need&&match&&left>=need;
    const cls=need?(fits?'fit':'nofit'):(left<tot*.2?'lowd':'');
    return `<div class="drum ${cls}">
      <div style="display:flex;align-items:center;gap:10px"><div class="nm">${esc(d.name)}</div><span class="chip">${esc(L.cat)}</span><span class="chip pj">${esc(L.project)}</span><div style="flex:1"></div><span class="dt mono" style="font-size:11.5px;color:var(--soft)">${esc(L.loc)}</span></div>
      <div class="mt"><code>${L.code}</code> · ${esc(L.name)}</div>
      <div class="rd"><div class="left" style="width:${pl}%"></div><div class="used" style="width:${100-pl}%"></div>${fits?`<div class="need" style="left:${(left-need)/tot*100}%;width:${need/tot*100}%"></div>`:''}</div>
      <div class="rdl"><span>lower ${d.lower}</span><span style="color:#bff0d6">now ${d.cur}</span><span>upper ${d.upper}</span></div>
      <div class="dq"><b>${fmt(left)} m</b><span>left of ${fmt(tot)} m · in ${L.inTicket}</span></div>
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
