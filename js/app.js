/**
 * Belgium Mapper - Main Application
 * Alpine.js component for the mapping application
 */

document.addEventListener("alpine:init", () => {
  Alpine.data("app", () => ({
    // State
    fileName: "",
    data: [],
    columns: [],
    numericColumns: [],

    // Detection
    detectedGeoColumn: null,
    columnAnalysis: {},

    // User selections
    selectedGeoColumn: "",
    selectedValueColumn: "",
    selectedColorScale: "blue",
    adminLevel: "municipalities",

    // Map state
    showLegend: false,
    legendConfig: null,

    // UI state
    isLoading: false,
    isDragging: false,
    errorMessage: "",

    // Initialize
    init() {
      // Initialize map when component is ready
      this.$nextTick(() => {
        MapRenderer.initMap("map");
        // Show base layer of regions initially
        MapRenderer.renderBaseLayer("regions");
      });
    },

    /**
     * Fit map bounds to current layer
     */
    fitMapBounds() {
      if (MapRenderer.currentLayer && MapRenderer.map) {
        const bounds = MapRenderer.currentLayer.getBounds();
        MapRenderer.map.fitBounds(bounds, { padding: [20, 20] });
      }
    },

    /**
     * Handle file drop
     */
    async handleDrop(event) {
      this.isDragging = false;

      const files = event.dataTransfer.files;
      if (files.length > 0) {
        await this.processFile(files[0]);
      }
    },

    /**
     * Handle file selection via input
     */
    async handleFileSelect(event) {
      const files = event.target.files;
      if (files.length > 0) {
        await this.processFile(files[0]);
      }
    },

    /**
     * Process an uploaded file
     */
    async processFile(file) {
      this.isLoading = true;
      this.errorMessage = "";

      try {
        // Parse file
        const result = await DataUploader.parseFile(file);

        this.fileName = file.name;
        this.data = result.data;
        this.columns = result.columns;

        // Analyze columns
        this.columnAnalysis = DataParser.analyzeColumns(
          this.data,
          this.columns,
        );

        // Detect numeric columns
        this.numericColumns = DataParser.detectValueColumns(
          this.data,
          this.columns,
        );

        // Auto-detect geographic column
        const detected = DataParser.detectGeoColumn(this.data, this.columns);
        if (detected) {
          this.detectedGeoColumn = {
            name: detected.column,
            type: this.getTypeLabel(detected.type),
            level: detected.level,
            rawType: detected.type,
          };
          this.selectedGeoColumn = detected.column;

          // Set appropriate admin level based on detection
          if (detected.level === "Commune" || detected.type === "postcode") {
            this.adminLevel = "municipalities";
          } else if (detected.level === "Province") {
            this.adminLevel = "provinces";
          } else if (detected.level === "Region") {
            this.adminLevel = "regions";
          }
        }

        // Auto-select first numeric column
        if (this.numericColumns.length > 0) {
          this.selectedValueColumn = this.numericColumns[0];
        }

        // Update map if we have selections
        if (this.selectedGeoColumn && this.selectedValueColumn) {
          await this.updateMap();
        }
      } catch (error) {
        console.error("Error processing file:", error);
        this.errorMessage =
          error.message || "Erreur lors du traitement du fichier";
      } finally {
        this.isLoading = false;
      }
    },

    /**
     * Update the map with current selections
     */
    async updateMap() {
      if (!this.selectedGeoColumn || !this.selectedValueColumn) {
        return;
      }

      this.isLoading = true;
      this.errorMessage = "";

      try {
        // Get the geo type for the selected column
        const colInfo = this.columnAnalysis[this.selectedGeoColumn];
        const geoType = colInfo?.type || "name";

        // Map data to NIS codes (always at municipality level first)
        const nisMapping = DataParser.mapToNIS(
          this.data,
          this.selectedGeoColumn,
          geoType,
        );

        // Aggregate values by NIS
        let aggregatedData = DataParser.aggregateByNIS(
          nisMapping,
          this.selectedValueColumn,
          "sum",
        );

        // If not at municipality level, aggregate up
        if (this.adminLevel !== "municipalities") {
          aggregatedData = MapRenderer.aggregateToLevel(
            aggregatedData,
            this.adminLevel,
          );
        }

        // Render choropleth
        this.legendConfig = await MapRenderer.renderChoropleth({
          level: this.adminLevel,
          data: aggregatedData,
          valueColumn: this.selectedValueColumn,
          colorScale: this.selectedColorScale,
        });
        console.log(this.adminLevel);

        this.showLegend = true;
      } catch (error) {
        console.error("Error updating map:", error);
        this.errorMessage =
          error.message || "Erreur lors de la mise à jour de la carte";
        this.showLegend = false;
      } finally {
        this.isLoading = false;
      }
    },

    /**
     * Get human-readable label for geo type
     */
    getTypeLabel(type) {
      const labels = {
        postcode: "Code postal",
        nis: "Code NIS",
        name: "Nom géographique",
        numeric: "Numérique",
        other: "Texte",
      };
      return labels[type] || type;
    },
  }));
});
