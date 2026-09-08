#!/usr/bin/env python3
"""Convertit le fichier Excel de suivi de portefeuille en script SQL d'import.

Usage :
    python scripts/import_excel.py WF_1_1_26.xlsx

Produit db/import_donnees.sql (rejoué par scripts/migrate.js) et affiche un
rapport listant chaque correction apportée et chaque ligne écartée. Aucune
ligne du fichier source n'est jamais rejetée silencieusement.

Colonnes attendues (une ligne par contrat, feuille unique) :
Companie, Contrat, Code client Finasure, Type de contrat,
Souscripteur /Assuré, CIN ou matricule fiscale, N.Tel, Imm, Date d'effet,
Durée, FRACTIONNEMENT, Date fin, Echeance, Prime Totale, COM BRUT,
R/S 10%, COM NETTE, puis des colonnes sans en-tête pour le suivi des
règlements (non importées automatiquement, voir plus bas).
"""
import re
import sys
import uuid
from calendar import monthrange
from datetime import date, datetime
from pathlib import Path

import openpyxl

NB_COLONNES_TYPEES = 17  # Companie ... COM NETTE

FRACTIONNEMENTS_VALIDES = {
    'ANNUELLE': 'annuel',
    'SEMESTRIELLE': 'semestriel',
    'TRIMESTRIELLE': 'trimestriel',
    'UNIQUE': 'prime_unique',
}


def normaliser_texte(valeur):
    if valeur is None:
        return None
    texte = re.sub(r'\s+', ' ', str(valeur)).strip()
    return texte or None


def cle_ligne(valeurs):
    """Clé de comparaison brute, pour repérer les lignes dupliquées à l'identique."""
    cle = []
    for v in valeurs[:NB_COLONNES_TYPEES]:
        if isinstance(v, (datetime, date)):
            cle.append(v.isoformat())
        else:
            cle.append(normaliser_texte(v))
    return tuple(cle)


def normaliser_montant(valeur, anomalies, contexte):
    if valeur is None or (isinstance(valeur, str) and valeur.strip() == ''):
        return 0.0
    try:
        return round(float(valeur), 3)
    except (TypeError, ValueError):
        anomalies.append(f"{contexte} : montant illisible ({valeur!r}), ramené à 0.")
        return 0.0


def parser_date(valeur, anomalies, contexte):
    if isinstance(valeur, datetime):
        return valeur.date()
    if isinstance(valeur, date):
        return valeur

    texte = normaliser_texte(valeur)
    if not texte:
        return None

    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', texte)
    if m:
        jour, mois, annee = (int(x) for x in m.groups())
    else:
        # Ex. "12/082026" : jour, puis mois et année collés sans séparateur.
        m = re.match(r'^(\d{1,2})/(\d{6})$', texte)
        if not m:
            anomalies.append(f"{contexte} : date illisible ({texte!r}), ignorée.")
            return None
        jour = int(m.group(1))
        mois = int(m.group(2)[:2])
        annee = int(m.group(2)[2:])
        anomalies.append(f"{contexte} : date mal saisie ({texte!r}), corrigée en {jour:02d}/{mois:02d}/{annee}.")

    try:
        return date(annee, mois, jour)
    except ValueError:
        # Ex. 29/02/2027 : année non bissextile -> repli sur le jour précédent.
        try:
            corrige = date(annee, mois, jour - 1)
        except ValueError:
            anomalies.append(f"{contexte} : date invalide ({texte!r}), ignorée.")
            return None
        anomalies.append(
            f"{contexte} : date invalide ({texte!r}), corrigée en {corrige.strftime('%d/%m/%Y')}."
        )
        return corrige


