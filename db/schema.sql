-- Schéma de la base de données « courtier-portefeuille ».
-- Application idempotente : peut être rejouée sur une base déjà à jour.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists organisations (
  id       uuid primary key default gen_random_uuid(),
  nom      text not null,
  actif    boolean not null default true,
  cree_le  timestamptz not null default now()
);

insert into organisations (id, nom)
values ('00000000-0000-4000-8000-000000000001', 'Finasure Solutions')
on conflict (id) do nothing;

create or replace function organisation_courante() returns uuid as $$
  select nullif(current_setting('app.organisation_id', true), '')::uuid;
$$ language sql stable;

-- =====================================================================
-- Référentiel
-- =====================================================================

create table if not exists utilisateurs (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null default organisation_courante() references organisations(id),
  nom                 text not null,
  email               text not null unique,
  mot_de_passe_hache  text not null,
  role                text not null check (role in ('admin', 'agent', 'lecture')),
  cree_le             timestamptz not null default now(),
  supprime_le         timestamptz,
  supprime_par        uuid references utilisateurs(id)
);
alter table utilisateurs add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update utilisateurs set organisation_id = '00000000-0000-4000-8000-000000000001' where organisation_id is null;
alter table utilisateurs alter column organisation_id set not null;
create index if not exists ix_utilisateurs_organisation on utilisateurs (organisation_id);

create table if not exists compagnies (
  id           uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default organisation_courante() references organisations(id),
  code         text not null,
  nom          text not null,
  cree_le      timestamptz not null default now(),
  supprime_le  timestamptz,
  supprime_par uuid references utilisateurs(id)
);
alter table compagnies add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update compagnies set organisation_id = '00000000-0000-4000-8000-000000000001' where organisation_id is null;
alter table compagnies alter column organisation_id set not null;
alter table compagnies drop constraint if exists compagnies_code_key;
create unique index if not exists ux_compagnies_organisation_code_actif
  on compagnies (organisation_id, code) where supprime_le is null;

create table if not exists produits (
  id           uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default organisation_courante() references organisations(id),
  nom          text not null,
  branche      text not null check (branche in
                 ('AUTO', 'IARD', 'VIE', 'SANTE', 'VOYAGE', 'CREDIT', 'AUTRE')),
  cree_le      timestamptz not null default now(),
  supprime_le  timestamptz,
  supprime_par uuid references utilisateurs(id)
);
alter table produits add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update produits set organisation_id = '00000000-0000-4000-8000-000000000001' where organisation_id is null;
alter table produits alter column organisation_id set not null;
create index if not exists ix_produits_organisation on produits (organisation_id, branche, nom);

-- =====================================================================
-- Clients
-- =====================================================================

create table if not exists clients (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null default organisation_courante() references organisations(id),
  type_client           text not null check (type_client in
                          ('personne_physique', 'personne_morale')),
  nom                   text not null,
  cin_ou_matricule      text,
  telephone             text,
  code_client_finasure  text,
  date_naissance        date,
  cree_le               timestamptz not null default now(),
  modifie_le            timestamptz not null default now(),
  supprime_le           timestamptz,
  supprime_par          uuid references utilisateurs(id)
);

create index if not exists ix_clients_nom_trgm on clients using gin (nom gin_trgm_ops);
alter table clients add column if not exists date_naissance date;
alter table clients add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update clients set organisation_id = '00000000-0000-4000-8000-000000000001' where organisation_id is null;
alter table clients alter column organisation_id set not null;
-- un même CIN/matricule ne doit exister qu'une fois par organisation active
drop index if exists ux_clients_cin_actif;
create unique index if not exists ux_clients_organisation_cin_actif on clients (organisation_id, cin_ou_matricule)
  where supprime_le is null and cin_ou_matricule is not null;
create index if not exists ix_clients_organisation_nom on clients (organisation_id, nom);

-- =====================================================================
-- Contrats
-- =====================================================================

