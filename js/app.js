/* Jersey AED Map – Community Prototype
   Option 2: Airtable + Leaflet + GitHub Pages
   - Theme switching: civic <-> government (visual only)
   - Find nearest functional AED to user
*/

const CONFIG = {
  // ---- Airtable ----
  // Recommended: use a READ-ONLY public proxy in future (serverless) to avoid exposing keys.
  // For prototype: you can use a restricted token + read-only base, but know it is visible in source.
  AIRTABLE_API_KEY: "patjiuZllI8qqq7ff.5dc279e7a8273b0dadf608f5bd0e502194fae256882f17f28d6ad423800ee961",
  AIRTABLE_BASE_ID: "appWLevXmVq6r9tmN",
  AIRTABLE_TABLE_NAME: "AED Locations",

  // Optional: your report/update form URL (Google Form / Airtable form)
  REPORT_UPDATE_URL: "REPLACE_ME",

  // Jersey default view
  JERSEY_CENTER: [49.2144, -2.1313],
  JERSEY_ZOOM: 12
};

const GITHUB_USER = "reb123321-boop";
const GITHUB_REPO = "jaed";
const GITHUB_BRANCH = "main";

let map;
let markersLayer;
let userMarker = null;
let markerRegistry = {};

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

  const isMobile = window.matchMedia("(max-width: 600px)").matches;

  map = L.map("map", { zoomControl: true })
    .setView(
      CONFIG.JERSEY_CENTER,
      isMobile ? CONFIG.JERSEY_ZOOM - 1 : CONFIG.JERSEY_ZOOM
    );

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  // --- Legend Control ---
  const legend = L.control({ position: "bottomright" });

  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "map-legend");

    div.innerHTML = `
      <div class="legend-title">Legend</div>

      <div class="legend-item">
        <span class="legend-dot" style="background:#2e7d32;"></span>
        Active
      </div>

      <div class="legend-item">
        <span class="legend-dot" style="background:#888888;"></span>
        Out of Service
      </div>

      <div class="legend-item">
        <span class="legend-dot" style="background:#0b2e6b;"></span>
        Unknown
      </div>

      <div class="legend-item">
        <span class="legend-pin-svg">
          <svg width="18" height="24" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 1C7 1 2 6 2 13c0 9 12 23 12 23s12-14 12-23C26 6 21 1 14 1z" fill="#c62828"/>
            <circle cx="14" cy="13" r="4" fill="#ffffff"/>
          </svg>
        </span>
        Your location
      </div>

      <div class="legend-item">
        <span class="legend-nearest"></span>
        Nearest AED
      </div>
    `;

    return div;
  };

  legend.addTo(map);
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
  // Used for badge class names; keep spaces for CSS escaping
  return `status-${status || "Unknown"}`;
}

/**
 * Scroll the results panel so `cardEl` aligns to the TOP of the results pane
 * (not the page).
 */
function scrollResultsToCard(cardEl){
  const panelBody = $("panelBody");
  if(!panelBody || !cardEl) return;

  // Compute position relative to the scroll container using rects
  const panelRect = panelBody.getBoundingClientRect();
  const cardRect = cardEl.getBoundingClientRect();
  const offset = (cardRect.top - panelRect.top) + panelBody.scrollTop;

  panelBody.scrollTo({ top: Math.max(0, offset - 10), behavior: "smooth" });
}

// Encode array of URLs safely for HTML attribute use
function encodeUrlsForAttr(urls){
  try{
    return encodeURIComponent(JSON.stringify(urls || []));
  }catch{
    return encodeURIComponent("[]");
  }
}

function decodeUrlsFromAttr(encoded){
  try{
    return JSON.parse(decodeURIComponent(encoded || "[]"));
  }catch{
    return [];
  }
}

