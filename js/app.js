/* Jersey AED Map – Community Prototype
   Option 2: Airtable + Leaflet + GitHub Pages
   - Theme switching: civic <-> government (visual only)
   - Find nearest functional AED to user
*/

const CONFIG = {
  // ---- Airtable ----
  // Recommended: use a READ-ONLY public proxy in future (serverless) to avoid exposing keys.
  // For prototype: you can use a restricted token + read-only base, but know it is visible in source.
  AIRTABLE_API_KEY: "REPLACE_ME",
  AIRTABLE_BASE_ID: "REPLACE_ME",
  AIRTABLE_TABLE_NAME: "AED Locations",

  // Optional: your report/update form URL (Google Form / Airtable form)
  REPORT_UPDATE_URL: "REPLACE_ME",

  // Jersey default view
  JERSEY_CENTER: [49.2144, -2.1313],
  JERSEY_ZOOM: 12
};

let map;
let markersLayer;
let userMarker = null;

let allAEDs = [];      // raw
let visibleAEDs = [];  // filtered
let lastUserLocation = null;

function $(id){ return document.getElementById(id); }

function setTheme(themeName){
  document.body.classList.remove("theme-civic","theme-government");
  document.body.classList.add(themeName);
  localStorage.setItem("aed-theme", themeName);

  // Swap theme stylesheet to keep CSS clean (optional but tidy)
  const themeEl = document.getElementById("themeStylesheet");
  themeEl.href = themeName === "theme-government" ? "./css/theme-government.css" : "./css/theme-civic.css";
}

function loadTheme(){
  const saved = localStorage.getItem("aed-theme");
  if(saved === "theme-government" || saved === "theme-civic") setTheme(saved);
}

