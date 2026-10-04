import marimo

__generated_with = "0.25.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import csv
    import json
    import re
    from pathlib import Path
    import pandas as pd
    import unidecode

    import marimo as mo

    return csv, json, mo, pd, re, unidecode


@app.cell
def _():
    OUTPUT_FOLDER = '../static/data/'
    return (OUTPUT_FOLDER,)


@app.cell
def _(mo):
    mo.md(r"""
    # Hiérarchie NIS de la Belgique

    Transforme `TU_COM_REFNIS.csv` en JSON hiérarchique
    **région > province > arrondissement > commune**.

    Règles appliquées :

    - seules les entités **actuellement valides** sont conservées (`DT_VLDT_END = 31/12/9999`) ;
    - `name` = nom complet (avec qualificatif pour provinces et arrondissements,
      ex. « province d'anvers ») dans la langue principale de la zone (néerlandais en Flandre,
      français en Wallonie et à Bruxelles, allemand dans les 9 communes germanophones) ;
    - `alternateNames` = noms dans les 3 langues, avec et sans le qualificatif de niveau ;
    - tous les noms sont *trimmés*, en **minuscules**, avec des apostrophes droites (`'`) ;
    - Bruxelles n'a pas de province : un **niveau fictif** est inséré (voir `BRUSSELS_REGION`).
    """)
    return


@app.cell
def _(OUTPUT_FOLDER, mo):
    # --- Configuration ---------------------------------------------------------
    CSV_PATH = mo.notebook_dir() / "source_data/TU_COM_REFNIS.csv"
    OUTPUT_PATH = mo.notebook_dir() / OUTPUT_FOLDER / "nis_hierarchy.json"

    VALID_END = "31/12/9999"  # entités encore en vigueur

    LEVEL_REGION, LEVEL_PROVINCE, LEVEL_DISTRICT, LEVEL_MUNICIPALITY = "1", "2", "3", "4"

    # Langue principale par région (clé = NIS de la région)
    REGION_LANG = {"02000": "nl", "03000": "fr", "04000": "fr"}

    # Région de Bruxelles-Capitale : son arrondissement (21000) est rattaché
    # directement à la région, sans province. On insère donc un niveau fictif
    # ("province") portant le NIS et les noms de la région.
    BRUSSELS_REGION = "04000"

    # Communes germanophones (NIS) : leur langue principale est l'allemand
    GERMAN_SPEAKING = {
        "63001",  # Amel
        "63012",  # Büllingen
        "63013",  # Bütgenbach
        "63023",  # Eupen
        "63040",  # Kelmis
        "63048",  # Lontzen
        "63061",  # Raeren
        "63067",  # Sankt Vith
        "63087",  # Burg-Reuland
    }

    LANGS = ("fr", "nl", "de")  # ordre de repli pour les noms alternatifs
    return (
        BRUSSELS_REGION,
        CSV_PATH,
        GERMAN_SPEAKING,
        LANGS,
        LEVEL_DISTRICT,
        LEVEL_MUNICIPALITY,
        LEVEL_PROVINCE,
        LEVEL_REGION,
        OUTPUT_PATH,
        REGION_LANG,
        VALID_END,
    )


@app.cell
def _(CSV_PATH, VALID_END, csv):
    # --- Lecture : on ne garde que les lignes valides, indexées par niveau -----
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as _f:
        rows = [r for r in csv.DictReader(_f) if r["DT_VLDT_END"].strip() == VALID_END]

    rows_by_level: dict[str, list[dict]] = {}
    for _r in rows:
        rows_by_level.setdefault(_r["LVL_REFNIS"].strip(), []).append(_r)
    return (rows_by_level,)