def parser_duree_mois(valeur, anomalies, contexte):
    texte_brut = normaliser_texte(valeur) or ''
    texte = texte_brut.lower()

    m = re.search(r'(\d+)\s*an', texte)
    if m:
        return int(m.group(1)) * 12
    m = re.search(r'(\d+)\s*mois', texte)
    if m:
        return int(m.group(1))
    m = re.search(r'(\d+)\s*jour', texte)
    if m:
        anomalies.append(f"{contexte} : durée exprimée en jours ({texte_brut!r}), ramenée à 1 mois.")
        return 1
    if 'semestre' in texte:
        return 6

    anomalies.append(f"{contexte} : durée illisible ({texte_brut!r}), ramenée à 12 mois par défaut.")
    return 12


def ajouter_mois(date_initiale, nombre_mois):
    index_cible = date_initiale.month - 1 + nombre_mois
    annee = date_initiale.year + index_cible // 12
    mois = index_cible % 12 + 1
    jour = min(date_initiale.day, monthrange(annee, mois)[1])
    return date(annee, mois, jour)


def normaliser_fractionnement(valeur, anomalies, contexte):
    texte = (normaliser_texte(valeur) or '').upper()
    if texte in FRACTIONNEMENTS_VALIDES:
        return FRACTIONNEMENTS_VALIDES[texte]
    anomalies.append(
        f"{contexte} : fractionnement hors nomenclature ({texte!r}), ramené à 'prime_unique' "
        "(paiement en une fois sur la durée du contrat)."
    )
    return 'prime_unique'


def deviner_branche(type_contrat):
    t = (type_contrat or '').lower()
    if 'credit' in t or 'crédit' in t:
        return 'CREDIT'
    if 'voyage' in t:
        return 'VOYAGE'
    if 'vie' in t or 'deces' in t or 'décès' in t:
        return 'VIE'
    if 'auto' in t:
        return 'AUTO'
    if 'mrh' in t or 'mrb' in t or 'habitation' in t:
        return 'IARD'
    if 'accident' in t or 'sante' in t or 'santé' in t:
        return 'SANTE'
    return 'AUTRE'


def est_personne_morale(nom, matricule):
    nom_maj = (nom or '').strip().upper()
    if nom_maj == 'CIL' or nom_maj.startswith('STE') or 'SARL' in nom_maj:
        return True
    mat = (matricule or '').strip()
    return bool(mat) and mat[-1].isalpha()


def sql_texte(valeur):
    return 'null' if valeur is None else "'" + str(valeur).replace("'", "''") + "'"


def sql_nombre(valeur):
    return 'null' if valeur is None else repr(float(valeur))


def sql_date(valeur):
    return 'null' if valeur is None else "'" + valeur.isoformat() + "'"


def lire_lignes(chemin_excel):
    classeur = openpyxl.load_workbook(chemin_excel, data_only=True)
    feuille = classeur[classeur.sheetnames[0]]
    return list(feuille.iter_rows(min_row=2, values_only=True))


