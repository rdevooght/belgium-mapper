/**
 * Map Renderer Module
 * Handles Leaflet map initialization and choropleth rendering
 */

const MapRenderer = {
  map: null,
  currentLayer: null,
  geojsonCache: {},

  // Default color scales
  colorScales: {
    blue: [
      "#dbeafe",
      "#93c5fd",
      "#60a5fa",
      "#3b82f6",
      "#2563eb",
      "#1d4ed8",
      "#1e40af",
    ],
    green: [
      "#dcfce7",
      "#86efac",
      "#4ade80",
      "#22c55e",
      "#16a34a",
      "#15803d",
      "#166534",
    ],
    red: [
      "#fee2e2",
      "#fca5a5",
      "#f87171",
      "#ef4444",
      "#dc2626",
      "#b91c1c",
      "#991b1b",
    ],
    purple: [
      "#f3e8ff",
      "#d8b4fe",
      "#c084fc",
      "#a855f7",
      "#9333ea",
      "#7e22ce",
      "#6b21a8",
    ],
  },

  /**
   * Initialize the Leaflet map
   * @param {string} containerId - ID of the map container element
   */
  initMap(containerId) {
    if (this.map) {
      this.map.remove();
    }

    // Belgium center coordinates
    const belgiumCenter = [50.5, 4.5];

    this.map = L.map(containerId, {
      center: belgiumCenter,
      zoom: 8,
      minZoom: 7,
      maxZoom: 12,
    });

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.map);

    // Set bounds to Belgium
    const belgiumBounds = [
      [49.5, 2.5], // Southwest
      [51.5, 6.5], // Northeast
    ];
    this.map.setMaxBounds(belgiumBounds);

    return this.map;
  },

  /**
   * Load GeoJSON data for a given level
   * @param {'municipalities' | 'provinces' | 'regions'} level
   * @returns {Promise<Object>}
   */
  async loadGeoJSON(level) {
    if (this.geojsonCache[level]) {
      return this.geojsonCache[level];
    }

    const url = `geodata/${level}.geojson`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Impossible de charger ${level}.geojson`);
    }

    const geojson = await response.json();
    this.geojsonCache[level] = geojson;

    return geojson;
  },

  /**
   * Render a choropleth map
   * @param {Object} options
   * @param {'municipalities' | 'provinces' | 'regions'} options.level - Admin level
   * @param {Map<number, number>} options.data - NIS to value mapping
   * @param {string} options.valueColumn - Name of the value column (for tooltips)
   * @param {string} options.colorScale - Color scale name
   * @returns {Promise<Object>} Legend configuration
   */
  async renderChoropleth({ level, data, valueColumn, colorScale = "blue" }) {
    if (!this.map) {
      throw new Error("Map not initialized");
    }

    // Clear existing layer
    if (this.currentLayer) {
      this.map.removeLayer(this.currentLayer);
    }

    // Load GeoJSON
    const geojson = await this.loadGeoJSON(level);
    console.log(geojson);

    // Calculate value range
    const values = Array.from(data.values());
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);

    // Get color scale
    const colors = this.colorScales[colorScale] || this.colorScales.blue;

    // Create style function
    const getColor = (value) => {
      if (value === null || value === undefined) {
        return "#e5e7eb"; // Gray for no data
      }

      const range = maxValue - minValue;
      if (range === 0) return colors[Math.floor(colors.length / 2)];

      const normalized = (value - minValue) / range;
      const index = Math.min(
        Math.floor(normalized * colors.length),
        colors.length - 1,
      );
      return colors[index];
    };

    // Create GeoJSON layer
    this.currentLayer = L.geoJSON(geojson, {
      style: (feature) => {
        const nis = feature.properties.nis;
        const value = data.get(parseInt(nis)) ?? data.get(nis);

        return {
          fillColor: getColor(value),
          weight: 1,
          opacity: 1,
          color: "#94a3b8",
          fillOpacity: value !== undefined ? 0.8 : 0.3,
        };
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties;
        console.log(props);
        const nis = props.nis;
        const value = data.get(parseInt(nis)) ?? data.get(nis);

        // Get name
        const name =
          props.name_fr || props.name_nl || props.name_de || `NIS ${nis}`;

        // Create tooltip
        let tooltipContent = `<strong>${name}</strong>`;
        if (value !== undefined) {
          tooltipContent += `<br>${valueColumn}: ${this.formatValue(value)}`;
        } else {
          tooltipContent += "<br><em>Pas de données</em>";
        }

        layer.bindTooltip(tooltipContent, { sticky: true });

        // Hover effects
        layer.on({
          mouseover: (e) => {
            e.target.setStyle({
              weight: 2,
              color: "#1e293b",
              fillOpacity: 0.9,
            });
            e.target.bringToFront();
          },
          mouseout: (e) => {
            this.currentLayer.resetStyle(e.target);
          },
        });
      },
    }).addTo(this.map);

    // Fit to data bounds if we have data
    if (values.length > 0) {
      const bounds = this.currentLayer.getBounds();
      this.map.fitBounds(bounds, { padding: [20, 20] });
    }

    // Return legend configuration
    return {
      title: valueColumn,
      min: this.formatValue(minValue),
      max: this.formatValue(maxValue),
      gradient: `background: linear-gradient(to right, ${colors.join(", ")});`,
    };
  },

  /**
   * Render empty base layer (just the regions for context)
   * @param {'municipalities' | 'provinces' | 'regions'} level
   */
  async renderBaseLayer(level = "regions") {
    if (!this.map) {
      throw new Error("Map not initialized");
    }

    // Clear existing layer
    if (this.currentLayer) {
      this.map.removeLayer(this.currentLayer);
    }

    // Load GeoJSON
    const geojson = await this.loadGeoJSON(level);

    // Create minimal layer
    this.currentLayer = L.geoJSON(geojson, {
      style: {
        fillColor: "#f1f5f9",
        weight: 1,
        opacity: 1,
        color: "#94a3b8",
        fillOpacity: 0.5,
      },
      onEachFeature: (feature, layer) => {
        const name =
          feature.properties.name_fr || feature.properties.name_nl || "Unknown";
        layer.bindTooltip(name, { sticky: true });
      },
    }).addTo(this.map);

    // Fit to bounds
    const bounds = this.currentLayer.getBounds();
    this.map.fitBounds(bounds, { padding: [20, 20] });
  },

  /**
   * Clear the current layer
   */
  clearLayer() {
    if (this.currentLayer && this.map) {
      this.map.removeLayer(this.currentLayer);
      this.currentLayer = null;
    }
  },

  /**
   * Format a value for display
   * @param {number} value
   * @returns {string}
   */
  formatValue(value) {
    if (value === null || value === undefined) return "-";

    // Format large numbers with separators
    if (Number.isInteger(value)) {
      return value.toLocaleString("fr-BE");
    }

    // Format decimals
    return value.toLocaleString("fr-BE", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  },

  /**
   * Aggregate municipality data to provinces or regions
   * @param {Map<number, number>} municipalityData - NIS to value mapping at municipality level
   * @param {'provinces' | 'regions'} targetLevel
   * @returns {Map<number, number>}
   */
  aggregateToLevel(municipalityData, targetLevel) {
    const aggregated = new Map();

    for (const [nis, value] of municipalityData) {
      // Extract parent NIS from municipality NIS
      let parentNIS;
      const nisStr = String(nis);

      if (targetLevel === "provinces") {
        // Province NIS is first 2 digits * 10000
        parentNIS = parseInt(nisStr.substring(0, 2)) * 10000;
      } else if (targetLevel === "regions") {
        // Determine region from municipality NIS
        if (nisStr.startsWith("21")) {
          parentNIS = 4000; // Brussels
        } else if (
          ["1", "2", "3", "4"].includes(nisStr[0]) &&
          !nisStr.startsWith("21")
        ) {
          parentNIS = 2000; // Flanders
        } else {
          parentNIS = 3000; // Wallonia
        }
      }

      if (parentNIS) {
        const current = aggregated.get(parentNIS) || 0;
        aggregated.set(parentNIS, current + value);
      }
    }

    return aggregated;
  },
};