@app.cell
def _(LANGS, re, unidecode):
    # --- Normalisation des noms ------------------------------------------------
    # Qualificatifs de niveau à retirer pour obtenir le « nom nu ».
    # Appliqué AVANT la mise en minuscules ("de La Louvière" ≠ "de la ").
    _ART = r"(?:de la |de l[’']|du |des |d[’']|de )?"
    SPECIFIER_RE = {
        "province": {
            "fr": re.compile(rf"^Province {_ART}"),
            "nl": re.compile(r"^Provincie "),
            "de": re.compile(r"^Provinz "),
        },
        "district": {
            "fr": re.compile(rf"^Arrondissement {_ART}"),
            "nl": re.compile(r"^Arrondissement "),
            "de": re.compile(r"^Bezirk "),
        },
    }

    # Qualificatif de commune (n'existe pas dans le CSV, on le construit)
    _VOWEL_RE = re.compile(r"^[aeiouyàâäéèêëîïôöùûüœ]", re.IGNORECASE)
    PAREN_RE = re.compile(r"\s*\([^)]*\)\s*$")  # « Forest (Bruxelles-Capitale) »

    def norm(text: str) -> str:
        """Trim + minuscules + espaces normalisés + apostrophes droites + remove -"""
        return " ".join(unidecode.unidecode(text).split()).lower().replace("’", "'").replace("-", " ")

    def strip_specifier(level: str, lang: str, raw: str) -> str:
        stripped = SPECIFIER_RE[level][lang].sub("", raw.strip(), count=1)
        if stripped == raw.strip():
            raise ValueError(f"Qualificatif {level}/{lang} introuvable dans {raw!r}")
        return stripped

    def municipality_specified(lang: str, bare: str) -> str:
        if lang == "fr":
            return f"commune d'{bare}" if _VOWEL_RE.match(bare) else f"commune de {bare}"
        return f"gemeente {bare}" if lang == "nl" else f"gemeinde {bare}"

    def unique(items):
        """Dédoublonne en conservant l'ordre."""
        return list(dict.fromkeys(items))

    def lang_order(main: str):
        """Langue principale d'abord, puis les autres dans l'ordre fr, nl, de."""
        return [main, *[l for l in LANGS if l != main]]

    return (
        PAREN_RE,
        lang_order,
        municipality_specified,
        norm,
        strip_specifier,
        unique,
    )


@app.cell
def _(
    GERMAN_SPEAKING,
    PAREN_RE,
    REGION_LANG,
    lang_order,
    municipality_specified,
    norm,
    strip_specifier,
    unique,
):
    # --- Construction des nœuds ------------------------------------------------
    def raw_names(row: dict) -> dict[str, str]:
        return {
            "fr": row["TX_REFNIS_FR"].strip(),
            "nl": row["TX_REFNIS_NL"].strip(),
            "de": row["TX_REFNIS_DE"].strip(),
        }

    def region_node(row: dict) -> dict:
        main = REGION_LANG[row["CD_REFNIS"]]
        raw = raw_names(row)
        order = lang_order(main)
        return {
            "nis": row["CD_REFNIS"],
            "name": raw[main],
            "alternateNames": unique(norm(raw[l]) for l in order),
        }

    def admin_node(row: dict, level_key: str, main: str) -> dict:
        """Province ou arrondissement : `name` garde le nom complet du CSV
        (« province d'anvers »), les noms nus restent en alternatives."""
        raw = raw_names(row)
        order = lang_order(main)
        bare = {l: strip_specifier(level_key, l, raw[l]) for l in order}
        return {
            "nis": row["CD_REFNIS"],
            "name": raw[main],
            "alternateNames": unique(
                [norm(raw[l]) for l in order] + [norm(bare[l]) for l in order]
            ),
        }

    def province_node(row: dict, main: str) -> dict:
        return admin_node(row, LEVEL_PROVINCE_KEY, main)

    def district_node(row: dict, main: str) -> dict:
        return admin_node(row, LEVEL_DISTRICT_KEY, main)

    def municipality_node(row: dict, main: str) -> dict:
        raw = raw_names(row)
        order = lang_order(main)
        # « Hove (Anvers) » -> « hove » ; la forme complète reste en alternative
        bare = {l: PAREN_RE.sub("", raw[l]).strip() for l in order}
        return {
            "nis": row["CD_REFNIS"],
            "name": raw[main],
            "alternateNames": unique(
                [norm(bare[l]) for l in order]
                + [norm(raw[l]) for l in order]
                + [norm(municipality_specified(l, bare[l])) for l in order]
            ),
        }

    def municipality_lang(nis: str, region_main: str) -> str:
        return "de" if nis in GERMAN_SPEAKING else region_main

    # Clés de niveau utilisées par SPECIFIER_RE
    LEVEL_PROVINCE_KEY = "province"
    LEVEL_DISTRICT_KEY = "district"
    return (
        district_node,
        municipality_lang,
        municipality_node,
        province_node,
        region_node,
    )


