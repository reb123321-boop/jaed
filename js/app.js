/* Jersey Defibrillators Map – Community Prototype
   Stable rebuild (defensive DOM + synced rendering)
*/

const CONFIG = {
  AIRTABLE_API_KEY: "patjiuZllI8qqq7ff.5dc279e7a8273b0dadf608f5bd0e502194fae256882f17f28d6ad423800ee961",
  AIRTABLE_BASE_ID: "appWLevXmVq6r9tmN",
  AIRTABLE_TABLE_NAME: "AED Locations",
  REPORT_UPDATE_URL: "REPLACE_ME",
  JERSEY_CENTER: [49.2144, -2.1313],
  JERSEY_ZOOM: 12
};

const GITHUB_USER = "reb123321-boop";
const GITHUB_REPO = "jaed";
const GITHUB_BRANCH = "main";

let map;
let markersLayer;
let markerRegistry = {};
let userMarker = null;

let allAEDs = [];
let visibleAEDs = [];
let lastUserLocation = null;

const $ = id => document.getElementById(id);

/* ---------------- Theme ---------------- */

function setTheme(theme){
  document.body.classList.remove("theme-civic","theme-government");
  document.body.classList.add(theme);
  localStorage.setItem("aed-theme", theme);

  const css = $("themeStylesheet");
  if(css){
    css.href = theme === "theme-government"
      ? "./css/theme-government.css"
      : "./css/theme-civic.css";
  }
}

function loadTheme(){
  const saved = localStorage.getItem("aed-theme");
  if(saved) setTheme(saved);
}

/* ---------------- Map ---------------- */

