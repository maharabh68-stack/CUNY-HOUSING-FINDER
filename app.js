/* CUNY Housing Finder
   Improved build: cleaner UI behavior, validation, empty states, counters, sorting, and safer rendering.
   Note: Supabase anon keys are okay in frontend demos only if Row Level Security policies are set correctly.
*/

///////////////////////////////
// 0) SUPABASE + MODE TOGGLE //
///////////////////////////////
const SUPABASE_URL = "https://znlnarqyzwcrzitkcjih.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInJlZiI6InpubG5hcnF5endjcnppdGtjamloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NTg1NjAsImV4cCI6MjA3NzUzNDU2MH0.PChD4eCzCZSFwcDscwp-ZjEc3Jf7FHvnmbk1YGDxQD8";
const sbClient = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const MODE_KEY = "cuny_local_mode";
const LS_KEY = "cuny_listings_v2";
const OWN_KEY = "cuny_owned_ids";

function getLocalMode() { return localStorage.getItem(MODE_KEY) === "true"; }
function setLocalMode(value) { localStorage.setItem(MODE_KEY, value ? "true" : "false"); }

let USE_SUPABASE = !!sbClient && !getLocalMode();
let allListings = [];
let filteredListings = [];
let campusPoints = [];
let tempSearchMarker = null;
let LOCATE_RADIUS_KM = 3;

const toggleLocal = document.getElementById("toggleLocal");
const modeLabel = document.getElementById("modeLabel");
const btnClearLocal = document.getElementById("btnClearLocal");
const toast = document.getElementById("toast");

function updateModeLabel() {
    if (!modeLabel) return;
    if (!sbClient) modeLabel.textContent = "Local only";
    else modeLabel.textContent = getLocalMode() ? "Local only" : "Cloud";
}

if (toggleLocal) {
    toggleLocal.checked = getLocalMode() || !sbClient;
    toggleLocal.disabled = !sbClient;
    updateModeLabel();
    toggleLocal.addEventListener("change", async () => {
        setLocalMode(toggleLocal.checked);
        USE_SUPABASE = !!sbClient && !getLocalMode();
        updateModeLabel();
        await reloadData();
        showToast(toggleLocal.checked ? "Using local storage" : "Using Supabase");
    });
}

//////////////////////
// 1) Tabs/Sections //
//////////////////////
const sectionMap = document.getElementById("sectionMap");
const sectionAdd = document.getElementById("sectionAdd");
const sectionFind = document.getElementById("sectionFind");
const sectionList = document.getElementById("sectionList");

const tabs = {
    map: document.getElementById("tabMap"),
    add: document.getElementById("tabAdd"),
    find: document.getElementById("tabFind"),
    list: document.getElementById("tabList"),
};

function showSection(which) {
    sectionMap.classList.toggle("visible", which === "map");
    sectionAdd.classList.toggle("visible", which === "add");
    sectionFind.classList.toggle("visible", which === "find");
    sectionList.classList.toggle("visible", which === "list");

    Object.entries(tabs).forEach(([name, button]) => {
        button.classList.toggle("active", name === which);
        button.setAttribute("aria-selected", String(name === which));
    });

    if (which === "list") renderListings();
    if (which === "map") setTimeout(() => map.invalidateSize(), 150);
}

tabs.map.addEventListener("click", () => showSection("map"));
tabs.add.addEventListener("click", () => showSection("add"));
tabs.find.addEventListener("click", () => showSection("find"));
tabs.list.addEventListener("click", () => showSection("list"));

/////////////////////////
// 2) Map + base layers //
/////////////////////////
const homeCenter = [40.7128, -74.0060];
const homeZoom = 10.5;

const map = L.map("map", { scrollWheelZoom: true }).setView(homeCenter, homeZoom);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
}).addTo(map);

const clusterNeed = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 48 });
const clusterHave = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 48 });
const campusLayer = L.layerGroup().addTo(map);
const userLayer = L.layerGroup().addTo(map);

map.addLayer(clusterNeed);
map.addLayer(clusterHave);

const inputLat = document.getElementById("inputLat");
const inputLng = document.getElementById("inputLng");

map.on("click", (e) => {
    inputLat.value = e.latlng.lat.toFixed(6);
    inputLng.value = e.latlng.lng.toFixed(6);
    showToast("Location picked");
});

