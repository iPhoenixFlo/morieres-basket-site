-- ---------------------------------------------------------------
-- Cache des données FFBB
-- ---------------------------------------------------------------
-- Depuis le 19 octobre 2026, le pare-feu de la FFBB refuse les requêtes
-- venant des hébergeurs. Les données sont donc collectées depuis une
-- connexion ordinaire, puis déposées ici. Le site ne lit plus que cette
-- table : il ne contacte plus la FFBB du tout.
--
-- À exécuter une fois dans l'éditeur SQL de Supabase.
-- ---------------------------------------------------------------

create table if not exists ffbb_cache (
  -- "club", ou "equipe:200000005400838"
  cle          text primary key,
  charge       jsonb       not null,
  maj          timestamptz not null default now(),
  -- Horodatage de la collecte côté machine locale, pour mesurer l'âge réel
  collecte_le  timestamptz
);

create index if not exists ffbb_cache_maj_idx on ffbb_cache (maj desc);

-- Personne n'accède à cette table sans la clé de service.
alter table ffbb_cache enable row level security;
revoke all on ffbb_cache from anon, authenticated;


-- ---------------------------------------------------------------
-- Dépôt d'une entrée, en remplacement de la précédente.
-- ---------------------------------------------------------------
create or replace function deposer_ffbb(
  p_cle         text,
  p_charge      jsonb,
  p_collecte_le timestamptz default now()
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maj timestamptz;
begin
  if p_cle is null or length(trim(p_cle)) = 0 then
    raise exception 'cle vide';
  end if;

  -- Une charge vide serait pire que des données périmées : on refuse.
  if p_charge is null or p_charge = 'null'::jsonb then
    raise exception 'charge vide pour %', p_cle;
  end if;

  insert into ffbb_cache (cle, charge, maj, collecte_le)
  values (trim(p_cle), p_charge, now(), p_collecte_le)
  on conflict (cle) do update
    set charge      = excluded.charge,
        maj         = now(),
        collecte_le = excluded.collecte_le
  returning maj into v_maj;

  return v_maj;
end;
$$;


-- ---------------------------------------------------------------
-- Purge des entrées devenues inutiles : une équipe qui n'est plus
-- engagée laisse sinon sa ligne traîner indéfiniment.
-- ---------------------------------------------------------------
create or replace function purger_ffbb(p_jours int default 30)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nb int;
begin
  delete from ffbb_cache
  where maj < now() - make_interval(days => greatest(p_jours, 7));
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;