def extraire(lignes):
    anomalies = []
    lignes_ecartees = []
    lignes_vues = set()

    compagnies = {}   # code -> {id, nom}
    produits = {}       # (nom_bas, branche) -> {id, nom, branche}
    clients = {}         # clé de dédup -> {id, nom, cin, telephone, code_client_finasure, type_client}
    contrats = []
    notes_paiement = []  # (numero_contrat, texte) : suivi en texte libre non structuré, pour revue manuelle

    for indice, ligne in enumerate(lignes, start=2):
        valeurs = list(ligne) + [None] * max(0, NB_COLONNES_TYPEES - len(ligne))
        contexte = f"Ligne {indice}"

        cle = cle_ligne(valeurs)
        if all(v is None for v in cle):
            continue  # ligne totalement vide (bas de feuille)

        if cle in lignes_vues:
            lignes_ecartees.append(f"{contexte} : doublon exact d'une ligne précédente, ligne écartée.")
            continue
        lignes_vues.add(cle)

        compagnie_code = normaliser_texte(valeurs[0])
        numero_contrat = normaliser_texte(valeurs[1])
        code_client = normaliser_texte(valeurs[2])
        type_contrat = normaliser_texte(valeurs[3])
        souscripteur = normaliser_texte(valeurs[4])
        cin = normaliser_texte(valeurs[5])
        telephone = normaliser_texte(valeurs[6])
        immatriculation = normaliser_texte(valeurs[7])
        date_effet = parser_date(valeurs[8], anomalies, f"{contexte} (date d'effet)")
        duree_mois = parser_duree_mois(valeurs[9], anomalies, f"{contexte} (durée)")
        fractionnement = normaliser_fractionnement(valeurs[10], anomalies, f"{contexte} (fractionnement)")
        date_fin_source = parser_date(valeurs[11], anomalies, f"{contexte} (ancienne date fin)")
        prime_totale = normaliser_montant(valeurs[13], anomalies, f"{contexte} (prime totale)")
        com_brute = normaliser_montant(valeurs[14], anomalies, f"{contexte} (commission brute)")
        retenue_montant = normaliser_montant(valeurs[15], anomalies, f"{contexte} (retenue)")

        if not compagnie_code or not souscripteur or not date_effet:
            lignes_ecartees.append(
                f"{contexte} : compagnie, souscripteur ou date d'effet manquant — ligne écartée."
            )
            continue

        date_fin = ajouter_mois(date_effet, duree_mois)
        if date_fin_source and date_fin_source != date_fin:
            anomalies.append(
                f"{contexte} : l'ancienne date de fin ({date_fin_source}) est ignorée ; "
                f"la durée de {duree_mois} mois donne automatiquement {date_fin}."
            )

        taux_retenue = round(retenue_montant / com_brute, 4) if com_brute > 0 else 0.10
        if not (0 <= taux_retenue <= 1):
            anomalies.append(f"{contexte} : taux de retenue calculé hors limites ({taux_retenue}), ramené à 0.10.")
            taux_retenue = 0.10

        if compagnie_code not in compagnies:
            compagnies[compagnie_code] = {'id': str(uuid.uuid4()), 'nom': compagnie_code}

        branche = deviner_branche(type_contrat)
        cle_produit = ((type_contrat or 'Autre').lower(), branche)
        if cle_produit not in produits:
            produits[cle_produit] = {'id': str(uuid.uuid4()), 'nom': type_contrat or 'Autre', 'branche': branche}

        cin_norm = cin.strip() if cin else ''
        cle_client = ('cin', cin_norm) if cin_norm else ('nom', (souscripteur or '').strip().upper())

        if cle_client not in clients:
            clients[cle_client] = {
                'id': str(uuid.uuid4()),
                'nom': souscripteur,
                'cin': cin_norm or None,
                'telephone': telephone,
                'code_client_finasure': code_client,
                'type_client': 'personne_morale' if est_personne_morale(souscripteur, cin_norm) else 'personne_physique',
            }
        else:
            existant = clients[cle_client]
            existant['telephone'] = existant['telephone'] or telephone
            existant['code_client_finasure'] = existant['code_client_finasure'] or code_client

        contrats.append({
            'id': str(uuid.uuid4()),
            'numero_contrat': numero_contrat or f"SANS-NUMERO-L{indice}",
            'client_id': clients[cle_client]['id'],
            'compagnie_id': compagnies[compagnie_code]['id'],
            'produit_id': produits[cle_produit]['id'],
            'type_contrat': type_contrat,
            'immatriculation': immatriculation,
            'date_effet': date_effet,
            'duree_mois': duree_mois,
            'fractionnement': fractionnement,
            'date_fin': date_fin,
            'prime_totale': prime_totale,
            'com_brute': com_brute,
            'taux_retenue': taux_retenue,
        })

        texte_paiement = ' | '.join(
            normaliser_texte(v) for v in valeurs[NB_COLONNES_TYPEES:] if normaliser_texte(v)
        )
        if texte_paiement:
            notes_paiement.append((numero_contrat or f"ligne {indice}", texte_paiement))

    return {
        'compagnies': compagnies,
        'produits': produits,
        'clients': clients,
        'contrats': contrats,
        'anomalies': anomalies,
        'lignes_ecartees': lignes_ecartees,
        'notes_paiement': notes_paiement,
    }