document.getElementById("btnResetView").addEventListener("click", () => {
    resetFilters(false);
    renderListingMarkers(filteredListings);
    renderListings();
    userLayer.clearLayers();
    if (tempSearchMarker) {
        map.removeLayer(tempSearchMarker);
        tempSearchMarker = null;
    }
    map.setView(homeCenter, homeZoom);
    showToast("Map reset");
});

document.getElementById("btnClearSearchPin").addEventListener("click", () => {
    if (tempSearchMarker) {
        map.removeLayer(tempSearchMarker);
        tempSearchMarker = null;
        showToast("Search pin cleared");
    } else {
        showToast("No search pin to clear");
    }
});

////////////////////////////////////////
// 3) Data layer: Supabase + local LS  //
////////////////////////////////////////
function lsLoad() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch { return []; }
}

function lsSave(listings) {
    localStorage.setItem(LS_KEY, JSON.stringify(listings));
}

function clearLocalData() {
    localStorage.removeItem(LS_KEY);
    refreshClearLocalButtonState();
}

function ownedLoad() {
    try { return new Set(JSON.parse(localStorage.getItem(OWN_KEY)) || []); }
    catch { return new Set(); }
}

function ownedSave(set) {
    localStorage.setItem(OWN_KEY, JSON.stringify(Array.from(set)));
}

function addOwnedId(id) {
    const owned = ownedLoad();
    owned.add(String(id));
    ownedSave(owned);
}

function removeOwnedId(id) {
    const owned = ownedLoad();
    owned.delete(String(id));
    ownedSave(owned);
}

function isOwned(id) {
    return ownedLoad().has(String(id));
}

async function sbLoad() {
    const { data, error } = await sbClient
        .from("listings")
        .select("*")
        .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeListing);
}

async function sbInsert(listing) {
    const { data, error } = await sbClient
        .from("listings")
        .insert({
            type: listing.type,
            campus: listing.campus || null,
            title: listing.title,
            description: listing.description || null,
            price: Number.isFinite(listing.price) ? Number(listing.price) : null,
            contact: listing.contact,
            lat: Number.isFinite(listing.lat) ? Number(listing.lat) : null,
            lng: Number.isFinite(listing.lng) ? Number(listing.lng) : null,
        })
        .select()
        .single();
    if (error) throw error;
    return normalizeListing(data);
}

function normalizeListing(row) {
    return {
        id: row.id || `L${Date.now()}${Math.random().toString(16).slice(2)}`,
        type: row.type === "have" ? "have" : "need",
        campus: row.campus || "",
        title: row.title || "Untitled listing",
        description: row.description || "",
        price: row.price === null || row.price === undefined || row.price === "" ? null : Number(row.price),
        contact: row.contact || "",
        lat: row.lat === null || row.lat === undefined || row.lat === "" ? NaN : Number(row.lat),
        lng: row.lng === null || row.lng === undefined || row.lng === "" ? NaN : Number(row.lng),
        created_at: row.created_at || new Date().toISOString(),
    };
}

async function reloadData() {
    try {
        const source = USE_SUPABASE ? await sbLoad() : lsLoad().map(normalizeListing);
        allListings = source;
    } catch (error) {
        console.warn("Supabase load failed, using localStorage", error);
        USE_SUPABASE = false;
        allListings = lsLoad().map(normalizeListing);
        showToast("Cloud unavailable. Showing local data.");
    }

    filteredListings = [...allListings];
    renderListingMarkers(filteredListings);
    renderListings();
    updateStats();
    refreshClearLocalButtonState();
    updateModeLabel();
}

//////////////////////////////////////////////////////////
// 4) Campus dataset: NYC Open Data with fallback       //
//////////////////////////////////////////////////////////
const CUNY_GEOJSON = "https://data.cityofnewyork.us/resource/uew7-8je4.geojson?$select=the_geom,name";
const fallbackCampuses = [
    { name: "BMCC", lat: 40.7183, lng: -74.0120 },
    { name: "Baruch College", lat: 40.7403, lng: -73.9832 },
    { name: "City College", lat: 40.8200, lng: -73.9493 },
    { name: "Hunter College", lat: 40.7683, lng: -73.9640 },
    { name: "Queens College", lat: 40.7365, lng: -73.8203 },
    { name: "Brooklyn College", lat: 40.6305, lng: -73.9524 },
    { name: "Lehman College", lat: 40.8735, lng: -73.8940 },
    { name: "CSI", lat: 40.6034, lng: -74.1483 },
    { name: "York College", lat: 40.7028, lng: -73.7956 },
    { name: "CUNY School of Law", lat: 40.7433, lng: -73.8270 },
];

