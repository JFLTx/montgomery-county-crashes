import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import maplibregl from "maplibre-gl";
import * as d3 from "d3";
import { Protocol } from "pmtiles";

// Time groupings for slider
const timeGroups = [
  { label: "12:00 AM - 2:59 AM", range: [0, 259] },
  { label: "3:00 AM - 5:59 AM", range: [300, 559] },
  { label: "6:00 AM - 8:59 AM", range: [600, 859] },
  { label: "9:00 AM - 11:59 AM", range: [900, 1159] },
  { label: "12:00 PM - 2:59 PM", range: [1200, 1459] },
  { label: "3:00 PM - 5:59 PM", range: [1500, 1759] },
  { label: "6:00 PM - 8:59 PM", range: [1800, 2059] },
  { label: "9:00 PM - 11:59 PM", range: [2100, 2359] },
];

const kabcoItems = [
  { id: "K", label: "Fatal Crash", color: "#D10000", size: 8.5, visible: true },
  {
    id: "A",
    label: "Serious Injury Crash",
    color: "#fc551e",
    size: 7.75,
    visible: true,
  },
  {
    id: "B",
    label: "Minor Injury Crash",
    color: "#FF7F45",
    size: 7.25,
    visible: true,
  },
  {
    id: "C",
    label: "Possible Injury Crash",
    color: "#FFBF50",
    size: 6.75,
    visible: true,
  },
  {
    id: "O",
    label: "Property Damage Only",
    color: "#FFFF99",
    size: 6,
    visible: true,
  },
];

const hideHeat = 13.75;

// global state
let currentTimeIndex = -1; // -1 = all crashes
let allCrashFeatures = [];
let currentManner = "All";
let currentMode = "All";

function parseCollisionTime(value) {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();
  if (!str) return null;

  // handles "930", "0930", "15:42", "1542"
  const digits = str.replace(/\D/g, "");
  if (!digits) return null;

  const num = Number(digits);
  return Number.isNaN(num) ? null : num;
}

