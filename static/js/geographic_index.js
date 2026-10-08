import canonicalEntities from "../data/nis_entities.json" with { type: "json" };
import postcode2nis from "../data/postcode2nis.json" with { type: "json" };

/** Build identifier-only indexes over canonical geographic entities. */
export function createGeographicIndex(entities, postcodeMap = {}) {
  const byName = new Map();
  const byTypeAndName = new Map();

  const add = (map, key, nis) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(nis);
  };

  for (const [nis, entity] of Object.entries(entities)) {
    const names = new Set([entity.name, ...(entity.alternateNames || [])].map(normalizeGeographicName));
    for (const name of names) {
      add(byName, name, nis);
      add(byTypeAndName, `${entity.type}\u0000${name}`, nis);
    }

    // Brussels has no province; Any region with no provinces as children is also added in the province index.
    if (entity.type === "region" && (entity.childrenNis || []).every((child) => entities[child]?.type !== "province")) {
      for (const name of new Set([entity.name, ...(entity.alternateNames || [])].map(normalizeGeographicName))) {
        add(byTypeAndName, `province\u0000${name}`, entity.nis);
      }
    }
  }

  const lookup = (map, key) => [...(map.get(key) || [])];

  // Brussels has no province: its region stands in for one (see above)
  const hasType = (entity, type) =>
    entity.type === type ||
    (type === "province" && entity.type === "region" && (entity.childrenNis || []).every((c) => entities[c]?.type !== "province"));

  return Object.freeze({
    getEntityByNis(nis) {
      return typeof nis === "string" ? (entities[nis] ?? null) : null;
    },
    findByName(name) {
      return lookup(byName, normalizeGeographicName(name));
    },
    findByNameAndType(name, type) {
      return lookup(byTypeAndName, `${String(type).toLowerCase()}\u0000${normalizeGeographicName(name)}`);
    },
    // NIS is a 5 digit string. Returns [nis] when it exists and is an entity of the given type, [] otherwise
    findByNisAndType(nis, type) {
      const entity = typeof nis === "string" ? entities[nis] : null;
      return entity && hasType(entity, String(type).toLowerCase()) ? [nis] : [];
    },
    findByPostcode(postcode) {
      const key = String(postcode).trim();
      const nis = postcodeMap[key];
      return nis && entities[nis] ? [nis] : [];
    },
    getChildren(nis) {
      return entities[nis]?.childrenNis ?? [];
    },
    getParent(nis) {
      return entities[nis]?.parentNis ?? null;
    },
  });
}

/** Normalize geographic names consistently for indexing and lookup. */
export function normalizeGeographicName(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}

export const geographicIndex = createGeographicIndex(canonicalEntities, postcode2nis);