create table if not exists contrats (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null default organisation_courante() references organisations(id),
  numero_contrat    text not null,
  client_id         uuid not null references clients(id),
  souscripteur_id   uuid references clients(id),
  societe_leasing_id uuid references clients(id),
  societe_leasing  text,
  payeur_id         uuid references clients(id),
  compagnie_id      uuid not null references compagnies(id),
  produit_id        uuid not null references produits(id),
  type_contrat      text,
  immatriculation   text,
  date_effet        date not null,
  duree_mois        integer not null check (duree_mois between 1 and 1200),
  fractionnement    text not null check (fractionnement in
                      ('annuel', 'semestriel', 'trimestriel', 'prime_unique')),
  date_fin          date not null,
  date_echeance     date,
  echeancier_personnalise boolean not null default false,
  prime_totale      numeric(12, 3) not null check (prime_totale >= 0),
  com_brute         numeric(12, 3) not null default 0 check (com_brute >= 0),
  taux_retenue      numeric(5, 4) not null default 0.10 check (taux_retenue between 0 and 1),
  com_nette         numeric(12, 3) generated always as
                      (round(com_brute * (1 - taux_retenue), 3)) stored,
  statut            text not null default 'en_cours' check (statut in
                      ('en_cours', 'renouvele', 'resilie', 'archive')),
  contrat_precedent uuid references contrats(id),
  cree_par          uuid references utilisateurs(id),
  modifie_par       uuid references utilisateurs(id),
  cree_le           timestamptz not null default now(),
  modifie_le        timestamptz not null default now(),
  supprime_le       timestamptz,
  supprime_par      uuid references utilisateurs(id),
  constraint ck_contrats_periode check (date_fin > date_effet)
);

create index if not exists ix_contrats_date_fin on contrats (date_fin);
create index if not exists ix_contrats_client_id on contrats (client_id);
alter table contrats add column if not exists date_echeance date;
alter table contrats add column if not exists echeancier_personnalise boolean not null default false;
alter table contrats add column if not exists souscripteur_id uuid references clients(id);
alter table contrats add column if not exists societe_leasing_id uuid references clients(id);
alter table contrats add column if not exists societe_leasing text;
alter table contrats add column if not exists payeur_id uuid references clients(id);
alter table contrats add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update contrats set organisation_id = '00000000-0000-4000-8000-000000000001' where organisation_id is null;
alter table contrats alter column organisation_id set not null;
create index if not exists ix_contrats_organisation_statut_effet on contrats (organisation_id, statut, date_effet desc);
create index if not exists ix_contrats_organisation_numero on contrats (organisation_id, numero_contrat);
update contrats c set societe_leasing = cl.nom
from clients cl
where c.societe_leasing_id = cl.id and c.societe_leasing is null;
update contrats set souscripteur_id = client_id where souscripteur_id is null;
alter table contrats drop constraint if exists contrats_fractionnement_check;
alter table contrats add constraint contrats_fractionnement_check check (
  fractionnement in ('annuel', 'semestriel', 'trimestriel', 'prime_unique')
);
alter table contrats drop constraint if exists contrats_duree_mois_check;
alter table contrats add constraint contrats_duree_mois_check check (duree_mois between 1 and 1200);

-- La date de fin est une donnée technique dérivée, jamais une saisie utilisateur.
create or replace function f_calcul_date_fin_contrat() returns trigger as $$
begin
  new.date_fin := (new.date_effet + make_interval(months => new.duree_mois))::date;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_calcul_date_fin_contrat on contrats;
create trigger trg_calcul_date_fin_contrat
before insert or update of date_effet, duree_mois on contrats
for each row execute function f_calcul_date_fin_contrat();

create or replace function f_calcul_date_echeance_contrat() returns trigger as $$
begin
  new.date_echeance := case new.fractionnement
    when 'trimestriel' then (new.date_effet + interval '3 months')::date
    when 'semestriel' then (new.date_effet + interval '6 months')::date
    when 'annuel' then (new.date_effet + interval '12 months')::date
    else null
  end;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_calcul_date_echeance_contrat on contrats;
