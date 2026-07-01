// scripts/diag-scadenziario.ts
// DIAGNOSTICA READ-ONLY (nessuna scrittura): elenca, per ogni profilo, gli anni
// presenti in `year_settings` con i parametri fiscali chiave. Serve a capire
// perché lo scadenziario di un profilo (es. "Peru") risulta vuoto: il server
// fa gate 404 YEAR_SETTINGS_NOT_FOUND se manca la riga per l'anno richiesto.
//
// Uso:  npx tsx --env-file=.env scripts/diag-scadenziario.ts
// (richiede DATABASE_URL / DATABASE_AUTH_TOKEN nel .env — Turso prod o local.db)
//
// Cancellabile dopo la diagnosi: è solo uno strumento usa-e-getta.
import { getDb, closeDb } from '../src/server/db/client';
import { profiles, yearSettings } from '../src/server/db/schema';

const CURRENT_YEAR = new Date().getFullYear();

async function main() {
  const db = getDb();

  const allProfiles = await db
    .select({ id: profiles.id, slug: profiles.slug, displayName: profiles.displayName })
    .from(profiles);

  const allYs = await db
    .select({
      profileId: yearSettings.profileId,
      year: yearSettings.year,
      regime: yearSettings.regime,
      coefficiente: yearSettings.coefficiente,
      impostaSostitutiva: yearSettings.impostaSostitutiva,
      inpsMode: yearSettings.inpsMode,
      inpsCategoria: yearSettings.inpsCategoria,
    })
    .from(yearSettings);

  const byProfile = new Map<string, typeof allYs>();
  for (const r of allYs) {
    const arr = byProfile.get(r.profileId) ?? [];
    arr.push(r);
    byProfile.set(r.profileId, arr);
  }

  console.log(`\nAnno corrente (default UI): ${CURRENT_YEAR}`);
  console.log(`Profili totali: ${allProfiles.length} · righe year_settings totali: ${allYs.length}\n`);

  for (const p of allProfiles) {
    const rows = (byProfile.get(p.id) ?? []).slice().sort((a, b) => a.year - b.year);
    const years = rows.map((r) => r.year);
    const hasCurrent = years.includes(CURRENT_YEAR);
    console.log(`── ${p.displayName} (slug=${p.slug}) ──`);
    if (rows.length === 0) {
      console.log('   ⚠️  NESSUNA riga year_settings → scadenziario SEMPRE vuoto (gate 404 per ogni anno).');
      console.log('       Causa probabile: import che ha scartato le righe (es. coefficiente 0 fallisce Zod).\n');
      continue;
    }
    console.log(`   Anni con settings: [${years.join(', ')}]`);
    console.log(`   Anno corrente ${CURRENT_YEAR} presente? ${hasCurrent ? 'SÌ ✅' : 'NO ⚠️  → scadenziario vuoto su ' + CURRENT_YEAR}`);
    for (const r of rows) {
      console.log(
        `   · ${r.year}: regime=${r.regime} coeff=${r.coefficiente} sost=${r.impostaSostitutiva} ` +
          `inpsMode=${r.inpsMode} inpsCat=${r.inpsCategoria ?? '—'}`,
      );
    }
    console.log('');
  }

  closeDb();
}

main().catch((err) => {
  console.error('Errore diagnostica:', err?.message ?? err);
  process.exit(1);
});