function buildTimeSlider() {
  if (document.querySelector(".time-slider")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "time-slider";
  wrapper.innerHTML = `
    <label class="slider-label">All Crashes</label>
    <input
      class="slider-range"
      type="range"
      min="0"
      max="${timeGroups.length}"
      step="1"
      value="0"
    />
    <div id="slider-controls">
    </div>
  `;

  document.body.appendChild(wrapper);

  const slider = wrapper.querySelector(".slider-range");
  const label = wrapper.querySelector(".slider-label");

  slider.addEventListener("input", () => {
    const sliderVal = Number(slider.value);

    // 0 = All Crashes, 1..8 = timeGroups[0..7]
    currentTimeIndex = sliderVal - 1;

    if (currentTimeIndex === -1) {
      label.textContent = "All Crashes";
    } else {
      label.textContent = timeGroups[currentTimeIndex].label;
    }

    filterBy();
  });
}

function getKabcoItem(id) {
  return kabcoItems.find((d) => d.id === id);
}

function getFilteredFeatures() {
  return allCrashFeatures.filter((feature) => {
    const props = feature.properties || {};
    const kabcoItem = getKabcoItem(props.KABCO);

    if (!kabcoItem || !kabcoItem.visible) return false;

    if (currentManner !== "All") {
      const manner = props.MannerofCollision?.trim() || "";
      if (manner !== currentManner) return false;
    }

    if (currentMode !== "All") {
      if (props.Mode !== currentMode) return false;
    }

    if (currentTimeIndex === -1) return true;

    const t = Number(props.CollisionTimeNum);
    if (Number.isNaN(t)) return false;

    const [minTime, maxTime] = timeGroups[currentTimeIndex].range;
    return t >= minTime && t <= maxTime;
  });
}

function getMannerFilter() {
  if (!currentManner || currentManner === "All") return null;
  return ["==", ["get", "MannerofCollision"], currentManner];
}

function getModeFilter() {
  if (!currentMode || currentMode === "All") return null;

  return ["==", ["get", "Mode"], currentMode];
}

function getManner() {
  const values = new Set();

  allCrashFeatures.forEach((feature) => {
    const val = feature.properties?.MannerofCollision?.trim();
    if (val) values.add(val);
  });

  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function getModes() {
  const modes = new Set();

  allCrashFeatures.forEach((feature) => {
    const mode = feature.properties?.Mode;
    if (mode) modes.add(mode);
  });

  return Array.from(modes).sort((a, b) => {
    if (a === "Motor Vehicle") return 1;
    if (b === "Motor Vehicle") return -1;
    return a.localeCompare(b);
  });
}

function updateCounts() {
  const features = getFilteredFeatures();

  kabcoItems.forEach((item) => {
    const count = features.filter(
      (feature) => feature.properties?.KABCO === item.id,
    ).length;

    const countEl = document.querySelector(
      `.kabco-count[data-kabco="${item.id}"]`,
    );

    if (countEl) {
      countEl.textContent = `(${count.toLocaleString()})`;
    }
  });
}

function buildLegend() {
  if (document.querySelector("#kabco-legend-panel")) return;

  const panel = document.createElement("div");
  panel.id = "kabco-legend-panel";
  panel.setAttribute("aria-hidden", "true");

  const title = document.createElement("div");
  title.className = "kabco-legend-title";
  title.textContent = "Crash Severity";
  panel.appendChild(title);

  kabcoItems.forEach((item) => {
    const row = document.createElement("label");
    row.className = "kabco-legend-row";

    row.innerHTML = `
      <input
        type="checkbox"
        class="kabco-toggle"
        data-kabco="${item.id}"
        ${item.visible ? "checked" : ""}
      >
      <span class="kabco-legend-swatch" style="
        width:${item.size * 2}px;
        height:${item.size * 2}px;
        background:${item.color};
      "></span>
      <span class="kabco-legend-label">${item.label}</span>
      <span class="kabco-count" data-kabco="${item.id}">(0)</span>
    `;

    panel.appendChild(row);
  });

  panel.querySelectorAll(".kabco-toggle").forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const kabcoId = e.target.dataset.kabco;
      const item = getKabcoItem(kabcoId);

      if (item) {
        item.visible = e.target.checked;
        filterBy();
      }
    });
  });

  const filterTitle = document.createElement("div");
  filterTitle.className = "kabco-legend-subtitle";
  filterTitle.textContent = "Additional Filters";
  panel.appendChild(filterTitle);

  const mannerWrap = document.createElement("div");
  mannerWrap.className = "kabco-filter-group";

  const mannerLabel = document.createElement("label");
  mannerLabel.className = "kabco-filter-label";
  mannerLabel.textContent = "Manner of Collision";
  mannerLabel.setAttribute("for", "manner-filter");

  const mannerSelect = document.createElement("select");
  mannerSelect.id = "manner-filter";
  mannerSelect.className = "kabco-filter-select";

  const allOption = document.createElement("option");
  allOption.value = "All";
  allOption.textContent = "All Collisions";
  mannerSelect.appendChild(allOption);

  getManner().forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    mannerSelect.appendChild(option);
  });

  mannerSelect.value = currentManner;

  mannerSelect.addEventListener("change", (e) => {
    currentManner = e.target.value;
    filterBy();
  });

  mannerWrap.appendChild(mannerLabel);
  mannerWrap.appendChild(mannerSelect);
  panel.appendChild(mannerWrap);

  const modeWrap = document.createElement("div");
  modeWrap.className = "kabco-filter-group";

  const modeLabel = document.createElement("label");
  modeLabel.className = "kabco-filter-label";
  modeLabel.textContent = "Mode";

  const modeSelect = document.createElement("select");
  modeSelect.className = "kabco-filter-select";
  modeSelect.id = "mode-filter";

  const allModeOption = document.createElement("option");
  allModeOption.value = "All";
  allModeOption.textContent = "All Modes";
  modeSelect.appendChild(allModeOption);

  getModes().forEach((mode) => {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode;
    modeSelect.appendChild(option);
  });

  modeSelect.value = currentMode;

  modeSelect.addEventListener("change", (e) => {
    currentMode = e.target.value;
    filterBy();
  });

  modeWrap.appendChild(modeLabel);
  modeWrap.appendChild(modeSelect);
  panel.appendChild(modeWrap);

  document.body.appendChild(panel);
}