function initMap(){
  map = L.map("map", { zoomControl: true }).setView(CONFIG.JERSEY_CENTER, CONFIG.JERSEY_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

function buildGoogleNavLink(lat, lng){
  // Opens directions in Google Maps
  const dest = `${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

function formatDistance(km){
  if(km == null || Number.isNaN(km)) return "";
  if(km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
}

// Haversine
function distanceKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function statusToClass(status){
  // Used for badge class names; keep spaces for CSS escaping in theme files
  return `status-${status || "Unknown"}`;
}

function renderMarkers(items){
  markersLayer.clearLayers();

  items.forEach(aed => {
    if(typeof aed.lat !== "number" || typeof aed.lng !== "number") return;

    const popupHtml = `
      <div style="min-width:220px">
        <strong>${escapeHtml(aed.name || "Defibrillator")}</strong><br/>
        <span>${escapeHtml(aed.address || "")}</span><br/>
        <span style="opacity:.85">${escapeHtml(aed.parish || "")}</span><br/>
        <div style="margin-top:6px">
          <span><strong>Status:</strong> ${escapeHtml(aed.status || "Unknown")}</span>
        </div>
        ${aed.access ? `<div style="margin-top:6px"><strong>Access:</strong> ${escapeHtml(aed.access)}</div>` : ""}
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <a href="${buildGoogleNavLink(aed.lat, aed.lng)}" target="_blank" rel="noopener" style="text-decoration:none;">
            Navigate
          </a>
        </div>
      </div>
    `;

    // Marker styling can be enhanced later (custom icons)
    const marker = L.marker([aed.lat, aed.lng]).bindPopup(popupHtml);

    marker.on("click", () => {
      // On marker click, scroll the panel card into view if present
      const card = document.querySelector(`[data-aed-id="${aed.id}"]`);
      if(card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    markersLayer.addLayer(marker);
  });
}

function renderResults(items){
  const list = $("resultsList");
  list.innerHTML = "";

  const meta = $("panelMeta");
  meta.textContent = `${items.length} shown`;

  if(items.length === 0){
    list.innerHTML = `<div class="panel-note">No defibrillators match the current filters.</div>`;
    return;
  }

  const nearestId = items[0]?.__nearestCandidate ? items[0].id : null;

  items.forEach((aed, idx) => {
    const isNearest = (nearestId && aed.id === nearestId);
    const distText = aed.distanceKm != null ? formatDistance(aed.distanceKm) : "";

    const status = aed.status || "Unknown";
    const badgeClass = statusToClass(status);

    const verifiedText = aed.lastVerified ? `Last verified: ${aed.lastVerified}` : "";

    const card = document.createElement("div");
    card.className = `card ${isNearest ? "nearest" : ""}`;
    card.setAttribute("data-aed-id", aed.id);

    card.innerHTML = `
      <h3>${isNearest ? `Nearest (${distText})` : `${distText ? distText + " – " : ""}${escapeHtml(aed.name || "Defibrillator")}`}</h3>
      <div class="meta-row">
        <span class="badge ${badgeClass}">${escapeHtml(status)}</span>
        ${aed.parish ? `<span class="badge">${escapeHtml(aed.parish)}</span>` : ""}
        ${aed.publicAccess === true ? `<span class="badge">Public access</span>` : ""}
      </div>

      ${aed.address ? `<div class="small">${escapeHtml(aed.address)}</div>` : ""}

      ${aed.access ? `<div class="small"><strong>Access:</strong> ${escapeHtml(aed.access)}</div>` : ""}

      ${verifiedText ? `<div class="small">${escapeHtml(verifiedText)}</div>` : ""}

      <div class="card-actions" style="margin-top:10px;">
        <a class="btn btn-primary" href="${buildGoogleNavLink(aed.lat, aed.lng)}" target="_blank" rel="noopener">Navigate</a>
        <a class="btn btn-secondary" href="tel:999">Call 999</a>
        <button class="btn btn-secondary" type="button" data-zoom="${aed.lat},${aed.lng}">Zoom</button>
      </div>
    `;

    card.querySelector('button[data-zoom]')?.addEventListener("click", (e) => {
      const [lat, lng] = e.currentTarget.getAttribute("data-zoom").split(",").map(Number);
      map.setView([lat, lng], 16, { animate: true });
    });

    // clicking card zooms and opens popup (best-effort)
    card.addEventListener("click", (e) => {
      // avoid hijacking clicks on buttons/links
      const tag = e.target?.tagName?.toLowerCase();
      if(tag === "a" || tag === "button") return;

      map.setView([aed.lat, aed.lng], 16, { animate: true });
      // Open matching popup (best-effort: Leaflet doesn't give easy mapping without storing marker refs)
    });

    list.appendChild(card);
  });
}

function applyFiltersAndRender(){
  const parish = $("parishFilter").value;
  const status = $("statusFilter").value;

  visibleAEDs = allAEDs.filter(a => {
    if(parish && a.parish !== parish) return false;
    if(status && (a.status || "Unknown") !== status) return false;
    return true;
  });

  // If user location exists, add distance and sort
  if(lastUserLocation){
    const [ulat, ulng] = lastUserLocation;
    visibleAEDs.forEach(a => {
      a.distanceKm = (typeof a.lat === "number" && typeof a.lng === "number")
        ? distanceKm(ulat, ulng, a.lat, a.lng)
        : null;
    });
    visibleAEDs.sort((x,y) => (x.distanceKm ?? 1e9) - (y.distanceKm ?? 1e9));
  } else {
    // no distances: stable sort by name
    visibleAEDs.forEach(a => { a.distanceKm = null; });
    visibleAEDs.sort((x,y) => (x.name || "").localeCompare(y.name || ""));
  }

  renderMarkers(visibleAEDs);
  renderResults(visibleAEDs);
}

function populateParishFilter(){
  const select = $("parishFilter");
  const parishes = Array.from(new Set(allAEDs.map(a => a.parish).filter(Boolean))).sort();
  parishes.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  });
}

async function fetchAirtable(){
  const url = `https://api.airtable.com/v0/${encodeURIComponent(CONFIG.AIRTABLE_BASE_ID)}/${encodeURIComponent(CONFIG.AIRTABLE_TABLE_NAME)}`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${CONFIG.AIRTABLE_API_KEY}`
    }
  });

  if(!res.ok){
    throw new Error(`Airtable request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const records = data.records || [];

  // Map Airtable fields -> our object schema
  allAEDs = records.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      name: f.Name || f.name || "",
      address: f.Address || f.address || "",
      parish: f.Parish || f.parish || "",
      lat: toNumber(f.Latitude ?? f.lat),
      lng: toNumber(f.Longitude ?? f.lng),
      status: f.Status || f.status || "Unknown",
      publicAccess: toBool(f["Public Access"] ?? f.PublicAccess ?? f.public_access),
      access: f["Access Instructions"] || f.Access || f.access_instructions || "",
      lastVerified: normalizeDate(f["Last Verified"] || f.last_verified),
      distanceKm: null,
      __nearestCandidate: false
    };
  });

  $("panelMeta").textContent = `${allAEDs.length} loaded`;

  populateParishFilter();
  applyFiltersAndRender();
}

function toNumber(v){
  if(v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v){
  if(v === true) return true;
  if(v === false) return false;
  if(typeof v === "string") return ["true","yes","1"].includes(v.toLowerCase());
  if(typeof v === "number") return v === 1;
  return false;
}

function normalizeDate(v){
  if(!v) return "";
  // Airtable may return ISO date
  try{
    const d = new Date(v);
    if(Number.isNaN(d.getTime())) return String(v);
    // simple readable format (local)
    return d.toLocaleDateString(undefined, { year:"numeric", month:"short", day:"2-digit" });
  }catch{
    return String(v);
  }
}

function setReportUrl(){
  const a = $("btnReportUpdate");
  if(CONFIG.REPORT_UPDATE_URL && CONFIG.REPORT_UPDATE_URL !== "REPLACE_ME"){
    a.href = CONFIG.REPORT_UPDATE_URL;
  } else {
    a.href = "#";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      alert("Report form URL not set yet. Add CONFIG.REPORT_UPDATE_URL in js/app.js.");
    });
  }
}

function togglePanel(){
  const panel = $("resultsPanel");
  const btn = $("panelToggle");
  const collapsed = panel.classList.toggle("collapsed");
  btn.setAttribute("aria-expanded", String(!collapsed));
}

function ensurePanelOpen(){
  const panel = $("resultsPanel");
  if(panel.classList.contains("collapsed")){
    panel.classList.remove("collapsed");
    $("panelToggle").setAttribute("aria-expanded", "true");
  }
}

function addOrUpdateUserMarker(lat, lng){
  const latlng = [lat, lng];
  if(!userMarker){
    userMarker = L.circleMarker(latlng, { radius: 8 });
    userMarker.addTo(map);
  } else {
    userMarker.setLatLng(latlng);
  }
}

function findNearestFunctional(){
  ensurePanelOpen();

  const note = $("geoNote");
  note.innerHTML = `To find the nearest defibrillator, we need temporary access to your location. This is not stored.`;

  if(!navigator.geolocation){
    alert("Geolocation is not supported in this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      lastUserLocation = [lat, lng];
      addOrUpdateUserMarker(lat, lng);

      // Filter to functional + public for nearest logic, but keep overall list visible per your MVP.
      const functionalPublic = visibleAEDs
        .filter(a => (a.status || "Unknown") === "Active" && a.publicAccess === true && typeof a.lat === "number" && typeof a.lng === "number")
        .map(a => ({ ...a, distanceKm: distanceKm(lat, lng, a.lat, a.lng) }))
        .sort((a,b) => a.distanceKm - b.distanceKm);

      // Mark nearest candidate in the *visibleAEDs* list
      allAEDs.forEach(a => { a.__nearestCandidate = false; });
      if(functionalPublic.length > 0){
        const nearest = functionalPublic[0];
        const match = allAEDs.find(a => a.id === nearest.id);
        if(match) match.__nearestCandidate = true;

        // Zoom to user then to nearest (gentle)
        map.setView([lat, lng], 15, { animate: true });
        setTimeout(() => map.setView([nearest.lat, nearest.lng], 16, { animate: true }), 600);
      } else {
        alert("No active, publicly accessible defibrillators are currently shown with valid coordinates.");
        map.setView([lat, lng], 15, { animate: true });
      }

      // Apply distances + rerender list sorted by distance
      applyFiltersAndRender();
    },
    (err) => {
      if(err.code === err.PERMISSION_DENIED){
        alert("Location permission was denied. You can still browse the map and use filters.");
      } else {
        alert("Could not get your location. Please try again.");
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

// Basic escaping for popup + cards
function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function bindUI(){
  $("panelToggle").addEventListener("click", togglePanel);

  $("parishFilter").addEventListener("change", () => {
    applyFiltersAndRender();
  });

  $("statusFilter").addEventListener("change", () => {
    applyFiltersAndRender();
  });

  $("btnFindNearest").addEventListener("click", findNearestFunctional);

  $("themeToggle").addEventListener("click", () => {
    const isGov = document.body.classList.contains("theme-government");
    setTheme(isGov ? "theme-civic" : "theme-government");
  });
}

function applyThemeFromUrl(){
  const params = new URLSearchParams(location.search);
  const t = params.get("theme");
  if(t === "government") setTheme("theme-government");
  if(t === "civic") setTheme("theme-civic");
}

async function main(){
  loadTheme();
  applyThemeFromUrl();
  initMap();
  bindUI();
  setReportUrl();

  try{
    await fetchAirtable();
  } catch (e){
    console.error(e);
    $("panelMeta").textContent = "Data load failed";
    $("resultsList").innerHTML = `
      <div class="panel-note">
        <strong>Could not load data.</strong><br/>
        Check Airtable config in <code>js/app.js</code> (API key/base/table).<br/>
        ${escapeHtml(e.message)}
      </div>`;
  }
}

main();