const campusSelect = document.getElementById("filterCampus");

async function loadCampuses() {
    try {
        const response = await fetch(CUNY_GEOJSON, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const geojson = await response.json();
        const points = [];

        (geojson.features || []).forEach((feature) => {
            const name = (feature.properties?.name || "CUNY campus").toString().trim();
            const geometry = feature.geometry || feature;
            if (!geometry) return;

            if (geometry.type === "Point") {
                points.push({ name, lat: geometry.coordinates[1], lng: geometry.coordinates[0] });
            }

            if (geometry.type === "MultiPoint") {
                geometry.coordinates.forEach(([lng, lat]) => points.push({ name, lat, lng }));
            }
        });

        renderCampuses(points.length ? points : fallbackCampuses);
    } catch (error) {
        console.warn("Campus dataset failed. Using fallback campuses.", error);
        renderCampuses(fallbackCampuses);
    }
}

function renderCampuses(list) {
    campusLayer.clearLayers();
    campusPoints = list.slice();

    const names = Array.from(new Set(list.map((campus) => campus.name))).sort((a, b) => a.localeCompare(b));
    campusSelect.innerHTML = '<option value="">All campuses</option>' +
        names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

    list.forEach((campus) => {
        L.circleMarker([campus.lat, campus.lng], {
            radius: 7,
            color: "#0d4ea8",
            weight: 2,
            fillColor: "#1273de",
            fillOpacity: 0.9,
        })
            .bindTooltip(campus.name)
            .bindPopup(`<strong>${escapeHtml(campus.name)}</strong>`)
            .addTo(campusLayer);
    });

    updateStats();
}

/////////////////////////////////////////////
// 5) Listings markers + list rendering    //
/////////////////////////////////////////////
const listingsContainer = document.getElementById("listingsContainer");
const listCount = document.getElementById("listCount");
const sortListings = document.getElementById("sortListings");

function priceText(price) {
    return Number.isFinite(price) ? `$${Number(price).toLocaleString()}/mo` : "Price not listed";
}

function listingPopupHtml(listing) {
    const ownedButton = isOwned(listing.id)
        ? `<button class="btn" type="button" onclick="deleteListing(${jsArg(listing.id)})">Delete</button>`
        : "";

    return `
        <div class="popupContent">
            <span class="badge ${listing.type === "need" ? "need" : "have"}">${listing.type === "need" ? "Needs room" : "Room available"}</span>
            <h3 style="margin:8px 0 4px;font-size:15px">${escapeHtml(listing.title)}</h3>
            <div style="color:#9fb0c5">${escapeHtml(listing.campus || "Campus not listed")} · ${priceText(listing.price)}</div>
            ${listing.description ? `<p style="margin:8px 0 0">${escapeHtml(listing.description)}</p>` : ""}
            <div style="margin-top:8px;color:#9fb0c5">Contact: ${escapeHtml(listing.contact || "Not listed")}</div>
            <div class="actions" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn" type="button" onclick="copyContact(this, ${jsArg(listing.contact)})">Copy contact</button>
                ${ownedButton}
            </div>
        </div>`;
}

function addListingMarker(listing) {
    if (!Number.isFinite(listing.lat) || !Number.isFinite(listing.lng)) return null;

    const marker = L.marker([listing.lat, listing.lng], {
        title: listing.title,
        icon: L.divIcon({
            className: "",
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${listing.type === "need" ? "#ef4444" : "#22c55e"};border:3px solid #111827;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
        }),
    }).bindPopup(listingPopupHtml(listing), { autoPan: true });

    (listing.type === "need" ? clusterNeed : clusterHave).addLayer(marker);
    return marker;
}

function renderListingMarkers(list) {
    clusterNeed.clearLayers();
    clusterHave.clearLayers();
    list.forEach(addListingMarker);
}

function getSortedListings() {
    const sort = sortListings?.value || "newest";
    const list = [...filteredListings];

    if (sort === "price_low") {
        return list.sort((a, b) => (Number.isFinite(a.price) ? a.price : Infinity) - (Number.isFinite(b.price) ? b.price : Infinity));
    }

    if (sort === "price_high") {
        return list.sort((a, b) => (Number.isFinite(b.price) ? b.price : -Infinity) - (Number.isFinite(a.price) ? a.price : -Infinity));
    }

    return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function renderListings() {
    const list = getSortedListings();
    listingsContainer.innerHTML = "";

    if (listCount) {
        listCount.textContent = `${list.length} listing${list.length === 1 ? "" : "s"} shown`;
    }

    if (!list.length) {
        listingsContainer.innerHTML = `<div class="empty">No listings match this view. Try clearing filters or adding a new listing.</div>`;
        return;
    }

    list.forEach((listing) => {
        const card = document.createElement("article");
        card.className = "cardRow";
        card.innerHTML = `
            <div class="cardTop">
                <div>
                    <span class="badge ${listing.type === "need" ? "need" : "have"}">${listing.type === "need" ? "Needs room" : "Room available"}</span>
                    <div class="cardTitle">${escapeHtml(listing.title)}</div>
                    <div class="cardMeta">${escapeHtml(listing.campus || "Campus not listed")} · ${priceText(listing.price)} · ${formatDate(listing.created_at)}</div>
                </div>
                ${isOwned(listing.id) ? `<span class="badge">Mine</span>` : ""}
            </div>
            ${listing.description ? `<p class="cardDesc">${escapeHtml(listing.description)}</p>` : ""}
            <div class="cardContact">Contact: ${escapeHtml(listing.contact || "Not listed")}</div>
            <div class="actions">
                <button class="btn" type="button" data-act="show">Show on map</button>
                <button class="btn" type="button" data-act="copy">Copy contact</button>
                ${isOwned(listing.id) ? `<button class="btn" type="button" data-act="del">Delete</button>` : ""}
            </div>
        `;

        card.querySelector('[data-act="show"]').addEventListener("click", () => {
            if (Number.isFinite(listing.lat) && Number.isFinite(listing.lng)) {
                showSection("map");
                map.setView([listing.lat, listing.lng], 16, { animate: true });
            } else {
                showSection("map");
                showToast("This listing has no map coordinates");
            }
        });

        card.querySelector('[data-act="copy"]').addEventListener("click", (event) => copyContact(event.currentTarget, listing.contact));

        const deleteButton = card.querySelector('[data-act="del"]');
        if (deleteButton) deleteButton.addEventListener("click", () => deleteListing(listing.id));

        listingsContainer.appendChild(card);
    });
}

if (sortListings) sortListings.addEventListener("change", renderListings);

window.copyContact = async function copyContact(button, text) {
    const value = text || "";
    try {
        if (!value) throw new Error("No contact listed");
        await navigator.clipboard.writeText(value);
        const original = button.textContent;
        button.textContent = "Copied";
        button.disabled = true;
        showToast("Contact copied");
        setTimeout(() => {
            button.textContent = original;
            button.disabled = false;
        }, 900);
    } catch (error) {
        console.warn(error);
        showToast(value ? "Copy failed" : "No contact listed");
    }
};

window.deleteListing = async function deleteListing(id) {
    if (!id) return;
    if (!confirm("Delete this listing?")) return;

    try {
        if (USE_SUPABASE) {
            const { error } = await sbClient.from("listings").delete().eq("id", id);
            if (error) throw error;
        } else {
            lsSave(lsLoad().filter((item) => String(item.id) !== String(id)));
        }

        removeOwnedId(id);
        await reloadData();
        showToast("Listing deleted");
    } catch (error) {
        console.error(error);
        showToast("Delete failed");
    }
};

/////////////////////////////
// 6) Filters: list + map  //
/////////////////////////////
const fKeyword = document.getElementById("filterKeyword");
const fType = document.getElementById("filterType");
const fCampus = document.getElementById("filterCampus");
const fMin = document.getElementById("filterMin");
const fMax = document.getElementById("filterMax");
const fMine = document.getElementById("filterMine");
const btnMyListings = document.getElementById("btnMyListings");

function applyFilters(showMap = true) {
    const keyword = (fKeyword.value || "").toLowerCase().trim();
    const type = fType.value;
    const campusName = fCampus.value;
    const min = fMin.value ? Number(fMin.value) : null;
    const max = fMax.value ? Number(fMax.value) : null;
    const mineOnly = !!(fMine && fMine.checked);
    const campusPoint = campusName ? campusPoints.find((campus) => campus.name === campusName) : null;

    if (min !== null && max !== null && min > max) {
        showToast("Minimum price cannot be higher than maximum price");
        return;
    }

    filteredListings = allListings.filter((listing) => {
        if (type && listing.type !== type) return false;
        if (mineOnly && !isOwned(listing.id)) return false;

        if (campusPoint) {
            const nearCampus = Number.isFinite(listing.lat) && Number.isFinite(listing.lng) &&
                haversineKm(listing.lat, listing.lng, campusPoint.lat, campusPoint.lng) <= 11;
            const campusTextMatch = (listing.campus || "").trim().toLowerCase() === campusName.toLowerCase();
            if (!nearCampus && !campusTextMatch) return false;
        }

        if (min !== null) {
            if (!Number.isFinite(listing.price) || listing.price < min) return false;
        }

        if (max !== null) {
            if (!Number.isFinite(listing.price) || listing.price > max) return false;
        }

        if (keyword) {
            const haystack = `${listing.title} ${listing.description} ${listing.campus} ${listing.contact}`.toLowerCase();
            if (!haystack.includes(keyword)) return false;
        }

        return true;
    });

    renderListingMarkers(filteredListings);
    renderListings();
    updateStats();

    if (showMap) {
        if (campusPoint) {
            map.setView([campusPoint.lat, campusPoint.lng], 13, { animate: true });
            showToast(`${filteredListings.length} listing${filteredListings.length === 1 ? "" : "s"} near ${campusPoint.name}`);
        } else {
            showToast(`${filteredListings.length} listing${filteredListings.length === 1 ? "" : "s"} found`);
        }
        showSection("map");
    }
}

function resetFilters(showToastMessage = true) {
    fKeyword.value = "";
    fType.value = "";
    fCampus.value = "";
    fMin.value = "";
    fMax.value = "";
    if (fMine) fMine.checked = false;
    filteredListings = [...allListings];
    renderListingMarkers(filteredListings);
    renderListings();
    updateStats();
    if (showToastMessage) showToast("Filters cleared");
}

document.getElementById("btnApplyFilters").addEventListener("click", () => applyFilters(true));
document.getElementById("btnClearFilters").addEventListener("click", () => resetFilters(true));

[fKeyword, fType, fCampus, fMin, fMax].forEach((control) => {
    control.addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyFilters(true);
    });
});