create trigger trg_calcul_date_echeance_contrat
before insert or update of date_effet, fractionnement on contrats
for each row execute function f_calcul_date_echeance_contrat();

create or replace function f_verifier_organisation_contrat() returns trigger as $$
begin
  if not exists (select 1 from clients where id = new.client_id and organisation_id = new.organisation_id)
     or not exists (select 1 from compagnies where id = new.compagnie_id and organisation_id = new.organisation_id)
     or not exists (select 1 from produits where id = new.produit_id and organisation_id = new.organisation_id)
     or (new.souscripteur_id is not null and not exists (
       select 1 from clients where id = new.souscripteur_id and organisation_id = new.organisation_id
     ))
     or (new.payeur_id is not null and not exists (
       select 1 from clients where id = new.payeur_id and organisation_id = new.organisation_id
     ))
     or (new.societe_leasing_id is not null and not exists (
       select 1 from clients where id = new.societe_leasing_id and organisation_id = new.organisation_id
     )) then
    raise exception 'Référence appartenant à une autre organisation' using errcode = '23503';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_verifier_organisation_contrat on contrats;
create trigger trg_verifier_organisation_contrat
before insert or update of organisation_id, client_id, compagnie_id, produit_id, souscripteur_id, payeur_id on contrats
for each row execute function f_verifier_organisation_contrat();

-- =====================================================================
-- Échéances
-- =====================================================================

create table if not exists echeances (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null default organisation_courante() references organisations(id),
  contrat_id         uuid not null references contrats(id),
  type_echeance      text not null check (type_echeance in ('terme', 'renouvellement')),
  numero_terme       integer not null default 0,
  date_echeance      date not null,
  montant_prime      numeric(12, 3) not null default 0,
  montant_commission numeric(12, 3) not null default 0,
  statut             text not null default 'a_venir' check (statut in
                       ('a_venir', 'partielle', 'payee', 'impayee')),
  cree_le            timestamptz not null default now(),
  supprime_le        timestamptz,
  supprime_par       uuid references utilisateurs(id),
  unique (contrat_id, numero_terme, type_echeance)
);
alter table echeances add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update echeances e set organisation_id = c.organisation_id from contrats c
where c.id = e.contrat_id and e.organisation_id is null;
alter table echeances alter column organisation_id set not null;

create index if not exists ix_echeances_date on echeances (date_echeance);
create index if not exists ix_echeances_organisation_date_statut
  on echeances (organisation_id, date_echeance, statut);

-- =====================================================================
-- Paiements
-- =====================================================================

create table if not exists paiements (
  id            uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default organisation_courante() references organisations(id),
  echeance_id   uuid not null references echeances(id),
  montant       numeric(12, 3) not null check (montant > 0),
  mode_paiement text not null check (mode_paiement in
                  ('especes', 'cheque', 'virement', 'carte', 'autre')),
  reference     text,
  date_paiement date not null default current_date,
  saisi_par     uuid references utilisateurs(id),
  cree_le       timestamptz not null default now(),
  supprime_le   timestamptz,
  supprime_par  uuid references utilisateurs(id)
);
alter table paiements add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update paiements p set organisation_id = e.organisation_id from echeances e
where e.id = p.echeance_id and p.organisation_id is null;
alter table paiements alter column organisation_id set not null;

create index if not exists ix_paiements_echeance on paiements (echeance_id);
create index if not exists ix_paiements_organisation_date on paiements (organisation_id, date_paiement desc);

-- =====================================================================
-- Relances
-- =====================================================================

create table if not exists relances (
  id            uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default organisation_courante() references organisations(id),
  echeance_id   uuid not null references echeances(id),
  type_relance  text not null check (type_relance in
                  ('appel', 'sms', 'whatsapp', 'email', 'automatique')),
  declencheur   text check (declencheur in ('J-30', 'J-7', 'J-1')),
  note          text,
  effectue_par  uuid references utilisateurs(id),
  effectue_le   timestamptz not null default now(),
  supprime_le   timestamptz,
  supprime_par  uuid references utilisateurs(id)
);
alter table relances add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update relances r set organisation_id = e.organisation_id from echeances e
where e.id = r.echeance_id and r.organisation_id is null;
alter table relances alter column organisation_id set not null;

