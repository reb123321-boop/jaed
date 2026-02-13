/* Jersey Defibrillators Map – Stable Base */

const CONFIG = {
  AIRTABLE_API_KEY: "patjiuZllI8qqq7ff.5dc279e7a8273b0dadf608f5bd0e502194fae256882f17f28d6ad423800ee961",
  AIRTABLE_BASE_ID: "appWLevXmVq6r9tmN",
  AIRTABLE_TABLE_NAME: "AED Locations",
  JERSEY_CENTER: [49.2144, -2.1313],
  JERSEY_ZOOM: 12
};

let map;
let markersLayer;
let allAEDs = [];

const $ = id => document.getElementById(id);

/* ---------- Map ---------- */

function initMap(){
  map = L.map("map").setView(CONFIG.JERSEY_CENTER, CONFIG.JERSEY_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

/* ---------- Render ---------- */

function render(){
  const list = $("resultsList");
  if(!list) return;

  list.innerHTML = "";
  markersLayer.clearLayers();

  allAEDs.forEach(a => {
    if(!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) return;

    const marker = L.circleMarker([a.lat, a.lng], {
      radius: 8,
      fillColor: "#0b5cff",
      color: "#fff",
      weight: 2,
      fillOpacity: 0.9
    }).addTo(markersLayer);

    marker.bindPopup(`
      <strong>${a.name}</strong><br>
      ${a.address || ""}
    `);

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${a.name}</h3>
      <div class="small">${a.address || ""}</div>
    `;
    list.appendChild(card);
  });

  const count = $("resultsCount");
  if(count) count.textContent = `${allAEDs.length} listed`;
}

/* ---------- Airtable ---------- */

async function fetchAirtable(){
  const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CONFIG.AIRTABLE_TABLE_NAME)}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${CONFIG.AIRTABLE_API_KEY}`
    }
  });

  if(!res.ok) throw new Error("Airtable failed");

  const data = await res.json();

  allAEDs = data.records.map(r => {
    const f = r.fields || {};
    return {
      id: r.id,
      name: f.Name || "Defibrillator",
      address: f.Address || "",
      lat: Number(f.Latitude),
      lng: Number(f.Longitude)
    };
  });

  render();
}

/* ---------- Init ---------- */

async function main(){
  initMap();

  try{
    await fetchAirtable();
  }catch(e){
    console.error(e);
    const list = $("resultsList");
    if(list){
      list.innerHTML = `<div class="panel-note">Could not load data.</div>`;
    }
  }
}

main();