function initMap(){
  map = L.map("map").setView(CONFIG.JERSEY_CENTER, CONFIG.JERSEY_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  L.control({ position:"bottomright" }).onAdd = () => {
    const d = document.createElement("div");
    d.className = "map-legend";
    d.innerHTML = `
      <div class="legend-title">Legend</div>
      <div class="legend-item"><span class="legend-dot" style="background:#2e7d32"></span>Active</div>
      <div class="legend-item"><span class="legend-dot" style="background:#888"></span>Out of Service</div>
      <div class="legend-item"><span class="legend-dot" style="background:#0b2e6b"></span>Unknown</div>
      <div class="legend-item">
        <svg width="18" height="24" viewBox="0 0 28 38">
          <path d="M14 1C7 1 2 6 2 13c0 9 12 23 12 23s12-14 12-23C26 6 21 1 14 1z" fill="#c62828"/>
          <circle cx="14" cy="13" r="4" fill="#fff"/>
        </svg>
        Your location
      </div>
      <div class="legend-item"><span class="legend-nearest"></span>Nearest AED</div>
    `;
    return d;
  }.addTo(map);
}

/* ---------------- Utilities ---------------- */

function buildNav(lat,lng){
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function distanceKm(a,b,c,d){
  const R=6371;
  const dLat=(c-a)*Math.PI/180;
  const dLon=(d-b)*Math.PI/180;
  const x=
    Math.sin(dLat/2)**2 +
    Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*
    Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

const esc = s => String(s??"")
  .replaceAll("&","&amp;")
  .replaceAll("<","&lt;")
  .replaceAll(">","&gt;")
  .replaceAll('"',"&quot;")
  .replaceAll("'","&#039;");

/* ---------------- Rendering ---------------- */

function renderMarkers(items){
  markersLayer.clearLayers();
  markerRegistry = {};

  items.forEach(a => {
    if(!Number.isFinite(a.lat)||!Number.isFinite(a.lng)) return;

    const color =
      a.status==="Active" ? "#2e7d32" :
      a.status==="Out of Service" ? "#888" : "#0b2e6b";

    const m = L.circleMarker([a.lat,a.lng],{
      radius:a.__nearestCandidate?12:8,
      fillColor:color,
      color:a.__nearestCandidate?"#b71c1c":"#fff",
      weight:a.__nearestCandidate?3:2,
      fillOpacity:.95
    }).addTo(markersLayer);

    m.bindPopup(`
      ${a.imageUrl?`<img src="${a.imageUrl}" class="popup-image">`:""}
      <strong>${esc(a.name)}</strong><br>
      ${esc(a.address)}<br>
      <strong>Status:</strong> ${esc(a.status)}<br>
      <a href="${buildNav(a.lat,a.lng)}" target="_blank">Navigate</a>
    `);

    markerRegistry[a.id]=m;
  });
}

function renderResults(items){
  const list=$("resultsList");
  if(!list) return;
  list.innerHTML="";

  const count=$("resultsCount");
  if(count) count.textContent=`${items.length} listed`;

  if(!items.length){
    list.innerHTML=`<div class="panel-note">No defibrillators match the filters.</div>`;
    return;
  }

  items.forEach(a=>{
    const c=document.createElement("div");
    c.className=`card ${a.__nearestCandidate?"nearest":""}`;
    c.dataset.aedId=a.id;
    c.innerHTML=`
      <h3>${esc(a.name)}</h3>
      <div class="meta-row">
        <span class="badge status-${esc(a.status)}">${esc(a.status)}</span>
        <span class="meta-parish">${esc(a.parish)}</span>
        <span class="meta-address">${esc(a.address)}</span>
      </div>
      <div class="card-actions">
        <a class="btn btn-primary" href="${buildNav(a.lat,a.lng)}" target="_blank">Navigate</a>
        <a class="btn btn-secondary" href="tel:999">Call 999</a>
      </div>
    `;
    list.appendChild(c);
  });
}

/* ---------------- Filters ---------------- */

function applyFilters(){
  const p=$("parishFilter")?.value||"";
  const s=$("statusFilter")?.value||"";

  visibleAEDs=allAEDs.filter(a=>{
    if(p&&a.parish!==p) return false;
    if(s&&(a.status||"Unknown")!==s) return false;
    return true;
  });

  if(lastUserLocation){
    const [lat,lng]=lastUserLocation;
    visibleAEDs.forEach(a=>{
      a.distanceKm=Number.isFinite(a.lat)?distanceKm(lat,lng,a.lat,a.lng):null;
    });
    visibleAEDs.sort((a,b)=>(a.distanceKm??1e9)-(b.distanceKm??1e9));
  }

  renderMarkers(visibleAEDs);
  renderResults(visibleAEDs);
}

/* ---------------- Airtable ---------------- */

async function fetchAirtable(){
  const r=await fetch(
    `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CONFIG.AIRTABLE_TABLE_NAME)}`,
    {headers:{Authorization:`Bearer ${CONFIG.AIRTABLE_API_KEY}`}}
  );
  if(!r.ok) throw new Error("Airtable error");
  const d=await r.json();

  allAEDs=d.records.map(r=>{
    const f=r.fields||{};
    return{
      id:r.id,
      name:f.Name||"",
      address:f.Address||"",
      parish:f.Parish||"",
      lat:Number(f.Latitude),
      lng:Number(f.Longitude),
      status:f.Status||"Unknown",
      publicAccess:!!f["Public Access"],
      imageUrl:Array.isArray(f.Image)?f.Image[0]?.url:null,
      __nearestCandidate:false
    };
  });

  const pf=$("parishFilter");
  if(pf){
    [...new Set(allAEDs.map(a=>a.parish).filter(Boolean))]
      .sort().forEach(p=>{
        const o=document.createElement("option");
        o.value=o.textContent=p;
        pf.appendChild(o);
      });
  }

  applyFilters();
}

/* ---------------- Nearest ---------------- */

function findNearest(){
  if(!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(pos=>{
    const lat=pos.coords.latitude;
    const lng=pos.coords.longitude;
    lastUserLocation=[lat,lng];

    allAEDs.forEach(a=>a.__nearestCandidate=false);

    const active=visibleAEDs
      .filter(a=>a.status==="Active"&&a.publicAccess)
      .map(a=>({...a,distanceKm:distanceKm(lat,lng,a.lat,a.lng)}))
      .sort((a,b)=>a.distanceKm-b.distanceKm);

    if(!active.length) return;

    const nearest=active[0];
    const match=allAEDs.find(a=>a.id===nearest.id);
    if(match) match.__nearestCandidate=true;

    map.flyTo([lat,lng],15,{duration:1});
    setTimeout(()=>{
      map.flyTo([nearest.lat,nearest.lng],16,{duration:1.2});
      setTimeout(()=>{
        markerRegistry[nearest.id]?.openPopup();
      },1200);
    },1000);

    applyFilters();
  });
}

/* ---------------- Released date ---------------- */

async function setReleased(){
  const el=$("updatedMeta");
  if(!el) return;
  try{
    const r=await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`);
    const d=await r.json();
    const t=new Date(d.commit.committer.date);
    el.textContent=`Released ${t.toISOString().slice(0,16).replace("T"," ")}`;
  }catch{
    el.textContent="Released (unavailable)";
  }
}

/* ---------------- Init ---------------- */

async function main(){
  loadTheme();
  initMap();

  $("btnFindNearest")?.addEventListener("click",findNearest);
  $("parishFilter")?.addEventListener("change",applyFilters);
  $("statusFilter")?.addEventListener("change",applyFilters);

  await setReleased();
  await fetchAirtable();
}

main();
