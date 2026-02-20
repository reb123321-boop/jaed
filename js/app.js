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

let overlayImages = [];
let overlayIndex = 0;

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

function forceMapResize(){
  if(!map) return;
  map.invalidateSize(true);
}

function fixMobileMapCenter(){
  if(!map) return;

  // Re-check at call time (orientation/address bar can change sizes)
  const isMobileNow = window.matchMedia("(max-width: 600px)").matches;
  const targetZoom = isMobileNow ? (CONFIG.JERSEY_ZOOM - 1) : CONFIG.JERSEY_ZOOM;

  // Two RAFs ensures DOM/layout has settled before Leaflet recalcs
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      map.invalidateSize(true);
      map.setView(CONFIG.JERSEY_CENTER, targetZoom, { animate:false });
    });
  });
}

function initMap(){

  const isMobile = window.matchMedia("(max-width: 600px)").matches;
  const startZoom = isMobile ? CONFIG.JERSEY_ZOOM - 1 : CONFIG.JERSEY_ZOOM;

  map = L.map("map", { zoomControl: true })
          .setView(CONFIG.JERSEY_CENTER, startZoom);

  // --- CREATE STATUS PANES ---
  map.createPane("pane-out");
  map.getPane("pane-out").style.zIndex = 400;

  map.createPane("pane-unknown");
  map.getPane("pane-unknown").style.zIndex = 450;

  map.createPane("pane-active");
  map.getPane("pane-active").style.zIndex = 500;

  // --- Base Layers ---
  const street = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }
  );

  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "© Esri, Maxar, Earthstar Geographics"
    }
  );

  // Default layer
  street.addTo(map);

  // Layer control (bottom left)
  L.control.layers(
    {
      "Street Map": street,
      "Satellite": satellite
    },
    null,
    {
      position: "bottomleft"
    }
  ).addTo(map);

  // --- Markers Layer ---
  markersLayer = L.layerGroup().addTo(map);

  // --- Legend Control ---
  const legend = L.control({ position: "topright" });

  legend.onAdd = function () {

    const container = L.DomUtil.create("div", "map-legend");

    container.innerHTML = `
      <div class="legend-header">
        <span>Legend</span>
        <button type="button" class="legend-toggle" aria-label="Toggle legend">–</button>
      </div>

      <div class="legend-body">

        <div class="legend-item">
          <span class="legend-dot" style="background:#00c853;"></span>
          Active
        </div>

        <div class="legend-item">
          <span class="legend-dot" style="background:#f9a825;"></span>
          Unknown
        </div>

        <div class="legend-item">
          <span class="legend-dot" style="background:#757575;"></span>
          Out of Service
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

      </div>
    `;

    L.DomEvent.disableClickPropagation(container);

    const toggleBtn = container.querySelector(".legend-toggle");
    const body = container.querySelector(".legend-body");

    toggleBtn.addEventListener("click", () => {
      const collapsed = container.classList.toggle("collapsed");
      toggleBtn.textContent = collapsed ? "+" : "–";
    });

     // --- Auto-collapse on mobile ---
      const isMobile = window.matchMedia("(max-width: 600px)").matches;
      
      if (isMobile) {
        setTimeout(() => {
          container.classList.add("collapsed");
          toggleBtn.textContent = "+";
        }, 1500); // collapse after 1.5 seconds
      }

    return container;
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
      <div class="popup-card">
    
         ${imageUrls.length ? `
           <div class="popup-image-wrapper"
                data-images="${encodedUrls}"
                data-index="0">
         
             <button type="button"
                     class="popup-img-prev"
                     aria-label="Previous image"
                     ${imageUrls.length === 1 ? 'style="display:none;"' : ""}>
               ‹
             </button>
         
             <img src="${imageUrls[0]}"
                  alt="Defibrillator location"
                  class="popup-image">
         
             <button type="button"
                     class="popup-img-next"
                     aria-label="Next image"
                     ${imageUrls.length === 1 ? 'style="display:none;"' : ""}>
               ›
             </button>
         
           </div>
         ` : ""}
        <div class="popup-title">
          ${escapeHtml(aed.name || "Defibrillator")}
          ${
            aed.padNumber
              ? `<span class="popup-pad">(Pad ${escapeHtml(aed.padNumber)})</span>`
              : ""
          }
        </div>
    
        <div class="popup-location">
          ${
            [aed.address, aed.parish, aed.postcode]
              .filter(Boolean)
              .map(escapeHtml)
              .join(", ")
          }
        </div>
    
        <div class="popup-status-row">
          <span class="badge ${statusToClass(aed.status)}">
            ${escapeHtml(aed.status || "Unknown")}
          </span>
          ${
            aed.lastVerified
              ? `<span class="popup-verified">Verified ${escapeHtml(aed.lastVerified)}</span>`
              : ""
          }
        </div>
    
        ${
          aed.access
            ? `<div class="popup-access">${escapeHtml(aed.access)}</div>`
            : ""
        }
    
        <div class="popup-actions">
          <a href="${buildGoogleNavLink(aed.lat, aed.lng)}"
             target="_blank"
             rel="noopener"
             class="btn btn-secondary">
            Directions
          </a>
        </div>
    
      </div>
    `;
     
    // Marker colour
    let markerColor;
    switch(aed.status){
      case "Active":
        markerColor = "#00c853";
        break;
      case "Out of Service":
        markerColor = "#757575";
        break;
      case "Unknown":
      default:
        markerColor = "#f9a825";
        break;
    }

     let paneName;

      switch(aed.status){
        case "Active":
          paneName = "pane-active";
          break;
      
        case "Unknown":
          paneName = "pane-unknown";
          break;
      
        case "Out of Service":
        default:
          paneName = "pane-out";
          break;
      }

    const isNearest = aed.__nearestCandidate === true;

    const size = isNearest ? 24 : 18;
    const ringColor = isNearest ? "#b71c1c" : "#ffffff";
    const ringWidth = isNearest ? 3 : 2;

    const marker = L.marker([aed.lat, aed.lng], {
      pane: paneName,
      icon: L.divIcon({
        className: "aed-marker",
        html: `
          <div 
            class="aed-dot"
            style="
              width:${size}px;
              height:${size}px;
              background:${markerColor};
              border:${ringWidth}px solid ${ringColor};
            ">
          </div>
        `,
        iconSize: [size + ringWidth * 2, size + ringWidth * 2],
        iconAnchor: [(size + ringWidth * 2) / 2, (size + ringWidth * 2) / 2]
      })
    }).bindPopup(popupHtml);

    markerRegistry[aed.id] = marker;

    // ---------- POPUP LOGIC ----------
    marker.on("popupopen", () => {

      const popupEl = marker.getPopup()?.getElement();
      if(!popupEl) return;

      popupEl.querySelectorAll(".popup-image").forEach(img => {

        if (img.dataset.bound === "1") return;
        img.dataset.bound = "1";

        img.addEventListener("click", (e) => {
          e.stopPropagation();

          const wrapper = img.closest(".popup-image-wrapper");

          let imagesFromThisPopup = [];
          let index = 0;

          if (wrapper && wrapper.dataset.images) {
            imagesFromThisPopup = decodeUrlsFromAttr(wrapper.dataset.images);
            index = parseInt(wrapper.dataset.index || "0", 10) || 0;
          }

          if (!Array.isArray(imagesFromThisPopup) || imagesFromThisPopup.length === 0) {
            imagesFromThisPopup = [img.src];
            index = 0;
          }

          openImageOverlay(imagesFromThisPopup, index);
        });
      });

      const wrapper = popupEl.querySelector(".popup-image-wrapper");
      if(!wrapper) return;

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

    marker.on("click", () => {
      ensurePanelOpen();

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
      
        <a class="btn btn-secondary btn-inline"
           href="${buildGoogleNavLink(aed.lat, aed.lng)}"
           target="_blank"
           rel="noopener">
          Directions
        </a>
      
        <span class="badge ${badgeClass}" data-status="${escapeHtml(status)}" role="button" tabindex="0">
          ${escapeHtml(status)}
        </span>
        
        ${aed["Public Access"] !== undefined ? `
          <span class="badge badge-access ${aed["Public Access"] ? "badge-access-yes" : "badge-access-no"}">
            ${aed["Public Access"] ? "Public Access" : "Restricted Access"}
          </span>
        ` : ""}
      
        ${aed.parish ? `<span class="meta-parish">${escapeHtml(aed.parish)}</span>` : ""}
        ${aed.address ? `<span class="meta-address">${escapeHtml(aed.address)}</span>` : ""}
      
      </div>
      
      ${aed.access ? `<div class="small"><strong>Access:</strong> ${escapeHtml(aed.access)}</div>` : ""}
      ${verifiedText ? `<div class="small">${escapeHtml(verifiedText)}</div>` : ""}

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
      
        const marker = markerRegistry[aed.id];
        if(!marker) return;
      
        ensurePanelOpen();
      
        // Smooth fly animation
        map.flyTo(marker.getLatLng(), 16, {
          animate: true,
          duration: 0.6
        });
      
        // Open popup slightly after fly starts
        setTimeout(() => {
          marker.openPopup();
        }, 300);
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
      padNumber: f["Pad Number"] || f.pad_number || "",
      postcode: f.Postcode || f.postcode || "",
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
  note.innerHTML = `Tip: Click <strong>Nearest To Me</strong> to use your location. Your location is not stored.`;

  const btn = $("btnFindNearest");
  const originalBtnText = btn ? btn.textContent : "";
  const setBtnState = (isLocating) => {
    if(!btn) return;
    btn.disabled = isLocating;
    btn.textContent = isLocating ? "Locating…" : originalBtnText;
    btn.setAttribute("aria-busy", isLocating ? "true" : "false");
  };

  if(!navigator.geolocation){
    alert("Geolocation is not supported in this browser.");
    return;
  }

  setBtnState(true);

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      lastUserLocation = [lat, lng];
      addOrUpdateUserMarker(lat, lng);

      // Mark nearest candidate in the dataset
      allAEDs.forEach(a => { a.__nearestCandidate = false; });

      const functionalPublic = visibleAEDs
        .filter(a =>
          (a.status || "Unknown") === "Active" &&
          a.publicAccess === true &&
          typeof a.lat === "number" &&
          typeof a.lng === "number"
        )
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
      setBtnState(false);
    },
    (err) => {
      if(err.code === err.PERMISSION_DENIED){
        alert("Location permission was denied. You can still browse the map and use filters.");
      } else if(err.code === err.TIMEOUT){
        alert("Getting your location timed out. Please try again.");
      } else {
        alert("Could not get your location. Please try again.");
      }
      setBtnState(false);
    },
    {//Old values   { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      enableHighAccuracy: false,
      timeout: 7000,
      maximumAge: 60000
    }
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

// Display name formatter (Name + optional Pad Number)
function getDisplayName(aed){
  const base = aed.name || "Defibrillator";
  return aed.padNumber ? `${base} (Pad ${aed.padNumber})` : base;
}

function bindUI(){

  // Panel toggle (only if it exists)
  const panelToggle = $("panelToggle");
  if(panelToggle){
    panelToggle.addEventListener("click", togglePanel);
  }

  // Filters
  $("parishFilter")?.addEventListener("change", applyFiltersAndRender);
  $("statusFilter")?.addEventListener("change", applyFiltersAndRender);

  // Find nearest
  $("btnFindNearest")?.addEventListener("click", findNearestFunctional);

  // Theme toggle
  const iconToggle = document.getElementById("themeIconToggle");
  if(iconToggle){
    iconToggle.addEventListener("click", () => {
      const isGov = document.body.classList.contains("theme-government");
      setTheme(isGov ? "theme-civic" : "theme-government");
    });
  }

   // --- Info Modal ---
   document.addEventListener("DOMContentLoaded", () => {
   
     const infoBtn = document.getElementById("infoButton");
     const infoModal = document.getElementById("infoModal");
     const infoCloseBtn = document.getElementById("infoCloseBtn");
   
     if(!infoBtn || !infoModal){
       console.warn("Info modal elements not found");
       return;
     }
   
     const closeInfo = () => {
       infoModal.classList.remove("active");
     };
   
     infoBtn.addEventListener("click", () => {
       infoModal.classList.add("active");
     });
   
     infoCloseBtn?.addEventListener("click", closeInfo);
   
     infoModal.addEventListener("click", (e) => {
       if(e.target === infoModal){
         closeInfo();
       }
     });
   
     document.addEventListener("keydown", (e) => {
       if(e.key === "Escape"){
         closeInfo();
       }
     });
   
   });

  // --- Overlay Close Logic ---
  const overlay = document.getElementById("imageOverlay");
  const overlayImg = document.getElementById("overlayImage");
  const closeBtn = document.getElementById("overlayCloseBtn");

  if(overlay){

    const closeOverlay = () => {
      overlay.classList.remove("active");
      if(overlayImg) overlayImg.src = "";
    };

    overlay.addEventListener("click", (e) => {
      if(!e.target.closest("#overlayImage")){
        closeOverlay();
      }
    });

    closeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      closeOverlay();
    });

    document.addEventListener("keydown", (e) => {
      if(e.key === "Escape"){
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

function openImageOverlay(images, startIndex = 0){
  if (!Array.isArray(images) || images.length === 0) return;

  const overlay = document.getElementById("imageOverlay");
  const overlayImg = document.getElementById("overlayImage");
  const prevBtn = document.getElementById("overlayPrevBtn");
  const nextBtn = document.getElementById("overlayNextBtn");

  if (!overlay || !overlayImg) return;

  overlayImages = images;
  overlayIndex = Math.max(0, Math.min(startIndex, images.length - 1));

  overlayImg.src = overlayImages[overlayIndex];
  overlay.classList.add("active");

  const hasMultiple = overlayImages.length > 1;

  // 🔑 Force visibility on open
   if (prevBtn && nextBtn) {
     prevBtn.style.display =
       hasMultiple && overlayIndex > 0 ? "flex" : "none";
   
     nextBtn.style.display =
       hasMultiple && overlayIndex < overlayImages.length - 1 ? "flex" : "none";
   }
}

const overlayPrevBtn = document.getElementById("overlayPrevBtn");
const overlayNextBtn = document.getElementById("overlayNextBtn");
const overlayImg = document.getElementById("overlayImage");

function updateOverlayNavButtons(){
  const hasMultiple = overlayImages.length > 1;

  if (!overlayPrevBtn || !overlayNextBtn) return;

  overlayPrevBtn.style.display =
    hasMultiple && overlayIndex > 0 ? "flex" : "none";

  overlayNextBtn.style.display =
    hasMultiple && overlayIndex < overlayImages.length - 1 ? "flex" : "none";
}

overlayPrevBtn?.addEventListener("click", (e) => {
  e.stopPropagation();

  if (overlayIndex > 0) {
    overlayIndex--;
    overlayImg.src = overlayImages[overlayIndex];
    updateOverlayNavButtons();
  }
});

overlayNextBtn?.addEventListener("click", (e) => {
  e.stopPropagation();

  if (overlayIndex < overlayImages.length - 1) {
    overlayIndex++;
    overlayImg.src = overlayImages[overlayIndex];
    updateOverlayNavButtons();
  }
});
   
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

  // Reveal AFTER map is ready
  if(map){
    map.whenReady(() => {
      document.body.classList.remove("loading");

      // Invalidate ONCE after becoming visible
      setTimeout(() => {
        map.invalidateSize(false); // false avoids animated correction
      }, 0);
    });
  } else {
    document.body.classList.remove("loading");
  }

  // Only resize on actual window resize
  window.addEventListener("resize", () => {
    clearTimeout(window.__mapResizeTimer);
    window.__mapResizeTimer = setTimeout(() => {
      map?.invalidateSize(false);
    }, 150);
  });
}

main();

// --- Build / branch info (Info modal) ---
(async () => {
  try {
    const res = await fetch("version.json", { cache: "no-store" });
    if (!res.ok) throw new Error("version.json not found");

    const data = await res.json();

    const container = document.getElementById("buildInfo");
    if (!container) return;

   container.innerHTML = `
     <div class="build-info-row ${data.branch.replace("/", "-")}">
       <strong>Build:</strong>
       <span>${data.branch}</span>
     </div>
     <div class="build-info-row build-info-deployed ${data.branch.replace("/", "-")}">
       <strong>Deployed:</strong>
       <span>${data.deployed}</span>
     </div>
   `;

  } catch (e) {
    console.warn("Build info unavailable");
  }
})();