if (btnMyListings) {
    btnMyListings.addEventListener("click", () => {
        fMine.checked = true;
        applyFilters(false);
        showSection("list");
        showToast("Showing your listings");
    });
}

/////////////////////////////////////////////
// 7) Add listing + search + campus snap   //
/////////////////////////////////////////////
const listingForm = document.getElementById("listingForm");
const inputType = document.getElementById("inputType");
const inputCampus = document.getElementById("inputCampus");
const inputTitle = document.getElementById("inputTitle");
const inputDesc = document.getElementById("inputDesc");
const inputPrice = document.getElementById("inputPrice");
const inputContact = document.getElementById("inputContact");
const inputSearch = document.getElementById("inputSearch");
const btnSnapCampus = document.getElementById("btnSnapCampus");
const btnPost = document.getElementById("btnPost");
const postStatus = document.getElementById("postStatus");

function findCampusByName(name) {
    if (!name) return null;
    const normalized = name.trim().toLowerCase();
    return campusPoints.find((campus) => campus.name.toLowerCase() === normalized)
        || campusPoints.find((campus) => campus.name.toLowerCase().includes(normalized))
        || null;
}

function snapCampusToCoords() {
    const campus = findCampusByName(inputCampus.value);
    if (!campus) return null;

    inputLat.value = campus.lat.toFixed(6);
    inputLng.value = campus.lng.toFixed(6);
    showToast("Coordinates set from campus");
    return { lat: campus.lat, lng: campus.lng };
}