function getCrashMode(dirAnalysisCode) {
  if (!dirAnalysisCode) return "Motor Vehicle";

  const val = String(dirAnalysisCode).toUpperCase();

  if (val.includes("PEDESTRIAN")) return "Pedestrian";
  if (val.includes("BICYCLIST")) return "Bicyclist";
  if (val.includes("MOTORCYCLIST")) return "Motorcyclist";

  return "Motor Vehicle";
}

function getKabcoVisibilityFilter(kabcoId) {
  const item = getKabcoItem(kabcoId);

  if (!item || !item.visible) {
    return ["==", ["get", "KABCO"], "__NONE__"];
  }

  return ["==", ["get", "KABCO"], kabcoId];
}

function getCombinedFilter(kabcoId) {
  const filters = [getKabcoVisibilityFilter(kabcoId)];

  const timeFilter = getTimeFilter();
  if (timeFilter) filters.push(timeFilter);

  const mannerFilter = getMannerFilter();
  if (mannerFilter) filters.push(mannerFilter);

  const modeFilter = getModeFilter();
  if (modeFilter) filters.push(modeFilter);

  return filters.length === 1 ? filters[0] : ["all", ...filters];
}

function getHeatKabcoFilter() {
  const activeKabco = kabcoItems
    .filter((item) => item.visible)
    .map((item) => item.id);

  if (activeKabco.length === 0) {
    return ["==", ["get", "KABCO"], "__NONE__"];
  }

  return ["in", ["get", "KABCO"], ["literal", activeKabco]];
}

function hideKabcoLegendPanel() {
  const panel = document.querySelector("#kabco-legend-panel");
  if (!panel) return;
  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
}

function toggleLegend() {
  const panel = document.querySelector("#kabco-legend-panel");
  const btn = document.querySelector(".maplegend_btn_ctrl");
  if (!panel || !btn) return;

  const isOpen = panel.classList.contains("is-open");

  if (isOpen) {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    return;
  }

  const btnRect = btn.getBoundingClientRect();

  // place panel to the left of the control stack
  panel.style.top = `${btnRect.top + window.scrollY - 8}px`;
  panel.style.left = `${btnRect.left + window.scrollX - panel.offsetWidth - 10}px`;
  panel.style.right = "auto";

  panel.classList.add("is-open");
  panel.setAttribute("aria-hidden", "false");
}

function buildHeatLegend() {
  if (document.querySelector("#heatmap-legend")) return;

  const legend = document.createElement("div");
  legend.id = "heatmap-legend";
  legend.innerHTML = `
    <div class="legend-title">Crash Density</div>
    <div class="heat-gradient-bar"></div>
    <div class="heat-gradient-labels">
      <span>Low</span>
      <span>High</span>
    </div>
  `;

  document.body.appendChild(legend);
}

function getTimeFilter() {
  if (currentTimeIndex === -1) return null;

  const [minTime, maxTime] = timeGroups[currentTimeIndex].range;

  return [
    "all",
    [">=", ["get", "CollisionTimeNum"], minTime],
    ["<=", ["get", "CollisionTimeNum"], maxTime],
  ];
}