@app.cell
def _(
    BRUSSELS_REGION,
    LEVEL_DISTRICT,
    LEVEL_MUNICIPALITY,
    LEVEL_PROVINCE,
    LEVEL_REGION,
    REGION_LANG,
    district_node,
    municipality_lang,
    municipality_node,
    province_node,
    region_node,
    rows_by_level: dict[str, list[dict]],
):
    # --- Assemblage de l'arbre -------------------------------------------------
    def children(level: str, parent_nis: str) -> list[dict]:
        return sorted(
            (r for r in rows_by_level.get(level, []) if r["CD_SUP_REFNIS"].strip() == parent_nis),
            key=lambda r: r["CD_REFNIS"],
        )

    def build_municipalities(district_nis: str, region_main: str) -> list[dict]:
        return [
            municipality_node(r, municipality_lang(r["CD_REFNIS"], region_main))
            for r in children(LEVEL_MUNICIPALITY, district_nis)
        ]

    def build_districts(parent_nis: str, region_main: str) -> list[dict]:
        return [
            {**district_node(r, region_main), "municipalities": build_municipalities(r["CD_REFNIS"], region_main)}
            for r in children(LEVEL_DISTRICT, parent_nis)
        ]

    def build_region(region_row: dict) -> dict:
        nis = region_row["CD_REFNIS"]
        main = REGION_LANG[nis]
        node = region_node(region_row)

        if nis == BRUSSELS_REGION:
            # Niveau fictif : mêmes NIS et noms que la région ; l'arrondissement
            # réel (21000) est rattaché directement à la région dans le CSV.
            provinces = [{**region_node(region_row), "districts": build_districts(nis, main)}]
        else:
            provinces = [
                {**province_node(p, main), "districts": build_districts(p["CD_REFNIS"], main)}
                for p in children(LEVEL_PROVINCE, nis)
            ]
        return {**node, "provinces": provinces}

    hierarchy = {
        "regions": [build_region(r) for r in sorted(rows_by_level[LEVEL_REGION], key=lambda r: r["CD_REFNIS"])]
    }
    return (hierarchy,)


@app.cell
def _(hierarchy, norm):
    # Ajouts manuels

    MANUAL_ADD = {
        '02000': ['Flandre'],
        '03000': ['Wallonie'],
        '04000': ['Région Bruxelles Capitale', 'Bruxelles Capitale'],
    }

    def _walk(h):
        for reg in h["regions"]:
            yield reg
            for prov in reg["provinces"]:
                yield prov
                for dist in prov["districts"]:
                    yield dist
                    for mun in dist['municipalities']:
                        yield mun

    for entity in _walk(hierarchy):
        if entity['nis'] in MANUAL_ADD:
            entity['alternateNames'] = list(set(entity['alternateNames'] + [norm(x) for x in MANUAL_ADD[entity['nis']]]))

    return


@app.cell
def _(hierarchy, mo, norm, rows_by_level: dict[str, list[dict]]):
    # --- Contrôles d'intégrité -------------------------------------------------
    def _walk(h):
        for reg in h["regions"]:
            for prov in reg["provinces"]:
                for dist in prov["districts"]:
                    yield reg, prov, dist

    _n_prov = sum(len(r["provinces"]) for r in hierarchy["regions"])
    _n_dist = sum(len(p["districts"]) for r in hierarchy["regions"] for p in r["provinces"])
    _n_mun = sum(len(d["municipalities"]) for _, _, d in _walk(hierarchy))

    # Aucune entité orpheline : tout ce qui est valide dans le CSV est dans l'arbre
    assert _n_mun == len(rows_by_level["4"]), "communes orphelines"
    assert _n_dist == len(rows_by_level["3"]), "arrondissements orphelins"
    assert _n_prov - 1 == len(rows_by_level["2"]), "provinces orphelines (hors niveau fictif)"

    # Noms propres : trimés, minuscules, jamais vides
    def _names(h):
        for reg, prov, dist in _walk(h):
            for node in (reg, prov, dist, *dist["municipalities"]):
                yield node
    for _node in _names(hierarchy):
        for _n in (_node["name"], *_node["alternateNames"]):
            assert _n and _n == _n.strip(), f"nom invalide : {_n!r}"
        assert norm(_node["name"]) in _node["alternateNames"]

    mo.md(
        f"""
        ## Contrôles ✅

        | Niveau | Nombre |
        |---|---|
        | Régions | {len(hierarchy['regions'])} |
        | Provinces | {_n_prov - 1} (+ 1 niveau fictif pour Bruxelles) |
        | Arrondissements | {_n_dist} |
        | Communes | {_n_mun} |
        """
    )
    return


