'use strict';

const { calculerDateFin } = require('./dates-contrat');
const { moisDuFractionnement } = require('./regles-contrat');

function calculerDateTerme(dateEffet, fractionnement, numeroTerme) {
  const mois = moisDuFractionnement(fractionnement);
  const numero = Number(numeroTerme);
  if (!mois || !Number.isInteger(numero) || numero < 1) return null;
  return calculerDateFin(dateEffet, mois * numero);
}

function calculerNumerosTermes(dateEffet, fractionnement, dateFin) {
  const mois = moisDuFractionnement(fractionnement);
  if (!mois || !dateFin) return [];
  const numeros = [];
  for (let numero = 1; numero <= 10000; numero += 1) {
    const date = calculerDateTerme(dateEffet, fractionnement, numero);
    if (!date || date > dateFin) break;
    numeros.push(numero);
  }
  return numeros;
}

async function enregistrerPaiementInitial(client, contrat, utilisateurId, paiement = {}) {
  const echeance = await client.query(
    `insert into echeances (
       contrat_id, type_echeance, numero_terme, date_echeance, montant_prime, montant_commission
     ) values ($1, 'terme', 0, $2, $3, $4)
     returning *`,
    [contrat.id, contrat.date_effet, contrat.prime_totale, contrat.com_brute || 0]
  );
  const feuilleCaisse = paiement.feuilleCaisse === true;
  const encaissement = await client.query(
    `insert into paiements (
       echeance_id, montant, mode_paiement, reference, date_paiement,
       feuille_caisse, com_nette, com_nette_saisie, date_feuille_caisse, saisi_par
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning *`,
    [
      echeance.rows[0].id,
      contrat.prime_totale,
      paiement.modePaiement || 'autre',
      paiement.reference || 'Paiement initial à la souscription',
      contrat.date_effet,
      feuilleCaisse,
      feuilleCaisse ? paiement.commissionNette : null,
      feuilleCaisse ? paiement.commissionNetteSaisie : null,
      feuilleCaisse ? contrat.date_effet : null,
      utilisateurId,
    ]
  );
  return { echeance: echeance.rows[0], paiement: encaissement.rows[0] };
}

async function synchroniserProchaineEcheance(client, contrat) {
  if (contrat.echeancier_personnalise) return null;

  const mois = moisDuFractionnement(contrat.fractionnement);
  if (!mois) {
    await client.query(
      `update echeances set supprime_le = coalesce(supprime_le, now())
       where contrat_id = $1 and type_echeance = 'terme'
         and statut not in ('payee', 'partielle') and supprime_le is null`,
      [contrat.id]
    );
    return null;
  }

  const etatTermes = await client.query(
    `select coalesce(array_agg(numero_terme) filter (where statut = 'payee'), '{}'::integer[]) as numeros_payes
     from echeances
     where contrat_id = $1 and type_echeance = 'terme'`,
    [contrat.id]
  );
  const numerosPayes = new Set(etatTermes.rows[0].numeros_payes.map(Number));
  const numeros = calculerNumerosTermes(
    contrat.date_effet,
    contrat.fractionnement,
    contrat.date_fin
  );
  const premierNumero = numeros.find((numero) => !numerosPayes.has(numero));
  const dates = numeros.map((numero) => calculerDateTerme(
    contrat.date_effet,
    contrat.fractionnement,
    numero
  ));

  await client.query(
    `update echeances set supprime_le = coalesce(supprime_le, now())
     where contrat_id = $1 and type_echeance = 'terme'
       and numero_terme <> all($2::integer[])
       and statut not in ('payee', 'partielle') and supprime_le is null`,
    [contrat.id, numeros]
  );

  await client.query(
    `insert into echeances (
       contrat_id, type_echeance, numero_terme, date_echeance, montant_prime, montant_commission
     )
     select $1, 'terme', termes.numero, termes.date_echeance, $4, $5
     from unnest($2::integer[], $3::date[]) as termes(numero, date_echeance)
     on conflict (contrat_id, numero_terme, type_echeance) do update
       set date_echeance = excluded.date_echeance,
           montant_prime = excluded.montant_prime,
           montant_commission = excluded.montant_commission,
           supprime_le = null,
           supprime_par = null
       where echeances.statut not in ('payee', 'partielle')
         and (echeances.date_echeance is distinct from excluded.date_echeance
           or echeances.montant_prime is distinct from excluded.montant_prime
           or echeances.montant_commission is distinct from excluded.montant_commission
           or echeances.supprime_le is not null)`,
    [contrat.id, numeros, dates, contrat.prime_totale, contrat.com_brute || 0]
  );

  if (!premierNumero) return null;
  const existante = await client.query(
    `select id, contrat_id, numero_terme, date_echeance, montant_prime, statut
     from echeances
     where contrat_id = $1 and type_echeance = 'terme' and numero_terme = $2 and supprime_le is null`,
    [contrat.id, premierNumero]
  );
  return existante.rows[0] || null;
}