def generer_sql(donnees):
    lignes = [
        "-- Généré par scripts/import_excel.py — ne pas modifier à la main.",
        "-- Réappliquer : régénérer ce fichier puis rejouer `npm run migrate`.",
        "begin;",
        "",
    ]

    lignes.append("-- Compagnies")
    for c in donnees['compagnies'].values():
        lignes.append(
            f"insert into compagnies (id, code, nom) values "
            f"({sql_texte(c['id'])}, {sql_texte(c['nom'])}, {sql_texte(c['nom'])}) "
            f"on conflict do nothing;"
        )

    lignes.append("")
    lignes.append("-- Produits")
    for p in donnees['produits'].values():
        lignes.append(
            f"insert into produits (id, nom, branche) values "
            f"({sql_texte(p['id'])}, {sql_texte(p['nom'])}, {sql_texte(p['branche'])});"
        )

    lignes.append("")
    lignes.append("-- Clients")
    for c in donnees['clients'].values():
        lignes.append(
            "insert into clients (id, type_client, nom, cin_ou_matricule, telephone, code_client_finasure) "
            f"values ({sql_texte(c['id'])}, {sql_texte(c['type_client'])}, {sql_texte(c['nom'])}, "
            f"{sql_texte(c['cin'])}, {sql_texte(c['telephone'])}, {sql_texte(c['code_client_finasure'])}) "
            "on conflict do nothing;"
        )

    lignes.append("")
    lignes.append("-- Contrats")
    for c in donnees['contrats']:
        lignes.append(
            "insert into contrats (id, numero_contrat, client_id, souscripteur_id, compagnie_id, produit_id, type_contrat, "
            "immatriculation, date_effet, duree_mois, fractionnement, date_fin, prime_totale, com_brute, taux_retenue) "
            f"values ({sql_texte(c['id'])}, {sql_texte(c['numero_contrat'])}, {sql_texte(c['client_id'])}, {sql_texte(c['client_id'])}, "
            f"{sql_texte(c['compagnie_id'])}, {sql_texte(c['produit_id'])}, {sql_texte(c['type_contrat'])}, "
            f"{sql_texte(c['immatriculation'])}, {sql_date(c['date_effet'])}, {c['duree_mois']}, "
            f"{sql_texte(c['fractionnement'])}, {sql_date(c['date_fin'])}, {sql_nombre(c['prime_totale'])}, "
            f"{sql_nombre(c['com_brute'])}, {c['taux_retenue']});"
        )

    lignes.append("")
    lignes.append("-- Échéanciers (générés à partir des contrats importés ci-dessus)")
    for c in donnees['contrats']:
        lignes.append(f"select generer_echeances({sql_texte(c['id'])});")

    # Cas validé par le cabinet : STE LABIDI RENT CAR règle le contrat 3611532
    # par un acompte déjà payé, puis cinq traites qui restent à encaisser.
    for c in donnees['contrats']:
        if c['numero_contrat'] == '3611532' and c['date_effet'] == date(2026, 6, 6):
            contrat_id = sql_texte(c['id'])
            lignes.append("")
            lignes.append("-- Échéancier personnalisé STE LABIDI RENT CAR")
            lignes.append(f"update contrats set echeancier_personnalise = true where id = {contrat_id};")
            lignes.append(f"update echeances set supprime_le = now() where contrat_id = {contrat_id};")
            lignes.append(
                "insert into echeances (contrat_id, type_echeance, numero_terme, date_echeance, montant_prime, montant_commission) values "
                f"({contrat_id}, 'terme', 1, date '2026-06-06', 13019.500, 0), "
                f"({contrat_id}, 'terme', 2, date '2026-08-01', 2600, 0), "
                f"({contrat_id}, 'terme', 3, date '2026-09-01', 2600, 0), "
                f"({contrat_id}, 'terme', 4, date '2026-10-01', 2600, 0), "
                f"({contrat_id}, 'terme', 5, date '2026-11-01', 2600, 0), "
                f"({contrat_id}, 'terme', 6, date '2026-12-01', 2600, 0) "
                "on conflict (contrat_id, numero_terme, type_echeance) do update set "
                "date_echeance = excluded.date_echeance, montant_prime = excluded.montant_prime, "
                "montant_commission = excluded.montant_commission, supprime_le = null, supprime_par = null;"
            )
            lignes.append(
                "insert into paiements (echeance_id, montant, mode_paiement, reference, date_paiement) "
                f"select id, 13019.500, 'autre', 'Import Excel : PAYEES 10 000 + 3 019,500', date '2026-06-06' "
                f"from echeances where contrat_id = {contrat_id} and type_echeance = 'terme' and numero_terme = 1;"
            )

    lignes.append("")
    lignes.append("commit;")
    return '\n'.join(lignes) + '\n'