function filterBy() {
  const kabcoLayerMap = {
    O: ["crashes-o"],
    C: ["crashes-c"],
    B: ["crashes-b"],
    A: ["crashes-a"],
    K: ["crashes-k", "crashes-k-pulse-outer", "crashes-k-pulse-inner"],
  };

  Object.entries(kabcoLayerMap).forEach(([kabcoId, layerIds]) => {
    const combinedFilter = getCombinedFilter(kabcoId);

    layerIds.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setFilter(layerId, combinedFilter);
      }
    });
  });

  if (map.getLayer("crashes-heat")) {
    const filters = [getHeatKabcoFilter()];

    const timeFilter = getTimeFilter();
    if (timeFilter) filters.push(timeFilter);

    const mannerFilter = getMannerFilter();
    if (mannerFilter) filters.push(mannerFilter);

    const modeFilter = getModeFilter();
    if (modeFilter) filters.push(modeFilter);

    const combined = filters.length === 1 ? filters[0] : ["all", ...filters];
    map.setFilter("crashes-heat", combined);
  }
  updateViz();
  updateCounts();
}

function updateViz() {
  const legend = document.querySelector("#heatmap-legend");
  if (!legend) return;

  const showLegend = map.getZoom() < hideHeat;
  legend.classList.toggle("fade-hidden", !showLegend);
}

const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const map = new maplibregl.Map({
  container: "map",
  center: [-85, 36],
  zoom: 5,
  maxPitch: 85,
  style: "./style.json",
});