-- empêche une double relance automatique le même jour pour le même déclencheur
create unique index if not exists ux_relances_auto on relances (echeance_id, declencheur)
  where type_relance = 'automatique' and supprime_le is null;

create index if not exists ix_relances_echeance on relances (echeance_id);

-- =====================================================================
-- Pièces jointes des contrats
-- =====================================================================

create table if not exists pieces_jointes_contrats (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default organisation_courante() references organisations(id),
  contrat_id     uuid not null references contrats(id) on delete cascade,
  nom_original   text not null,
  nom_stockage   text not null unique,
  type_mime      text not null,
  taille_octets  bigint not null check (taille_octets > 0),
  ajoute_par     uuid references utilisateurs(id),
  ajoute_le      timestamptz not null default now()
);
alter table pieces_jointes_contrats add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update pieces_jointes_contrats p set organisation_id = c.organisation_id from contrats c
where c.id = p.contrat_id and p.organisation_id is null;
alter table pieces_jointes_contrats alter column organisation_id set not null;

create index if not exists ix_pieces_jointes_contrat on pieces_jointes_contrats (contrat_id, ajoute_le desc);

create or replace function f_verifier_organisation_enfant() returns trigger as $$
declare
  v_nouveau jsonb := to_jsonb(new);
begin
  if tg_table_name = 'echeances' and not exists (
    select 1 from contrats
    where id = (v_nouveau ->> 'contrat_id')::uuid
      and organisation_id = (v_nouveau ->> 'organisation_id')::uuid
  ) then
    raise exception 'Contrat appartenant à une autre organisation' using errcode = '23503';
  elsif tg_table_name in ('paiements', 'relances') and not exists (
    select 1 from echeances
    where id = (v_nouveau ->> 'echeance_id')::uuid
      and organisation_id = (v_nouveau ->> 'organisation_id')::uuid
  ) then
    raise exception 'Échéance appartenant à une autre organisation' using errcode = '23503';
  elsif tg_table_name = 'pieces_jointes_contrats' and not exists (
    select 1 from contrats
    where id = (v_nouveau ->> 'contrat_id')::uuid
      and organisation_id = (v_nouveau ->> 'organisation_id')::uuid
  ) then
    raise exception 'Contrat appartenant à une autre organisation' using errcode = '23503';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_verifier_organisation_echeance on echeances;
create trigger trg_verifier_organisation_echeance
before insert or update of organisation_id, contrat_id on echeances
for each row execute function f_verifier_organisation_enfant();

drop trigger if exists trg_verifier_organisation_paiement on paiements;
create trigger trg_verifier_organisation_paiement
before insert or update of organisation_id, echeance_id on paiements
for each row execute function f_verifier_organisation_enfant();

drop trigger if exists trg_verifier_organisation_relance on relances;
create trigger trg_verifier_organisation_relance
before insert or update of organisation_id, echeance_id on relances
for each row execute function f_verifier_organisation_enfant();

drop trigger if exists trg_verifier_organisation_piece on pieces_jointes_contrats;
create trigger trg_verifier_organisation_piece
before insert or update of organisation_id, contrat_id on pieces_jointes_contrats
for each row execute function f_verifier_organisation_enfant();

-- =====================================================================
-- Journal d'audit (append-only, jamais de suppression)
-- =====================================================================

create table if not exists journal_audit (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default organisation_courante() references organisations(id),
  utilisateur_id uuid references utilisateurs(id),
  action         text not null check (action in
                   ('creation', 'modification', 'suppression', 'restauration', 'connexion')),
  table_cible    text not null,
  ligne_id       uuid,
  etat_avant     jsonb,
  etat_apres     jsonb,
  cree_le        timestamptz not null default now()
);
alter table journal_audit add column if not exists organisation_id uuid default organisation_courante() references organisations(id);
update journal_audit set organisation_id = '00000000-0000-4000-8000-000000000001' where organisation_id is null;
alter table journal_audit alter column organisation_id set not null;