@app.cell
def _(hierarchy, mo):
    # --- Unicité des noms par niveau -------------------------------------------
    # Pour chaque niveau (sur toute la Belgique) :
    #   1. entités ayant le même nom principal (`name`) ;
    #   2. entités partageant au moins un nom, principal OU alternatif.
    # Les cas sont listés, pas rejetés : certains homonymes sont légitimes.

    _levels = {
        "Régions": [r for r in hierarchy["regions"]],
        "Provinces": [p for r in hierarchy["regions"] for p in r["provinces"]],
        "Arrondissements": [
            d for r in hierarchy["regions"] for p in r["provinces"] for d in p["districts"]
        ],
        "Communes": [
            m
            for r in hierarchy["regions"]
            for p in r["provinces"]
            for d in p["districts"]
            for m in d["municipalities"]
        ],
    }

    def _group(pairs):
        """[(clé, nis), ...] -> {clé: [nis triés]} ne gardant que les clés partagées."""
        grouped: dict[str, set[str]] = {}
        for _key, _nis in pairs:
            grouped.setdefault(_key, set()).add(_nis)
        return {k: sorted(v) for k, v in sorted(grouped.items()) if len(v) > 1}

    def _label(nodes_by_nis, nis_list):
        return ", ".join(f"{n} ({nodes_by_nis[n]['name']})" for n in nis_list)

    _sections = []
    for _level, _nodes in _levels.items():
        _by_nis = {n["nis"]: n for n in _nodes}

        # 1. Même nom principal
        _same_main = _group((n["name"], n["nis"]) for n in _nodes)

        # 2. Nom (principal ou alternatif) en commun
        _shared_any = _group(
            (_name, n["nis"]) for n in _nodes for _name in {n["name"], *n["alternateNames"]}
        )

        def _table(cases):
            if not cases:
                return ""
            _cases = [f"`{k}`: {_label(_by_nis, v)}" for k, v in cases.items()]
            return ",".join(_cases)


        if len(_same_main) or len(_shared_any):
            _sections.append(
                mo.md(
                    f"""
                    ### {_level} ({len(_nodes)})

                    **Même nom principal : {len(_same_main)} cas** {"\n" if len(_same_main) else ""}{_table(_same_main)}
        
                    **Nom principal ou alternatif en commun : {len(_shared_any)} cas** {"\n" if len(_shared_any) else ""}            {_table(_shared_any)}
                    """
                )
            )

    mo.vstack([mo.md("## Unicité des noms par niveau"), *_sections])
    return


@app.cell
def _(OUTPUT_PATH, hierarchy, json, mo):
    # --- Export ----------------------------------------------------------------
    OUTPUT_PATH.write_text(
        json.dumps(hierarchy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    mo.md(f"## Export\n\nFichier écrit : `{OUTPUT_PATH}`")
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md(r"""
    # Code postaux -> NIS
    """)
    return


@app.cell
def _(mo, pd):
    df = pd.read_csv(mo.notebook_dir() / 'source_data/Conversion Postal code_Refnis code_va01012019.csv', dtype={'Postal code': str, 'Refnis code': str}).rename(columns={'Postal code': 'postcode', 'Refnis code': 'nis'})
    df.head()
    return (df,)


@app.cell
def _(df):
    # postcode linked to multiple municipalities
    df[df.duplicated(subset='postcode', keep=False)]
    return


@app.cell
def _(df):
    # We manually select the best match by overwriting the non-desired ones
    df.loc[(df.postcode == '1040') & (df.nis == '21004'), 'nis'] = '21005' # 1040 Etterbeek
    df.loc[(df.postcode == '1050') & (df.nis == '21004'), 'nis'] = '21009' # 1050 Ixelles
    df.loc[(df.postcode == '1804') & (df.nis == '23088'), 'nis'] = '23096' # 1040 Zemst
    return


@app.cell
def _(df, mo):
    df[['postcode', 'nis']].drop_duplicates().set_index('postcode')['nis'].to_json(mo.notebook_dir() / '../postcode2nis.json')
    return


@app.cell
def _():
    return


if __name__ == "__main__":
    app.run()