function renderMarkers(items){
  markersLayer.clearLayers();
  markerRegistry = {};

  items.forEach(aed => {
    if(typeof aed.lat !== "number" || typeof aed.lng !== "number") return;

    // Support 0..n images (Airtable attachments)
    const imageUrls = Array.isArray(aed.images)
      ? aed.images.map(x => x && x.url).filter(Boolean)
      : [];

    const encodedUrls = encodeUrlsForAttr(imageUrls);

    const popupHtml = `
      <div style="min-width:220px">

        ${imageUrls.length ? `
          <div class="popup-image-wrapper"
               data-images="${encodedUrls}"
               data-index="0"
               style="position:relative; margin-bottom:8px;">

            <button type="button" class="popup-img-prev" aria-label="Previous image"
              style="
                position:absolute;
                left:6px;
                top:50%;
                transform:translateY(-50%);
                background:rgba(0,0,0,0.6);
                color:white;
                border:none;
                padding:4px 8px;
                border-radius:6px;
                cursor:pointer;
                ${imageUrls.length === 1 ? "display:none;" : ""}
              ">◀</button>

            <img src="${imageUrls[0]}"
                 alt="Defibrillator location"
                 class="popup-image"
                 style="width:100%; border-radius:8px; max-height:160px; object-fit:cover; cursor:pointer;">

            <button type="button" class="popup-img-next" aria-label="Next image"
              style="
                position:absolute;
                right:6px;
                top:50%;
                transform:translateY(-50%);
                background:rgba(0,0,0,0.6);
                color:white;
                border:none;
                padding:4px 8px;
                border-radius:6px;
                cursor:pointer;
                ${imageUrls.length === 1 ? "display:none;" : ""}
              ">▶</button>

          </div>
        ` : ""}

        <strong>${escapeHtml(aed.name || "Defibrillator")}</strong><br/>
        <span>${escapeHtml(aed.address || "")}</span><br/>
        <span style="opacity:.85">${escapeHtml(aed.parish || "")}</span><br/>

        <div style="margin-top:6px">
          <strong>Status:</strong> ${escapeHtml(aed.status || "Unknown")}
        </div>

        ${aed.access ? `
          <div style="margin-top:6px">
            <strong>Access:</strong> ${escapeHtml(aed.access)}
          </div>
        ` : ""}

        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <a href="${buildGoogleNavLink(aed.lat, aed.lng)}"
             target="_blank"
             rel="noopener"
             class="btn btn-primary"
             style="text-decoration:none;">
            Navigate
          </a>
        </div>

      </div>
    `;

    // Marker color by status
    let markerColor;
    switch(aed.status){
      case "Active":
        markerColor = "#2e7d32";
        break;
      case "Out of Service":
        markerColor = "#888888";
        break;
      case "Unknown":
      default:
        markerColor = "#0b2e6b"; // navy to match legend/badges
        break;
    }

    const isNearest = aed.__nearestCandidate === true;

    const marker = L.circleMarker([aed.lat, aed.lng], {
      radius: isNearest ? 12 : 8,
      fillColor: markerColor,
      color: isNearest ? "#b71c1c" : "#ffffff",  // red ring for nearest
      weight: isNearest ? 3 : 2,
      opacity: 1,
      fillOpacity: 0.95
    }).bindPopup(popupHtml);

    markerRegistry[aed.id] = marker;

    marker.on("popupopen", () => {
      // IMPORTANT: scope everything to THIS popup element (not document-wide)
      const popupEl = marker.getPopup()?.getElement();
      if(!popupEl) return;

// --- Image overlay open behaviour ---
popupEl.querySelectorAll(".popup-image").forEach(img => {

  if(img.dataset.bound === "1") return;
  img.dataset.bound = "1";

  img.addEventListener("click", (e) => {
    e.stopPropagation();

    const overlay = document.getElementById("imageOverlay");
    const overlayImg = document.getElementById("overlayImage");

    if(!overlay || !overlayImg) return;

    overlayImg.src = img.src;
    overlay.classList.add("active");
  });

});


      // --- Multi-image cycling ---
      const wrapper = popupEl.querySelector(".popup-image-wrapper");
      if(!wrapper) return;

      // Avoid duplicate listeners if popup is reopened
      if(wrapper.dataset.bound === "1") return;
      wrapper.dataset.bound = "1";

      const urls = decodeUrlsFromAttr(wrapper.getAttribute("data-images"));
      if(!Array.isArray(urls) || urls.length <= 1) return;

      const prev = wrapper.querySelector(".popup-img-prev");
      const next = wrapper.querySelector(".popup-img-next");
      const imageEl = wrapper.querySelector(".popup-image");

      let index = 0;

      const setIndex = (i) => {
        index = (i + urls.length) % urls.length;
        wrapper.setAttribute("data-index", String(index));
        if(imageEl) imageEl.src = urls[index];
      };

      prev?.addEventListener("click", (e) => {
        e.stopPropagation();
        setIndex(index - 1);
      });

      next?.addEventListener("click", (e) => {
        e.stopPropagation();
        setIndex(index + 1);
      });
    });

    // ✅ FIX: Only scroll results when the marker is clicked (and card exists)
    marker.on("click", () => {
      ensurePanelOpen();

      // Find the matching card in the results pane
      const cardEl = document.querySelector(`.card[data-aed-id="${aed.id}"]`);
      if(cardEl){
        scrollResultsToCard(cardEl);
      }
    });

    markersLayer.addLayer(marker);
  });
}