def imprimer_rapport(donnees, chemin_sortie=None):
    tampon = []

    def ecrire(texte=''):
        tampon.append(texte)

    ecrire("=" * 78)
    ecrire("RAPPORT D'IMPORT — WF_1_1_26.xlsx")
    ecrire("=" * 78)
    ecrire(f"Compagnies créées   : {len(donnees['compagnies'])}")
    ecrire(f"Produits créés       : {len(donnees['produits'])}")
    ecrire(f"Clients créés        : {len(donnees['clients'])}")
    ecrire(f"Contrats créés       : {len(donnees['contrats'])}")
    ecrire(f"Lignes écartées      : {len(donnees['lignes_ecartees'])}")
    ecrire(f"Corrections apportées: {len(donnees['anomalies'])}")
    ecrire()

    if donnees['lignes_ecartees']:
        ecrire("--- Lignes écartées ---")
        for texte in donnees['lignes_ecartees']:
            ecrire(f"  - {texte}")
        ecrire()

    if donnees['anomalies']:
        ecrire("--- Corrections apportées ---")
        for texte in donnees['anomalies']:
            ecrire(f"  - {texte}")
        ecrire()

    if donnees['notes_paiement']:
        ecrire("--- Suivi de règlements en texte libre détecté (non importé automatiquement) ---")
        ecrire("    Ces annotations proviennent de colonnes sans en-tête du fichier source.")
        ecrire("    Saisissez les encaissements correspondants depuis l'application.")
        for numero, texte in donnees['notes_paiement']:
            ecrire(f"  - Contrat {numero} : {texte}")
        ecrire()

    rapport = '\n'.join(tampon)
    print(rapport)

    if chemin_sortie:
        chemin_sortie.write_text(rapport, encoding='utf-8')
        print(f"\nRapport également enregistré dans {chemin_sortie}")


def main():
    if len(sys.argv) < 2:
        print("Usage : python scripts/import_excel.py <fichier.xlsx>")
        sys.exit(1)

    chemin_excel = Path(sys.argv[1])
    if not chemin_excel.exists():
        print(f"Fichier introuvable : {chemin_excel}")
        sys.exit(1)

    lignes = lire_lignes(chemin_excel)
    donnees = extraire(lignes)

    dossier_db = Path(__file__).resolve().parent.parent / 'db'
    dossier_db.mkdir(exist_ok=True)

    chemin_sql = dossier_db / 'import_donnees.sql'
    chemin_sql.write_text(generer_sql(donnees), encoding='utf-8')
    print(f"Fichier généré : {chemin_sql}\n")

    imprimer_rapport(donnees, dossier_db / 'rapport_import.txt')


if __name__ == '__main__':
    main()