map.on("load", async () => {
  const rows = await d3.csv("./data/crashes.csv");

  const features = rows
    .filter((d) => !isNaN(Number(d.Longitude)) && !isNaN(Number(d.Latitude)))
    .map((d) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [Number(d.Longitude), Number(d.Latitude)],
      },
      properties: {
        ...d,
        CollisionTimeNum: parseCollisionTime(d.CollisionTime),
        Mode: getCrashMode(d.DirAnalysisCode),
      },
    }));

  allCrashFeatures = features;

  const geojson = {
    type: "FeatureCollection",
    features,
  };

  map.addSource("crashes", {
    type: "geojson",
    data: geojson,
  });

  const insertBefore = "Place-labels-village-town-city";

  const crashStrokeWidth = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6,
    0.65,
    12,
    1,
    16,
    1.75,
  ];

  // constant styles for crash layers to pull from
  const crashLayerBase = {
    type: "circle",
    source: "crashes",
    paint: {
      "circle-opacity": 1,
      "circle-stroke-color": "#b3b3b3",
      "circle-stroke-width": crashStrokeWidth,
    },
  };

  // Pulse layer first so solid circles draw on top of them
  // Outer pulse first
  map.addLayer(
    {
      id: "crashes-k-pulse-outer",
      type: "circle",
      source: "crashes",
      filter: ["==", ["get", "KABCO"], "K"],
      paint: {
        "circle-color": "#ff1f1f",
        "circle-radius": 2,
        "circle-opacity": 0,
        "circle-stroke-width": 0,
        "circle-blur": 1.6,
      },
    },
    insertBefore,
  );

  // Inner pulse above outer pulse
  map.addLayer(
    {
      id: "crashes-k-pulse-inner",
      type: "circle",
      source: "crashes",
      filter: ["==", ["get", "KABCO"], "K"],
      paint: {
        "circle-color": "#ff0000",
        "circle-radius": 1.5,
        "circle-opacity": 0,
        "circle-stroke-width": 0,
        "circle-blur": 0.9,
      },
    },
    insertBefore,
  );

  map.addLayer(
    {
      ...crashLayerBase,
      id: "crashes-o",
      filter: ["==", ["get", "KABCO"], "O"],
      paint: {
        ...crashLayerBase.paint,
        "circle-color": "#FFFF99",
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          2.5,
          10,
          4,
          14,
          6,
        ],
      },
    },
    insertBefore,
  );

  map.addLayer(
    {
      ...crashLayerBase,
      id: "crashes-c",
      filter: ["==", ["get", "KABCO"], "C"],
      paint: {
        ...crashLayerBase.paint,
        "circle-color": "#FFBF50",
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          3,
          10,
          4.75,
          14,
          6.75,
        ],
      },
    },
    insertBefore,
  );

  map.addLayer(
    {
      ...crashLayerBase,
      id: "crashes-b",
      filter: ["==", ["get", "KABCO"], "B"],
      paint: {
        ...crashLayerBase.paint,
        "circle-color": "#FF7F45",
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          3.5,
          10,
          5.25,
          14,
          7.25,
        ],
      },
    },
    insertBefore,
  );

  map.addLayer(
    {
      ...crashLayerBase,
      id: "crashes-a",
      filter: ["==", ["get", "KABCO"], "A"],
      paint: {
        ...crashLayerBase.paint,
        "circle-color": "#fc551e",
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          4,
          10,
          5.75,
          14,
          7.75,
        ],
      },
    },
    insertBefore,
  );

  map.addLayer(
    {
      ...crashLayerBase,
      id: "crashes-k",
      filter: ["==", ["get", "KABCO"], "K"],
      paint: {
        ...crashLayerBase.paint,
        "circle-color": "#D10000",
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          4.5,
          10,
          6.5,
          14,
          8.5,
        ],
      },
    },
    insertBefore,
  );

  map.addLayer({
    id: "crashes-heat",
    type: "heatmap",
    source: "crashes",
    maxzoom: 14,
    paint: {
      "heatmap-weight": [
        "match",
        ["get", "KABCO"],
        "K",
        1,
        "A",
        0.85,
        "B",
        0.45,
        "C",
        0.3,
        "O",
        0.15,
        0.1,
      ],
      "heatmap-intensity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        0.8,
        10,
        1.4,
        14,
        2.2,
      ],
      "heatmap-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        10,
        10,
        22,
        14,
        34,
      ],
      "heatmap-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        0.85,
        12,
        0.6,
        14,
        0,
      ],
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(0,0,0,0)",
        0.2,
        "rgba(103,169,207,0.75)",
        0.4,
        "rgba(209,229,240,0.8)",
        0.6,
        "rgba(253,219,199,0.9)",
        0.8,
        "rgba(239,138,98,0.95)",
        1,
        "rgba(178,24,43,1)",
      ],
    },
  });

  if (features.length > 0) {
    const bounds = new maplibregl.LngLatBounds();

    features.forEach((feature) => {
      bounds.extend(feature.geometry.coordinates);
    });

    map.fitBounds(bounds, {
      padding: 75,
      duration: 1000,
      maxZoom: 14,
    });
  }

  // map controls on load, setting terrain
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();
  // map.setTerrain({
  //   source: "terrainSource",
  //   exaggeration: 1.25,
  // });

  // Add sky style to the map, giving an atmospheric effect
  map.setSky({
    "sky-color": "#61C2FEFF",
    "sky-horizon-blend": 0.5,
    "horizon-color": "#EBF1F4FF",
    "horizon-fog-blend": 0.5,
    "fog-color": "#B5B5B5FF",
    "fog-ground-blend": 0.5,
    "atmosphere-blend": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      1,
      10,
      1,
      12,
      0,
    ],
  });

  // Animate danger pulses for K crashes
  let animationFrameId;

  function animatePulse(timestamp) {
    const cycle = 1700;
    const t = (timestamp % cycle) / cycle;

    // OUTER pulse: bigger, softer, shorter visible life
    let outerRadius = 5;
    let outerOpacity = 0;

    if (t < 0.62) {
      const p = t / 0.62;
      outerRadius = 5 + p * 36;
      outerOpacity = Math.max(0, Math.min(1, 1.55 * Math.pow(1 - p, 1.55)));
    }

    // INNER pulse: tighter, brighter, slightly longer visible
    let innerRadius = 3;
    let innerOpacity = 0;

    if (t < 0.52) {
      const p = t / 0.52;
      innerRadius = 3 + p * 18;
      innerOpacity = Math.max(0, Math.min(1, 1.25 * Math.pow(1 - p, 1.05)));
    }

    if (map.getLayer("crashes-k-pulse-outer")) {
      map.setPaintProperty("crashes-k-pulse-outer", "circle-radius", [
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        outerRadius * 0.9,
        10,
        outerRadius,
        14,
        outerRadius * 1.12,
      ]);
      map.setPaintProperty(
        "crashes-k-pulse-outer",
        "circle-opacity",
        outerOpacity,
      );
    }

    if (map.getLayer("crashes-k-pulse-inner")) {
      map.setPaintProperty("crashes-k-pulse-inner", "circle-radius", [
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        innerRadius * 0.9,
        10,
        innerRadius,
        14,
        innerRadius * 1.1,
      ]);
      map.setPaintProperty(
        "crashes-k-pulse-inner",
        "circle-opacity",
        innerOpacity,
      );
    }

    animationFrameId = requestAnimationFrame(animatePulse);
  }

  animationFrameId = requestAnimationFrame(animatePulse);

  map.on("remove", () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  });

  buildTimeSlider();
  buildLegend();
  buildHeatLegend();
  filterBy();
  updateViz();

  map.on("zoom", updateViz);

  showHelpModal(); // shows the helper function window when the map loads
});

