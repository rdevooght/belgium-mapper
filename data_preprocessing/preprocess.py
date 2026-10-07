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

    Transforme `TU_COM_REFNIS.csv` en une **table plate d'entités indexée par code NIS**
    (`static/data/nis_entities.json`). La hiérarchie
    **région > province > arrondissement > commune** n'est plus imbriquée : elle se
    reconstruit avec `parentNis` / `childrenNis`.

    Règles appliquées :

    - seules les entités **actuellement valides** sont conservées (`DT_VLDT_END = 31/12/9999`) ;
    - `name` = nom complet (avec qualificatif pour provinces et arrondissements,
      ex. « province d'anvers ») dans la langue principale de la zone (néerlandais en Flandre,
      français en Wallonie et à Bruxelles, allemand dans les 9 communes germanophones) ;
    - `alternateNames` = noms dans les 3 langues, avec et sans le qualificatif de niveau ;
    - tous les noms sont *trimmés*, en **minuscules**, avec des apostrophes droites (`'`) ;
    - une seule entité par NIS, clés et valeurs NIS toujours en **chaînes** de 5 chiffres
      (zéros initiaux conservés) ;
    - Bruxelles n'a pas de province : l'arrondissement 21000 a directement la région
      (04000) pour parent (aucun niveau fictif : ça produirait deux entités avec le NIS 04000) ;
    - le fichier ne contient aucun index applicatif (ex. nom → NIS) : ils se construisent
      à l'exécution côté JavaScript.
    """)
    return


@app.cell
def _(OUTPUT_FOLDER, mo):
    # --- Configuration ---------------------------------------------------------
    CSV_PATH = mo.notebook_dir() / "source_data/TU_COM_REFNIS.csv"
    OUTPUT_PATH = mo.notebook_dir() / OUTPUT_FOLDER / "nis_entities.json"

    VALID_END = "31/12/9999"  # entités encore en vigueur

    LEVEL_REGION, LEVEL_PROVINCE, LEVEL_DISTRICT, LEVEL_MUNICIPALITY = "1", "2", "3", "4"

    # Langue principale par région (clé = NIS de la région)
    REGION_LANG = {"02000": "nl", "03000": "fr", "04000": "fr"}

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
    # --- Assemblage de la table plate -----------------------------------------
    # Une entité par NIS. La hiérarchie est portée par `parentNis` (lu dans
    # CD_SUP_REFNIS) et `childrenNis`. On parcourt les niveaux de haut en bas :
    # le parent existe donc toujours quand on ajoute un enfant.
    #
    # Bruxelles n'a pas de province : l'arrondissement 21000 a pour parent la
    # région 04000, comme dans le CSV.
    entities: dict[str, dict] = {}
    main_lang: dict[str, str] = {}  # NIS -> langue principale (héritée de la région)

    def add_entity(node: dict, entity_type: str, parent_nis: str | None, main: str) -> None:
        nis = node["nis"]
        if nis in entities:
            raise ValueError(f"NIS en double : {nis}")
        entities[nis] = {
            "nis": nis,
            "type": entity_type,
            "name": node["name"],
            "alternateNames": node["alternateNames"],
            "parentNis": parent_nis,
            "childrenNis": [],
        }
        main_lang[nis] = main
        if parent_nis is not None:
            entities[parent_nis]["childrenNis"].append(nis)

    def sorted_rows(level: str) -> list[dict]:
        return sorted(rows_by_level.get(level, []), key=lambda r: r["CD_REFNIS"])

    for _r in sorted_rows(LEVEL_REGION):
        add_entity(region_node(_r), "region", None, REGION_LANG[_r["CD_REFNIS"]])

    for _level, _type, _build in (
        (LEVEL_PROVINCE, "province", province_node),
        (LEVEL_DISTRICT, "district", district_node),
        (LEVEL_MUNICIPALITY, "municipality", municipality_node),
    ):
        for _r in sorted_rows(_level):
            _parent = _r["CD_SUP_REFNIS"].strip()
            if _parent not in entities:
                raise ValueError(f"Parent {_parent} introuvable pour {_r['CD_REFNIS']} (entité orpheline)")
            _main = main_lang[_parent]
            if _type == "municipality":
                _main = municipality_lang(_r["CD_REFNIS"], _main)
            add_entity(_build(_r, _main), _type, _parent, _main)
    return (entities,)


@app.cell
def _(entities: dict[str, dict], norm, unique):
    # Ajouts manuels

    MANUAL_ADD = {
        '02000': ['Flandre'],
        '03000': ['Wallonie'],
        '04000': ['Région Bruxelles Capitale', 'Bruxelles Capitale'],
    }

    for _nis, _extra in MANUAL_ADD.items():
        _entity = entities[_nis]
        # `unique` (et non `set`) : l'ordre reste déterministe d'une exécution à l'autre
        _entity['alternateNames'] = unique(_entity['alternateNames'] + [norm(x) for x in _extra])
    return


@app.cell
def _(
    entities: dict[str, dict],
    mo,
    norm,
    re,
    rows_by_level: dict[str, list[dict]],
):
    # --- Contrôles d'intégrité -------------------------------------------------
    # Types de parent autorisés. Bruxelles : un arrondissement peut avoir une région pour parent.
    ALLOWED_PARENT_TYPES = {
        "region": {None},
        "province": {"region"},
        "district": {"province", "region"},
        "municipality": {"district"},
    }

    _count = {_t: sum(1 for _e in entities.values() if _e["type"] == _t) for _t in ALLOWED_PARENT_TYPES}

    # Aucune entité perdue : tout ce qui est valide dans le CSV est dans la table
    assert _count["municipality"] == len(rows_by_level["4"]), "communes manquantes"
    assert _count["district"] == len(rows_by_level["3"]), "arrondissements manquants"
    assert _count["province"] == len(rows_by_level["2"]), "provinces manquantes"
    assert _count["region"] == len(rows_by_level["1"]), "régions manquantes"

    for _nis, _e in entities.items():
        # Un NIS est une chaîne de 5 chiffres (zéros initiaux conservés), identique à sa clé
        assert isinstance(_nis, str) and re.fullmatch(r"\d{5}", _nis), f"NIS invalide : {_nis!r}"
        assert _e["nis"] == _nis, f"clé et nis différents : {_nis!r} / {_e['nis']!r}"
        assert _e["type"] in ALLOWED_PARENT_TYPES, f"type inconnu : {_e['type']!r}"

        # Parent : existe, de type cohérent, et nous liste parmi ses enfants
        _parent_nis = _e["parentNis"]
        if _parent_nis is None:
            assert None in ALLOWED_PARENT_TYPES[_e["type"]], f"{_nis} sans parent"
        else:
            assert isinstance(_parent_nis, str), f"parentNis non textuel : {_nis}"
            assert _parent_nis in entities, f"parentNis inconnu : {_nis} -> {_parent_nis}"
            assert entities[_parent_nis]["type"] in ALLOWED_PARENT_TYPES[_e["type"]], f"parent incohérent : {_nis}"
            assert _nis in entities[_parent_nis]["childrenNis"], f"{_nis} absent des enfants de {_parent_nis}"

        # Enfants : existent, sans doublon, et nous ont pour parent
        assert len(set(_e["childrenNis"])) == len(_e["childrenNis"]), f"enfants en double : {_nis}"
        for _child_nis in _e["childrenNis"]:
            assert isinstance(_child_nis, str), f"childNis non textuel : {_nis}"
            assert _child_nis in entities, f"childNis inconnu : {_nis} -> {_child_nis}"
            assert entities[_child_nis]["parentNis"] == _nis, f"{_child_nis} n'a pas {_nis} pour parent"

        # Noms propres : trimés, jamais vides
        for _n in (_e["name"], *_e["alternateNames"]):
            assert _n and _n == _n.strip(), f"nom invalide : {_n!r}"
        assert norm(_e["name"]) in _e["alternateNames"]

    mo.md(
        f"""
        ## Contrôles ✅

        | Niveau | Nombre |
        |---|---|
        | Régions | {_count['region']} |
        | Provinces | {_count['province']} |
        | Arrondissements | {_count['district']} |
        | Communes | {_count['municipality']} |
        """
    )
    return


@app.cell
def _(entities: dict[str, dict], mo):
    # --- Unicité des noms par niveau -------------------------------------------
    # Pour chaque niveau (sur toute la Belgique) :
    #   1. entités ayant le même nom principal (`name`) ;
    #   2. entités partageant au moins un nom, principal OU alternatif.
    # Les cas sont listés, pas rejetés : certains homonymes sont légitimes.

    _levels = {
        _label: [_e for _e in entities.values() if _e["type"] == _type]
        for _label, _type in (
            ("Régions", "region"),
            ("Provinces", "province"),
            ("Arrondissements", "district"),
            ("Communes", "municipality"),
        )
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
def _(OUTPUT_PATH, entities: dict[str, dict], json, mo):
    # --- Export ----------------------------------------------------------------
    # Table plate triée par NIS (diffs stables). Les clés JSON sont toujours textuelles,
    # et `nis`, `parentNis`, `childrenNis` sont des chaînes (zéros initiaux conservés).
    _flat = dict(sorted(entities.items()))
    OUTPUT_PATH.write_text(
        json.dumps(_flat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
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
def _(OUTPUT_FOLDER, df, mo):
    df[['postcode', 'nis']].drop_duplicates().set_index('postcode')['nis'].to_json(mo.notebook_dir() / OUTPUT_FOLDER / 'postcode2nis.json')
    return


@app.cell
def _():
    return


if __name__ == "__main__":
    app.run()
