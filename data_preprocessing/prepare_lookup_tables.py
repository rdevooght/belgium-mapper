#!/usr/bin/env python3
"""
Prepare geodata for Belgium Mapper.

This script downloads Belgian statistical sectors data from Statbel,
dissolves it into municipalities/provinces/regions, and creates:
1. Simplified GeoJSON files for each administrative level
2. Lookup tables mapping postcodes, NIS codes, and names to entities
"""

# %%
import json
import re
from pathlib import Path
from typing import Any

import pandas as pd
from unidecode import unidecode

# %%
# Configuration
OUTPUT_DIR = Path(__file__).parent.parent / "geodata"
SOURCE_DATA_DIR = Path(__file__).parent / "source_data"


def normalize_string(s: str) -> str:
    """Normalize a string for matching."""
    s = s.strip().lower()
    s = unidecode(s)  # Remove accents
    s = s.replace("-", " ")
    s = re.sub(r"\s+", " ", s)
    return s


def load_postcode_mapping() -> dict[int, list[int]]:
    """Load postcode to NIS mapping from source data."""
    excel_path = SOURCE_DATA_DIR / "Conversion Postal code_Refnis code_va01012019.xlsx"
    df = pd.read_excel(excel_path)

    # Group postcodes by NIS code (some postcodes map to multiple municipalities)
    mapping: dict[int, list[int]] = {}
    for _, row in df.iterrows():
        postcode = int(row["Postal code"])
        nis = int(row["Refnis code"])
        if postcode not in mapping:
            mapping[postcode] = []
        if nis not in mapping[postcode]:
            mapping[postcode].append(nis)

    print(f"Loaded {len(mapping)} postcode mappings")
    return mapping


def load_nis_data() -> dict[str, Any]:
    """Load NIS codes and names from source data."""
    excel_path = SOURCE_DATA_DIR / "TU_COM_REFNIS.xlsx"
    df = pd.read_excel(excel_path, parse_dates=["DT_VLDT_START", "DT_VLDT_END"])

    # Handle date formatting
    df.loc[df["DT_VLDT_END"] == "31/12/9999", "DT_VLDT_END"] = pd.NaT

    levels = {
        "Region": 1,
        "Province": 2,
        "Arrondissement": 3,
        "Commune": 4,
    }

    nis_to_entity: dict[int, dict] = {}
    name_to_nis: dict[str, list[int]] = {}

    for level_name, level_id in levels.items():
        level_df = df[df["LVL_REFNIS"] == level_id]

        for _, row in level_df.iterrows():
            nis = int(row["CD_REFNIS"])

            # Get names in all languages
            names = []
            for lang_col in ["TX_REFNIS_FR", "TX_REFNIS_NL", "TX_REFNIS_DE"]:
                if lang_col in row and pd.notna(row[lang_col]):
                    names.append(str(row[lang_col]))

            # Check if still valid
            is_valid = pd.isna(row["DT_VLDT_END"])

            nis_to_entity[nis] = {
                "level": level_name,
                "names": names,
                "valid": is_valid,
            }

            # Add name mappings
            for name in names:
                norm_name = normalize_string(name)
                if norm_name not in name_to_nis:
                    name_to_nis[norm_name] = []
                if nis not in name_to_nis[norm_name]:
                    name_to_nis[norm_name].append(nis)

    # Also add commune names from postcode file
    postcode_path = (
        SOURCE_DATA_DIR / "Conversion Postal code_Refnis code_va01012019.xlsx"
    )
    pc_df = pd.read_excel(postcode_path)

    for _, row in pc_df.iterrows():
        nis = int(row["Refnis code"])
        for name_col in ["Nom commune", "Gemeentenaam"]:
            if name_col in row and pd.notna(row[name_col]):
                norm_name = normalize_string(str(row[name_col]))
                if norm_name not in name_to_nis:
                    name_to_nis[norm_name] = []
                if nis not in name_to_nis[norm_name]:
                    name_to_nis[norm_name].append(nis)

    print(
        f"Loaded {len(nis_to_entity)} NIS entities and {len(name_to_nis)} name mappings"
    )
    return {"nisToEntity": nis_to_entity, "nameToNis": name_to_nis}


def create_lookup_tables() -> None:
    """Create JavaScript lookup tables for the web app."""
    print("\nCreating lookup tables...")

    postcode_mapping = load_postcode_mapping()
    nis_data = load_nis_data()

    # Convert keys to strings for JSON compatibility
    postcode_to_nis = {str(k): v for k, v in postcode_mapping.items()}
    nis_to_entity = {str(k): v for k, v in nis_data["nisToEntity"].items()}

    lookups = {
        "postcodeToNis": postcode_to_nis,
        "nisToEntity": nis_to_entity,
        "nameToNis": nis_data["nameToNis"],
    }

    output_path = OUTPUT_DIR / "geo_lookups.js"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated lookup tables for Belgium geographic data\n")
        f.write("// Do not edit manually - regenerate with prepare_geodata.py\n\n")
        f.write("const geoLookups = ")
        json.dump(lookups, f, ensure_ascii=False, indent=2)
        f.write(";\n\n")
        f.write("// Export for ES modules\n")
        f.write('if (typeof module !== "undefined" && module.exports) {\n')
        f.write("  module.exports = geoLookups;\n")
        f.write("}\n")

    size_kb = output_path.stat().st_size / 1024
    print(f"Saved geo_lookups.js ({size_kb:.1f} KB)")


def main() -> None:
    """Main entry point."""
    print("Belgium Mapper - Geodata Preparation")
    print("=" * 50)

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Create lookup tables
    create_lookup_tables()

    print("\n" + "=" * 50)
    print("Geodata preparation complete!")


if __name__ == "__main__":
    main()