async function completerTousLesEcheanciers(client) {
  const resultat = await client.query(`
    with contrats_cibles as (
      select c.id, c.organisation_id, c.date_effet, c.date_fin, c.duree_mois,
             c.prime_totale, c.com_brute,
             case c.fractionnement
               when 'trimestriel' then 3
               when 'semestriel' then 6
               when 'annuel' then 12
               else null
             end as mois
      from contrats c
      where c.supprime_le is null and c.statut = 'en_cours' and not c.echeancier_personnalise
    ), cibles as (
      select c.id as contrat_id, c.organisation_id, serie.numero as numero_terme,
             (c.date_effet + make_interval(months => c.mois * serie.numero))::date as date_echeance,
             c.prime_totale, c.com_brute
      from contrats_cibles c
      cross join lateral generate_series(
        1, greatest(0, ceil(c.duree_mois::numeric / c.mois)::integer)
      ) as serie(numero)
      where c.mois is not null
        and (c.date_effet + make_interval(months => c.mois * serie.numero))::date <= c.date_fin
    ), archives as (
      update echeances e set supprime_le = coalesce(e.supprime_le, now())
      where e.type_echeance = 'terme' and e.supprime_le is null
        and e.statut not in ('payee', 'partielle')
        and exists (
          select 1 from contrats_cibles etat
          where etat.id = e.contrat_id and (
            etat.mois is null or not exists (
              select 1 from cibles cible
              where cible.contrat_id = e.contrat_id and cible.numero_terme = e.numero_terme
            )
          )
        )
      returning e.id
    ), ajouts as (
      insert into echeances (
        organisation_id, contrat_id, type_echeance, numero_terme,
        date_echeance, montant_prime, montant_commission
      )
      select organisation_id, contrat_id, 'terme', numero_terme,
             date_echeance, prime_totale, com_brute
      from cibles
      on conflict (contrat_id, numero_terme, type_echeance) do update
        set date_echeance = excluded.date_echeance,
            montant_prime = excluded.montant_prime,
            montant_commission = excluded.montant_commission,
            supprime_le = null,
            supprime_par = null
        where echeances.statut not in ('payee', 'partielle')
          and (echeances.date_echeance is distinct from excluded.date_echeance
            or echeances.montant_prime is distinct from excluded.montant_prime
            or echeances.montant_commission is distinct from excluded.montant_commission
            or echeances.supprime_le is not null)
      returning id
    )
    select ((select count(*) from archives) + (select count(*) from ajouts))::int as modifications
  `);
  return resultat.rows[0]?.modifications || 0;
}

module.exports = {
  calculerDateTerme,
  calculerNumerosTermes,
  completerTousLesEcheanciers,
  enregistrerPaiementInitial,
  synchroniserProchaineEcheance,
};
