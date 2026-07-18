/**
 * Central source of truth for the Fablekin project directory structure.
 * This defines the standard folders, their UI display names, and tooltips.
 */

const CORE_FOLDER_MAP = {
  "1_Directives": {
    id: "directives",
    name: "Directives",
    tooltip: "THE NARRATIVE FOUNDATION (Director + Writer)\nEstablishes shared narrative behavior, persona, prose style, pacing, and boundaries. Injected into the shared system prefix used by both agents.\n\nSCOPE: Visible to Director and Writer. Agent-specific execution contracts belong in private suffixes."
  },
  "2_Lore_Book": {
    id: "lore_book",
    name: "Lore Book",
    tooltip: "SOURCE MATERIAL (Global Access)\nContains the central knowledge base and static reference data. Data residing here is globally accessible to all subsystems and agents (Writer, Director, Historian, Knowledge Graph)."
  },
  "3_Chronicles": {
    id: "chronicles",
    name: "Chronicles",
    tooltip: "LIVING HISTORY (Storage)\nThis is the save slots of the story. Contains active Chat Databases (.db)."
  },
  "4_Important": {
    id: "overrides",
    name: "Overrides",
    tooltip: "FINAL INSTRUCTIONS (Writer Only)\nHigh-priority Writer overrides injected in the private Writer suffix near the current action.\n\nSCOPE: Invisible to the Director/Orchestrator subsystems."
  }
};

const ASSET_FOLDERS = [
  "assets/sprites",
  "assets/backgrounds",
  "assets/ost",
  "assets/voices"
];

module.exports = {
  CORE_FOLDER_MAP,
  ASSET_FOLDERS,
  // Helper to get normalized folder IDs
  FOLDERS: {
    DIRECTIVES: "1_Directives",
    LORE_BOOK: "2_Lore_Book",
    CHRONICLES: "3_Chronicles",
    IMPORTANT: "4_Important"
  }
};