btnSnapCampus.addEventListener("click", () => {
    const point = snapCampusToCoords();
    if (!point) {
        showToast("Campus not found");
        return;
    }
    showSection("map");
    map.setView([point.lat, point.lng], 15, { animate: true });
});

async function smartGeocode({ title, description, campus }) {
    if (campus) {
        const campusPoint = snapCampusToCoords();
        if (campusPoint) return campusPoint;
    }

    const queryParts = [];
    if (title) queryParts.push(title);
    if (campus) queryParts.push(campus);
    if (!title && description) queryParts.push(description);
    queryParts.push("New York City, USA");

    try {
        const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(queryParts.join(", ").slice(0, 200));
        const response = await fetch(url, { headers: { "Accept-Language": "en" } });
        const results = await response.json();
        if (results?.length) return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
    } catch (error) {
        console.warn("Geocode failed", error);
    }
    return null;
}

function validateListingInput() {
    const title = inputTitle.value.trim();
    const contact = inputContact.value.trim();
    const price = inputPrice.value ? Number(inputPrice.value) : null;
    const lat = inputLat.value ? Number(inputLat.value) : NaN;
    const lng = inputLng.value ? Number(inputLng.value) : NaN;

    if (!title) return "Title is required.";
    if (!contact) return "Contact is required.";
    if (price !== null && (!Number.isFinite(price) || price < 0)) return "Price must be a positive number.";
    if ((inputLat.value && !Number.isFinite(lat)) || (inputLng.value && !Number.isFinite(lng))) return "Latitude and longitude must be valid numbers.";
    if ((inputLat.value && !inputLng.value) || (!inputLat.value && inputLng.value)) return "Add both latitude and longitude, or leave both empty.";
    return "";
}

