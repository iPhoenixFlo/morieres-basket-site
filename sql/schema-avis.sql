-- ---------------------------------------------------------------
-- Avis des familles après un stage vacances (page /avis-stage)
-- ---------------------------------------------------------------
-- À exécuter une fois dans l'éditeur SQL de Supabase.
-- Les réponses sont anonymes : seul le prénom de l'enfant est
-- demandé, et il est facultatif.
-- ---------------------------------------------------------------

create table if not exists avis_stages (
  id            uuid primary key default gen_random_uuid(),
  stage_id      text        not null,
  prenom        text,
  note          smallint    not null check (note between 1 and 5),
  encadrement   smallint    check (encadrement between 1 and 5),
  niveau        text        check (niveau in ('facile', 'adapte', 'difficile')),
  horaires      text        check (horaires in ('ok', 'plus_tot', 'plus_tard', 'plus_court')),
  format        text        check (format in ('semaine', 'carte', 'demi')),
  tarif         text        check (tarif in ('abordable', 'juste', 'cher')),
  vacances      text[]      not null default '{}',
  ameliorer     text,
  cree_le       timestamptz not null default now()
);

create index if not exists avis_stages_stage_idx on avis_stages (stage_id, cree_le desc);

-- Personne n'accède à cette table sans la clé de service.
alter table avis_stages enable row level security;
revoke all on avis_stages from anon, authenticated;