function renderResults(items){
  const list = $("resultsList");
  list.innerHTML = "";

  const meta = $("panelMeta");
  meta.textContent = `${items.length} shown`;

  const countEl = document.getElementById("resultsCount");
  if(countEl){
    countEl.textContent = `${items.length} listed`;
  }

  if(items.length === 0){
    list.innerHTML = `<div class="panel-note">No defibrillators match the current filters.</div>`;
    return;
  }

  // Nearest marker is set on the object, but list might not be sorted by nearest if no location.
  const nearestId = items.find(x => x.__nearestCandidate)?.id || null;

  items.forEach((aed) => {
    const isNearest = (nearestId && aed.id === nearestId);
    const distText = aed.distanceKm != null ? formatDistance(aed.distanceKm) : "";

    const status = aed.status || "Unknown";
    const badgeClass = statusToClass(status);

    const verifiedText = aed.lastVerified ? `Last verified: ${aed.lastVerified}` : "";

    const card = document.createElement("div");
    card.className = `card ${isNearest ? "nearest" : ""}`;
    card.setAttribute("data-aed-id", aed.id);

    // Public access badge temporarily disabled
    card.innerHTML = `
      <h3>${
        isNearest
          ? `Nearest (${distText}) – ${escapeHtml(aed.name || "Defibrillator")}`
          : `${distText ? distText + " – " : ""}${escapeHtml(aed.name || "Defibrillator")}`
      }</h3>

      <div class="meta-row">
        <span class="badge ${badgeClass}" data-status="${escapeHtml(status)}" role="button" tabindex="0">
          ${escapeHtml(status)}
        </span>

        ${aed.parish ? `<span class="meta-parish">${escapeHtml(aed.parish)}</span>` : ""}
        ${aed.address ? `<span class="meta-address">${escapeHtml(aed.address)}</span>` : ""}
      </div>

      ${aed.access ? `<div class="small"><strong>Access:</strong> ${escapeHtml(aed.access)}</div>` : ""}
      ${verifiedText ? `<div class="small">${escapeHtml(verifiedText)}</div>` : ""}

      <div class="card-actions" style="margin-top:10px;">
        <a class="btn btn-primary" href="${buildGoogleNavLink(aed.lat, aed.lng)}" target="_blank" rel="noopener">Navigate</a>
        <a class="btn btn-secondary" href="tel:999">Call 999</a>
        <button class="btn btn-secondary" type="button" data-zoom="${aed.lat},${aed.lng}">Zoom</button>
      </div>
    `;

    // Status badge click handler
    const statusBadge = card.querySelector(".badge[data-status]");
    if(statusBadge){
      const statusText = statusBadge.getAttribute("data-status");

      statusBadge.addEventListener("click", (e) => {
        e.stopPropagation();
        alert(`Defibrillator status is ${statusText}`);
      });

      statusBadge.addEventListener("keypress", (e) => {
        if(e.key === "Enter"){
          alert(`Defibrillator status is ${statusText}`);
        }
      });
    }

    card.querySelector('button[data-zoom]')?.addEventListener("click", (e) => {
      const [lat, lng] = e.currentTarget.getAttribute("data-zoom").split(",").map(Number);
      map.setView([lat, lng], 16, { animate: true });
    });

    // clicking card zooms (best-effort)
    card.addEventListener("click", (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      if(tag === "a" || tag === "button") return;
      if(typeof aed.lat === "number" && typeof aed.lng === "number"){
        map.setView([aed.lat, aed.lng], 16, { animate: true });
      }
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

  allAEDs = records.map(r => {
    const f = r.fields || {};

    const attachments = Array.isArray(f.Image) ? f.Image : [];
    const images = attachments
      .map(a => ({
        url: a?.url || null,
        filename: a?.filename || "",
        type: a?.type || ""
      }))
      .filter(x => x.url);

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

      // NEW: store all images (0..n)
      images,

      // Keep backwards compat in case anything else uses it
      imageUrl: images.length ? images[0].url : null,

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
  try{
    const d = new Date(v);
    if(Number.isNaN(d.getTime())) return String(v);
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
  const redPinIcon = L.divIcon({
    className: "custom-user-pin",
    html: `
      <svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 1C7 1 2 6 2 13c0 9 12 23 12 23s12-14 12-23C26 6 21 1 14 1z" fill="#c62828"/>
        <circle cx="14" cy="13" r="4" fill="#ffffff"/>
      </svg>
    `,
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    popupAnchor: [0, -34]
  });

  if(!userMarker){
    userMarker = L.marker([lat, lng], { icon: redPinIcon });
    userMarker.addTo(map);
  } else {
    userMarker.setLatLng([lat, lng]);
  }
}

function findNearestFunctional(){
  ensurePanelOpen();

  const note = $("geoNote");
  note.innerHTML = `Tip: Click <strong>Find Nearest</strong> to use your location. Your location is not stored.`;

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

      // Mark nearest candidate in the dataset
      allAEDs.forEach(a => { a.__nearestCandidate = false; });

      const functionalPublic = visibleAEDs
        .filter(a => (a.status || "Unknown") === "Active" && a.publicAccess === true && typeof a.lat === "number" && typeof a.lng === "number")
        .map(a => ({ ...a, distanceKm: distanceKm(lat, lng, a.lat, a.lng) }))
        .sort((a,b) => a.distanceKm - b.distanceKm);

      if(functionalPublic.length > 0){
        const nearest = functionalPublic[0];
        const match = allAEDs.find(a => a.id === nearest.id);
        if(match) match.__nearestCandidate = true;

        // Zoom to user then to nearest (gentle)
        map.flyTo([lat, lng], 15, { animate: true, duration: 1.0 });

        setTimeout(() => {
          map.flyTo([nearest.lat, nearest.lng], 16, { animate: true, duration: 1.2 });

          setTimeout(() => {
            const marker = markerRegistry[nearest.id];
            if(marker){
              marker.openPopup();
            }
          }, 1200);
        }, 2000);

      } else {
        alert("No active, publicly accessible defibrillators are currently shown with valid coordinates.");
        map.setView([lat, lng], 15, { animate: true });
      }

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

  $("parishFilter").addEventListener("change", applyFiltersAndRender);
  $("statusFilter").addEventListener("change", applyFiltersAndRender);

  $("btnFindNearest").addEventListener("click", findNearestFunctional);

  const iconToggle = document.getElementById("themeIconToggle");
  if(iconToggle){
    iconToggle.addEventListener("click", () => {
      const isGov = document.body.classList.contains("theme-government");
      setTheme(isGov ? "theme-civic" : "theme-government");
    });
  }

  // --- Overlay Close Logic ---
  const overlay = document.getElementById("imageOverlay");
  const overlayImg = document.getElementById("overlayImage");
  const closeBtn = document.getElementById("overlayCloseBtn");

  if(overlay){

    const closeOverlay = () => {
      overlay.classList.remove("active");
      if(overlayImg) overlayImg.src = "";
    };

    // Close when clicking dark background only
    overlay.addEventListener("click", (e) => {
      if(e.target === overlay){
        closeOverlay();
      }
    });

    // Close via ✕ button (if present)
    if(closeBtn){
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeOverlay();
      });
    }

    // Close via ESC key
    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape" && overlay.classList.contains("active")){
        closeOverlay();
      }
    });

  }
}


function applyThemeFromUrl(){
  const params = new URLSearchParams(location.search);
  const t = params.get("theme");
  if(t === "government") setTheme("theme-government");
  if(t === "civic") setTheme("theme-civic");
}

async function setUpdatedFromGitHub(){
  const el = document.getElementById("updatedMeta");
  if(!el) return;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`
    );

    if(!response.ok) throw new Error("GitHub API error");

    const data = await response.json();
    const commitDate = new Date(data.commit.committer.date);

    const pad = n => String(n).padStart(2,"0");

    const yyyy = commitDate.getFullYear();
    const mm = pad(commitDate.getMonth()+1);
    const dd = pad(commitDate.getDate());
    const hh = pad(commitDate.getHours());
    const mi = pad(commitDate.getMinutes());

    el.textContent = `Released ${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }
  catch(error){
    console.error("Could not fetch commit info:", error);
    el.textContent = "Released (unavailable)";
  }
}

async function main(){
  loadTheme();
  applyThemeFromUrl();
  initMap();
  bindUI();
  setReportUrl();

  await setUpdatedFromGitHub();

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