function setPostStatus(message, kind = "") {
    postStatus.textContent = message;
    postStatus.classList.remove("ok", "err");
    if (kind) postStatus.classList.add(kind);
}

function clearAddForm() {
    inputType.value = "need";
    inputCampus.value = "";
    inputTitle.value = "";
    inputDesc.value = "";
    inputPrice.value = "";
    inputContact.value = "";
    inputLat.value = "";
    inputLng.value = "";
    inputSearch.value = "";
}

listingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const validationError = validateListingInput();
    if (validationError) {
        setPostStatus(validationError, "err");
        showToast(validationError);
        return;
    }

    setPostStatus("Posting...");
    btnPost.disabled = true;
    btnPost.textContent = "Posting...";

    if (!inputLat.value && !inputLng.value) {
        const geocoded = await smartGeocode({
            title: inputTitle.value,
            description: inputDesc.value,
            campus: inputCampus.value,
        });
        if (geocoded) {
            inputLat.value = geocoded.lat.toFixed(6);
            inputLng.value = geocoded.lng.toFixed(6);
        }
    }

    const listing = normalizeListing({
        id: `L${Date.now()}`,
        type: inputType.value || "need",
        campus: inputCampus.value.trim(),
        title: inputTitle.value.trim(),
        description: inputDesc.value.trim(),
        price: inputPrice.value ? Number(inputPrice.value) : null,
        contact: inputContact.value.trim(),
        lat: inputLat.value ? Number(inputLat.value) : NaN,
        lng: inputLng.value ? Number(inputLng.value) : NaN,
        created_at: new Date().toISOString(),
    });

    try {
        let savedListing = listing;

        if (USE_SUPABASE) {
            savedListing = await sbInsert(listing);
            addOwnedId(savedListing.id);
            allListings = await sbLoad();
        } else {
            const localListings = lsLoad().map(normalizeListing);
            localListings.unshift(savedListing);
            lsSave(localListings);
            addOwnedId(savedListing.id);
            allListings = localListings;
        }

        filteredListings = [...allListings];
        renderListingMarkers(filteredListings);
        renderListings();
        updateStats();
        setPostStatus("Posted successfully.", "ok");
        clearAddForm();
        refreshClearLocalButtonState();

        if (Number.isFinite(savedListing.lat) && Number.isFinite(savedListing.lng)) {
            showSection("map");
            map.setView([savedListing.lat, savedListing.lng], 16, { animate: true });
            showToast("Posted. Pin added to map.");
        } else {
            showSection("list");
            showToast("Posted without map pin.");
        }
    } catch (error) {
        console.error(error);
        const localListings = lsLoad().map(normalizeListing);
        localListings.unshift(listing);
        lsSave(localListings);
        addOwnedId(listing.id);
        allListings = localListings;
        filteredListings = [...allListings];
        renderListingMarkers(filteredListings);
        renderListings();
        updateStats();
        setPostStatus(`Cloud failed. Saved locally. ${error?.message || ""}`.trim(), "err");
        showToast("Saved locally");
    } finally {
        btnPost.disabled = false;
        btnPost.textContent = "Post listing";
    }
});

