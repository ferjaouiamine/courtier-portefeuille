'use strict';

const { calculerDateFin } = require('./dates-contrat');
const { moisDuFractionnement } = require('./regles-contrat');

function calculerDateTerme(dateEffet, fractionnement, numeroTerme) {
  const mois = moisDuFractionnement(fractionnement);
  const numero = Number(numeroTerme);
  if (!mois || !Number.isInteger(numero) || numero < 1) return null;
  return calculerDateFin(dateEffet, mois * numero);
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

  const dernierTermePaye = await client.query(
    `select coalesce(max(numero_terme), 0)::int as numero
     from echeances
     where contrat_id = $1 and type_echeance = 'terme' and statut = 'payee'`,
    [contrat.id]
  );
  const numeroTerme = dernierTermePaye.rows[0].numero + 1;
  const dateEcheance = calculerDateTerme(contrat.date_effet, contrat.fractionnement, numeroTerme);

  await client.query(
    `update echeances set supprime_le = coalesce(supprime_le, now())
     where contrat_id = $1 and type_echeance = 'terme' and numero_terme <> $2
       and statut not in ('payee', 'partielle') and supprime_le is null`,
    [contrat.id, numeroTerme]
  );

  const insertion = await client.query(
    `insert into echeances (
       contrat_id, type_echeance, numero_terme, date_echeance, montant_prime, montant_commission
     ) values ($1, 'terme', $2, $3, $4, $5)
     on conflict (contrat_id, numero_terme, type_echeance) do update
       set date_echeance = excluded.date_echeance,
           montant_prime = excluded.montant_prime,
           montant_commission = excluded.montant_commission,
           supprime_le = null,
           supprime_par = null
       where echeances.statut not in ('payee', 'partielle')
     returning id, contrat_id, numero_terme, date_echeance, montant_prime, statut`,
    [contrat.id, numeroTerme, dateEcheance, contrat.prime_totale, contrat.com_brute || 0]
  );
  if (insertion.rowCount > 0) return insertion.rows[0];

  const existante = await client.query(
    `select id, contrat_id, numero_terme, date_echeance, montant_prime, statut
     from echeances
     where contrat_id = $1 and type_echeance = 'terme' and numero_terme = $2 and supprime_le is null`,
    [contrat.id, numeroTerme]
  );
  return existante.rows[0] || null;
}

module.exports = { calculerDateTerme, synchroniserProchaineEcheance };