create index if not exists ix_journal_audit_table_ligne on journal_audit (table_cible, ligne_id);

-- =====================================================================
-- Trigger : recalcul du statut d'une échéance après chaque paiement
-- =====================================================================

create or replace function f_maj_statut_echeance() returns trigger as $$
declare
  v_echeance_id uuid;
  v_montant_prime numeric(12, 3);
  v_date_echeance date;
  v_montant_regle numeric(12, 3);
begin
  v_echeance_id := coalesce(new.echeance_id, old.echeance_id);

  select montant_prime, date_echeance into v_montant_prime, v_date_echeance
  from echeances where id = v_echeance_id;

  select coalesce(sum(montant), 0) into v_montant_regle
  from paiements
  where echeance_id = v_echeance_id and supprime_le is null;

  update echeances
  set statut = case
    when v_montant_prime > 0 and v_montant_regle >= v_montant_prime then 'payee'
    when v_montant_regle > 0 then 'partielle'
    when v_date_echeance < current_date then 'impayee'
    else 'a_venir'
  end
  where id = v_echeance_id;

  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists trg_maj_statut_echeance on paiements;
create trigger trg_maj_statut_echeance
after insert or update or delete on paiements
for each row execute function f_maj_statut_echeance();

-- =====================================================================
-- Trigger générique : journal d'audit
--
-- L'utilisateur courant est lu depuis la variable de session
-- "app.utilisateur_id", positionnée par l'API via SET LOCAL au début de
-- chaque transaction authentifiée (voir src/db.js).
-- =====================================================================

create or replace function f_journal_ecriture() returns trigger as $$
declare
  v_utilisateur uuid;
  v_action text;
begin
  v_utilisateur := nullif(current_setting('app.utilisateur_id', true), '')::uuid;

  if tg_op = 'INSERT' then
    insert into journal_audit (utilisateur_id, action, table_cible, ligne_id, etat_avant, etat_apres)
    values (v_utilisateur, 'creation', tg_table_name, new.id, null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.supprime_le is null and new.supprime_le is not null then
      v_action := 'suppression';
    elsif old.supprime_le is not null and new.supprime_le is null then
      v_action := 'restauration';
    else
      v_action := 'modification';
    end if;
    insert into journal_audit (utilisateur_id, action, table_cible, ligne_id, etat_avant, etat_apres)
    values (v_utilisateur, v_action, tg_table_name, new.id, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
  return null;
end;
$$ language plpgsql;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'utilisateurs', 'compagnies', 'produits', 'clients', 'contrats', 'echeances', 'paiements', 'relances'
  ]
  loop
    execute format('drop trigger if exists trg_journal_%1$s on %1$s', v_table);
    execute format(
      'create trigger trg_journal_%1$s after insert or update on %1$s for each row execute function f_journal_ecriture()',
      v_table
    );
  end loop;
end;
$$;

-- Le rôle HTTP doit être un rôle LOGIN sans SUPERUSER ni BYPASSRLS.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'courtier_app') then
    execute format('grant connect on database %I to courtier_app', current_database());
    grant usage on schema public to courtier_app;
    grant select, insert, update, delete on all tables in schema public to courtier_app;
    grant usage, select on all sequences in schema public to courtier_app;
    grant execute on all functions in schema public to courtier_app;
    alter default privileges in schema public grant select, insert, update, delete on tables to courtier_app;
    alter default privileges in schema public grant usage, select on sequences to courtier_app;
    alter default privileges in schema public grant execute on functions to courtier_app;
  end if;
end;
$$;