document.getElementById("btnSearch").addEventListener("click", async () => {
    const query = inputSearch.value.trim();
    if (!query) {
        showToast("Type a location first");
        return;
    }

    try {
        const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(query);
        const response = await fetch(url, { headers: { "Accept-Language": "en" } });
        const results = await response.json();

        if (!results.length) {
            showToast("No location found");
            return;
        }

        const { lat, lon, display_name } = results[0];
        const point = [Number(lat), Number(lon)];
        inputLat.value = Number(lat).toFixed(6);
        inputLng.value = Number(lon).toFixed(6);

        if (tempSearchMarker) map.removeLayer(tempSearchMarker);
        tempSearchMarker = L.marker(point, { title: "Search result" }).addTo(map).bindPopup(escapeHtml(display_name)).openPopup();

        showSection("map");
        map.setView(point, 15, { animate: true });
        showToast("Location picked");
    } catch (error) {
        console.error(error);
        showToast("Search failed");
    }
});

//////////////////////
// 8) Locate Me     //
//////////////////////
const btnLocateMe = document.getElementById("btnLocateMe");
const radiusChips = document.querySelectorAll(".radius-chips .chip");

radiusChips.forEach((chip) => {
    chip.addEventListener("click", () => {
        radiusChips.forEach((item) => item.classList.remove("chip-active"));
        chip.classList.add("chip-active");
        LOCATE_RADIUS_KM = Number(chip.dataset.radius) || 3;
        showToast(`Radius set to ${LOCATE_RADIUS_KM} km`);
    });
});

btnLocateMe.addEventListener("click", () => {
    if (!navigator.geolocation) {
        showToast("Geolocation not supported");
        return;
    }

    showToast("Locating...");
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = Math.min(position.coords.accuracy || 120, 300);

            userLayer.clearLayers();
            const marker = L.marker([lat, lng], { title: "You are here" }).addTo(userLayer);
            const circle = L.circle([lat, lng], {
                radius: accuracy + 150,
                color: "#3b82f6",
                weight: 1,
                fillColor: "#3b82f6",
                fillOpacity: 0.12,
            }).addTo(userLayer);
            marker.bindPopup("You are here").openPopup();

            filteredListings = allListings.filter((listing) =>
                Number.isFinite(listing.lat) && Number.isFinite(listing.lng) &&
                haversineKm(lat, lng, listing.lat, listing.lng) <= LOCATE_RADIUS_KM
            );

            renderListingMarkers(filteredListings);
            renderListings();
            updateStats();

            const group = L.featureGroup([marker, circle]);
            filteredListings.forEach((listing) => group.addLayer(L.marker([listing.lat, listing.lng])));
            map.fitBounds(group.getBounds().pad(0.25), { animate: true });
            showSection("map");
            showToast(`${filteredListings.length} listing${filteredListings.length === 1 ? "" : "s"} within ${LOCATE_RADIUS_KM} km`);
        },
        () => showToast("Location access denied"),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
});

//////////////////////
// 9) Helpers + boot //
//////////////////////
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function jsArg(value) {
    return escapeHtml(JSON.stringify(String(value ?? "")));
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (degrees) => degrees * Math.PI / 180;
    const radiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

function formatDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "Date not listed";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function updateStats() {
    const statTotal = document.getElementById("statTotal");
    const statHave = document.getElementById("statHave");
    const statNeed = document.getElementById("statNeed");
    const statCampus = document.getElementById("statCampus");

    if (statTotal) statTotal.textContent = String(filteredListings.length);
    if (statHave) statHave.textContent = String(filteredListings.filter((listing) => listing.type === "have").length);
    if (statNeed) statNeed.textContent = String(filteredListings.filter((listing) => listing.type === "need").length);
    if (statCampus) statCampus.textContent = String(new Set(campusPoints.map((campus) => campus.name)).size);
}

function refreshClearLocalButtonState() {
    if (!btnClearLocal) return;
    const hasLocal = lsLoad().length > 0;
    btnClearLocal.disabled = !hasLocal;
    btnClearLocal.title = hasLocal ? "Clear locally saved listings" : "Local cache is empty";
}

if (btnClearLocal) {
    btnClearLocal.addEventListener("click", async () => {
        clearLocalData();
        await reloadData();
        showToast("Local data cleared");
    });
}

function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 1600);
}

async function init() {
    renderListingMarkers([]);
    updateModeLabel();
    await loadCampuses();
    await reloadData();
}

init();