// handle blank values in the csv with a helper function
function safeValue(value) {
  if (value === null || value === undefined) return "Unknown";
  const str = String(value).trim();
  return str === "" ? "Unknown" : str;
}

function cleanFactor(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (
    str === "" ||
    str.toLowerCase() === "null" ||
    str.toLowerCase() === "unknown"
  ) {
    return null;
  }
  return str;
}

function kabcoLabel(kabco) {
  const val = safeValue(kabco);
  switch (val) {
    case "K":
      return "Fatal Crash";
    case "A":
      return "Serious Injury Crash";
    case "B":
      return "Minor Injury Crash";
    case "C":
      return "Possible Injury Crash";
    case "O":
      return "Property Damage Only";
    default:
      return "Unknown";
  }
}

function buildCrashPopupHTML(props, streetViewURL) {
  const kabco = kabcoLabel(props.KABCO);
  const roadwayName = safeValue(props.RoadwayName);
  const collisionTime = safeValue(props.CollisionTime);
  const weather = safeValue(props.Weather);
  const rdwyCondition = safeValue(props.RdwyConditionCode);
  const manner = safeValue(props.MannerofCollision);
  const suffix = props.StreetSfx ? ` ${props.StreetSfx}` : "";

  const milePointRaw = safeValue(props.Milepoint);
  const url = safeValue(streetViewURL);

  const environmental = cleanFactor(props.Environmental_Factors);
  const human = cleanFactor(props.Human_Factors);
  const vehicular = cleanFactor(props.Vehicular_Factors);

  const milePointHTML =
    streetViewURL !== "Unknown"
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${milePointRaw}</a>`
      : milePointRaw;

  const factorItems = [];
  if (environmental) factorItems.push(`<li>${environmental}</li>`);
  if (human) factorItems.push(`<li>${human}</li>`);
  if (vehicular) factorItems.push(`<li>${vehicular}</li>`);

  const factorsHTML =
    factorItems.length > 0
      ? `
        <div style="margin-top: 8px;">
          <div><strong>Factors:</strong></div>
          <ul style="margin: 4px 0 0 18px; padding: 0;">
            ${factorItems.join("")}
          </ul>
        </div>
      `
      : "";

  return `
    <div style="font-family: Libre Franklin, sans-serif; line-height: 1.4;">
      <div>
        <strong>${kabco}</strong> at MP ${milePointHTML} on ${roadwayName}${suffix} at ${collisionTime}
      </div>
      <div style="margin-top: 6px;">
        <strong>Conditions:</strong> ${weather}, ${rdwyCondition} Conditions
      </div>
      <div style="margin-top: 6px;">
        <strong>Manner of Collision:</strong> ${manner}
      </div>
      ${factorsHTML}
    </div>
  `;
}

const crashLayerIds = [
  "crashes-o",
  "crashes-c",
  "crashes-b",
  "crashes-a",
  "crashes-k",
];

const popup = new maplibregl.Popup({
  closeButton: true,
  closeOnClick: true,
  maxWidth: "320px",
});

crashLayerIds.forEach((layerId) => {
  map.on("click", layerId, (e) => {
    const feature = e.features && e.features[0];
    if (!feature) return;

    const coords = feature.geometry.coordinates.slice();
    const props = feature.properties || {};

    const [lon, lat] = coords;
    const svUrl = streetViewURL({ lon, lat });

    popup
      .setLngLat(coords)
      .setHTML(buildCrashPopupHTML(props, svUrl))
      .addTo(map);
  });

  map.on("mouseenter", layerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });

  map.on("mouseleave", layerId, () => {
    map.getCanvas().style.cursor = "";
  });
});

// ---- Help modal logic (no CSS injection needed) ----
function inputProfile() {
  const anyCoarse =
    window.matchMedia?.("(any-pointer: coarse)")?.matches || false;
  const anyHover = window.matchMedia?.("(any-hover: hover)")?.matches || false;
  const uaMobile =
    navigator.userAgentData?.mobile ||
    /Mobi|Android/i.test(navigator.userAgent);
  return {
    mobileLikely: (anyCoarse && !anyHover) || uaMobile,
    hybridLikely: anyCoarse && anyHover, // example: Surface + mouse
    desktopLikely: !anyCoarse && anyHover,
  };
}

const HELP_STORAGE_KEY = "dismissed";

function buildHelpHTML() {
  const p = inputProfile();
  // checks if the user is using a mouse and touchpad, returns hybrid help message
  if (p.hybridLikely) {
    return `
      <h3 class="title">How to use this map (Mouse & Touch)</h3>
      <ul class="list">
        <li><b>Pan:</b> left-click + drag • or one-finger drag</li>
        <li><b>Rotate/Tilt:</b> right-click + drag (or Ctrl + left-drag) • or two-finger drag</li>
        <li><b>Zoom:</b> mouse wheel/trackpad • or two-finger pinch</li>
        <li><b>Details:</b> click/tap a circle</li>
      </ul>
    `;
  }
  // checks if the user is on mobile, returns a mobile help message
  if (p.mobileLikely) {
    return `
      <h3 class="title">How to use this map (Mobile)</h3>
      <ul class="list">
        <li><b>Pan:</b> drag with one finger</li>
        <li><b>Zoom:</b> pinch with two fingers</li>
        <li><b>Rotate / Tilt:</b> twist or two-finger drag</li>
        <li><b>Details:</b> tap a circle</li>
      </ul>
    `;
  }
  // checks if the user is on desktop, returns a desktop help message
  return `
    <h3 class="title">How to use this map (Desktop)</h3>
    <ul class="list">
      <li><b>Pan:</b> left-click + drag</li>
      <li><b>Rotate / Tilt:</b> right-click + drag (or Ctrl + left-drag)</li>
      <li><b>Zoom:</b> mouse wheel / trackpad</li>
      <li><b>Details:</b> click a circle</li>
    </ul>
  `;
}

function showHelpModal({ force = false } = {}) {
  if (!force && localStorage.getItem(HELP_STORAGE_KEY) === "1") return;

  const backdrop = document.createElement("div");
  backdrop.className = "maphelp_backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "maphelp_modal";
  modal.innerHTML = `
    <button class="maphelp_close" aria-label="Close help">×</button>
    ${buildHelpHTML()}
    <div class="actions">
      <label class="remember">
        <input type="checkbox" id="maphelp_dont_show" /> Don’t show again
      </label>
      <button class="ok">Got it</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => {
    const dontShow = modal.querySelector("#maphelp_dont_show")?.checked;
    if (dontShow) localStorage.setItem(HELP_STORAGE_KEY, "1");
    backdrop.remove();
  };

  modal.querySelector(".maphelp_close").addEventListener("click", close);
  modal.querySelector(".ok").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && backdrop.isConnected) close();
    },
    { once: true },
  );
}