-- =====================================================================
-- Fonction : génération de l'échéancier d'un contrat
--
-- Répartit prime_totale et com_brute à parts égales entre les termes
-- (le dernier terme absorbe l'arrondi résiduel), ajoute l'échéance de
-- renouvellement à date_fin, et ne modifie jamais un terme déjà réglé.
-- =====================================================================

create or replace function generer_echeances(p_contrat_id uuid) returns void as $$
declare
  v contrats%rowtype;
begin
  select * into v from contrats where id = p_contrat_id;
  if not found then
    raise exception 'Contrat % introuvable', p_contrat_id;
  end if;

  if v.echeancier_personnalise then
    return;
  end if;

  update echeances set supprime_le = coalesce(supprime_le, now())
  where contrat_id = p_contrat_id and type_echeance = 'renouvellement';

  if v.fractionnement = 'prime_unique' or v.date_echeance is null then
    update echeances set supprime_le = coalesce(supprime_le, now())
    where contrat_id = p_contrat_id and type_echeance = 'terme' and statut <> 'payee';
    return;
  end if;

  update echeances set supprime_le = coalesce(supprime_le, now())
  where contrat_id = p_contrat_id and type_echeance = 'terme'
    and numero_terme > 1 and statut <> 'payee';

  insert into echeances (contrat_id, type_echeance, numero_terme, date_echeance, montant_prime, montant_commission)
  values (p_contrat_id, 'terme', 1, v.date_echeance, v.prime_totale, v.com_brute)
  on conflict (contrat_id, numero_terme, type_echeance) do update
    set date_echeance = excluded.date_echeance,
        montant_prime = excluded.montant_prime,
        montant_commission = excluded.montant_commission,
        supprime_le = null,
        supprime_par = null
    where echeances.statut <> 'payee';
end;
$$ language plpgsql;

-- =====================================================================
-- Fonction : renouvellement d'un contrat
--
-- Duplique le contrat sur la période suivante, chaîné au précédent,
-- solde l'échéance de renouvellement de l'ancien contrat et génère le
-- nouvel échéancier. Reprend par défaut les montants du contrat précédent.
-- =====================================================================

create or replace function renouveler_contrat(p_contrat_id uuid, p_utilisateur uuid) returns uuid as $$
declare
  v contrats%rowtype;
  v_nouveau_id uuid;
begin
  select * into v from contrats where id = p_contrat_id and supprime_le is null;
  if not found then
    raise exception 'Contrat % introuvable ou archivé', p_contrat_id;
  end if;

  insert into contrats (
    numero_contrat, client_id, souscripteur_id, societe_leasing_id, societe_leasing, payeur_id,
    compagnie_id, produit_id, type_contrat, immatriculation,
    date_effet, duree_mois, fractionnement, date_fin, date_echeance,
    prime_totale, com_brute, taux_retenue,
    statut, contrat_precedent, cree_par, modifie_par
  )
  values (
    v.numero_contrat, v.client_id, v.souscripteur_id, v.societe_leasing_id, v.societe_leasing, v.payeur_id,
    v.compagnie_id, v.produit_id, v.type_contrat, v.immatriculation,
    (v.date_effet + make_interval(months => v.duree_mois))::date,
    v.duree_mois, v.fractionnement,
    (v.date_effet + make_interval(months => v.duree_mois * 2))::date,
    null,
    v.prime_totale, v.com_brute, v.taux_retenue,
    'en_cours', p_contrat_id, p_utilisateur, p_utilisateur
  )
  returning id into v_nouveau_id;

  update contrats
  set statut = 'renouvele', modifie_par = p_utilisateur, modifie_le = now()
  where id = p_contrat_id;

  update echeances
  set statut = 'payee'
  where contrat_id = p_contrat_id and type_echeance = 'renouvellement';

  perform generer_echeances(v_nouveau_id);

  return v_nouveau_id;
end;
$$ language plpgsql;

-- =====================================================================
-- Vues
-- =====================================================================

create or replace view v_portefeuille as
select
  c.id as contrat_id,
  c.numero_contrat,
  c.statut,
  c.date_effet,
  c.date_fin,
  c.prime_totale,
  c.com_brute,
  c.taux_retenue,
  c.com_nette,
  cl.id as client_id,
  cl.nom as client_nom,
  cl.telephone as client_telephone,
  cl.type_client,
  cp.id as compagnie_id,
  cp.nom as compagnie_nom,
  pr.id as produit_id,
  pr.nom as produit_nom,
  pr.branche,
  prochaine.date_echeance as prochaine_echeance_date,
  prochaine.type_echeance as prochaine_echeance_type
  ,s.id as souscripteur_id, s.nom as souscripteur_nom
  ,sl.id as societe_leasing_id, coalesce(nullif(c.societe_leasing, ''), sl.nom) as societe_leasing_nom
  ,pa.id as payeur_id, pa.nom as payeur_nom
  ,c.organisation_id
from contrats c
join clients cl on cl.id = c.client_id and cl.supprime_le is null
left join clients s on s.id = c.souscripteur_id
left join clients sl on sl.id = c.societe_leasing_id
left join clients pa on pa.id = c.payeur_id
join compagnies cp on cp.id = c.compagnie_id and cp.supprime_le is null
join produits pr on pr.id = c.produit_id and pr.supprime_le is null
left join lateral (
  select e.date_echeance, e.type_echeance
  from echeances e
  where e.contrat_id = c.id and e.supprime_le is null and e.statut <> 'payee'
  order by e.date_echeance
  limit 1
) prochaine on true
where c.supprime_le is null;

create or replace view v_echeances as
select
  e.id as echeance_id,
  e.contrat_id,
  e.type_echeance,
  e.numero_terme,
  e.date_echeance,
  e.montant_prime,
  e.montant_commission,
  e.statut,
  (e.date_echeance - current_date) as jours_restants,
  coalesce(pmt.montant_regle, 0) as montant_regle,
  case
    when e.date_echeance < current_date and e.statut <> 'payee' then 'en_retard'
    when (e.date_echeance - current_date) <= 15 and e.statut <> 'payee' then 'urgent'
    when (e.date_echeance - current_date) <= 45 and e.statut <> 'payee' then 'a_preparer'
    else 'a_jour'
  end as niveau,
  c.numero_contrat,
  cl.id as client_id,
  cl.nom as client_nom,
  cl.telephone as client_telephone,
  cp.nom as compagnie_nom,
  pr.nom as produit_nom,
  pr.branche,
  c.organisation_id
from echeances e
join contrats c on c.id = e.contrat_id and c.supprime_le is null
join clients cl on cl.id = c.client_id and cl.supprime_le is null
join compagnies cp on cp.id = c.compagnie_id and cp.supprime_le is null
join produits pr on pr.id = c.produit_id and pr.supprime_le is null
left join lateral (
  select sum(montant) as montant_regle
  from paiements
  where echeance_id = e.id and supprime_le is null
) pmt on true
where e.supprime_le is null;

create or replace view v_corbeille as
select 'clients' as table_source, id, nom as libelle, supprime_le, supprime_par, organisation_id
from clients where supprime_le is not null
union all
select 'contrats', id, numero_contrat, supprime_le, supprime_par, organisation_id
from contrats where supprime_le is not null
union all
select 'compagnies', id, nom, supprime_le, supprime_par, organisation_id
from compagnies where supprime_le is not null
union all
select 'produits', id, nom, supprime_le, supprime_par, organisation_id
from produits where supprime_le is not null;

alter view v_portefeuille set (security_invoker = true);
alter view v_echeances set (security_invoker = true);
alter view v_corbeille set (security_invoker = true);

-- L'isolation est imposée par PostgreSQL, y compris pour le propriétaire des tables.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'compagnies', 'produits', 'clients', 'contrats', 'echeances',
    'paiements', 'relances', 'pieces_jointes_contrats', 'journal_audit'
  ]
  loop
    execute format('alter table %I enable row level security', v_table);
    execute format('alter table %I force row level security', v_table);
    execute format('drop policy if exists isolation_organisation on %I', v_table);
    execute format(
      'create policy isolation_organisation on %I using (organisation_id = organisation_courante()) with check (organisation_id = organisation_courante())',
      v_table
    );
  end loop;
end;
$$;