class LegendControl {
  onAdd(map) {
    this._map = map;

    const c = document.createElement("div");
    c.className = "maplibregl-ctrl maplibregl-ctrl-group maplegend-ctrl";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "maplegend_btn_ctrl";
    btn.setAttribute("aria-label", "Crash Legend");
    btn.setAttribute("title", "Crash Legend");

    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="5.5" width="2.5" height="2.5" rx="0.6"></rect>
        <line x1="10" y1="6.75" x2="18" y2="6.75" stroke-width="1.6" stroke-linecap="round"></line>

        <rect x="5" y="10.75" width="2.5" height="2.5" rx="0.6"></rect>
        <line x1="10" y1="12" x2="18" y2="12" stroke-width="1.6" stroke-linecap="round"></line>

        <rect x="5" y="16" width="2.5" height="2.5" rx="0.6"></rect>
        <line x1="10" y1="17.25" x2="18" y2="17.25" stroke-width="1.6" stroke-linecap="round"></line>
      </svg>
    `;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLegend();
    });

    c.appendChild(btn);
    this._container = c;
    return c;
  }

  onRemove() {
    this._container?.remove();
    this._map = undefined;
  }
}

class HelpControl {
  onAdd(map) {
    this._map = map;
    const c = document.createElement("div");
    c.className = "maplibregl-ctrl maplibregl-ctrl-group maphelp-ctrl";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "maphelp_btn_ctrl";
    btn.setAttribute("aria-label", "Map Help");
    btn.setAttribute("title", "Map Help");
    btn.innerHTML = "?";
    btn.addEventListener("click", () => showHelpModal({ force: true }));

    c.appendChild(btn);
    this._container = c;
    return c;
  }
  onRemove() {
    this._container?.remove();
    this._map = undefined;
  }
}

// download option to view crash data
class DownloadControl {
  onAdd(map) {
    this._map = map;

    const c = document.createElement("div");
    c.className = "maplibregl-ctrl maplibregl-ctrl-group mapdownload-ctrl";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mapdownload_btn_ctrl";
    btn.setAttribute("aria-label", "Download crash data");
    btn.setAttribute("title", "Download crash data");

    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v9"></path>
        <path d="M8.5 10.5 12 14l3.5-3.5"></path>
        <path d="M5 18.5h14"></path>
      </svg>
    `;

    btn.addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = "./data/crashes.csv";
      link.download = "crashes.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
    });

    c.appendChild(btn);
    this._container = c;
    return c;
  }

  onRemove() {
    this._container?.remove();
    this._map = undefined;
  }
}

document.addEventListener("click", (e) => {
  const panel = document.querySelector("#kabco-legend-panel");
  const legendBtn = document.querySelector(".maplegend_btn_ctrl");
  if (!panel || !legendBtn) return;

  const clickedInsidePanel = panel.contains(e.target);
  const clickedLegendBtn = legendBtn.contains(e.target);

  if (!clickedInsidePanel && !clickedLegendBtn) {
    hideKabcoLegendPanel();
  }
});

function streetViewURL({ lon, lat }) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}

// Add basic map controls
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.FullscreenControl());
map.addControl(
  new maplibregl.ScaleControl({
    maxWidth: 80,
    unit: "imperial",
  }),
);

// Add terrain control for 3D effect
map.addControl(
  new maplibregl.TerrainControl({
    source: "terrainSource",
    exaggeration: 1.25,
  }),
);

map.addControl(new LegendControl(), "top-right"); // legend control
map.addControl(new HelpControl(), "top-right"); // adds new helper control button
map.addControl(new DownloadControl(), "top-right"); // download button for users to view crashes on their own
