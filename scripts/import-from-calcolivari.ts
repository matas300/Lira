import { readFileSync } from 'node:fs';
import { getDb } from '../src/server/db/client';
import { buildImportPlan, applyImportPlan, ImportError } from '../src/server/lib/import-calcolivari';
import type { ImportPlan } from '../src/server/lib/import-calcolivari';

export interface CliArgs {
  userEmail: string;
  slug?: string;
  commit: boolean;
  skipInvalid: boolean;
  files: string[];
}

export function parseArgs(argv: string[]): CliArgs {
  let userEmail: string | undefined;
  let slug: string | undefined;
  let commit = false;
  let skipInvalid = false;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user') userEmail = argv[++i];
    else if (a === '--slug') slug = argv[++i];
    else if (a === '--commit') commit = true;
    else if (a === '--skip-invalid') skipInvalid = true;
    else files.push(a!);
  }
  if (!userEmail) throw new Error('Manca --user <email>. Uso: npm run import:legacy -- --user <email> [--slug s] [--commit] <file...>');
  if (files.length === 0) throw new Error('Nessun file di export indicato.');
  return { userEmail, slug, commit, skipInvalid, files };
}

function printReport(plan: ImportPlan, commit: boolean): void {
  console.log(`\nProfilo: ${plan.profileName} → slug "${plan.slug}" (${plan.profileOp})`);
  console.log('Entità            insert  update  identical');
  for (const [name, ep] of Object.entries(plan.entities)) {
    console.log(`  ${name.padEnd(16)} ${String(ep.inserts.length).padStart(6)}  ${String(ep.updates.length).padStart(6)}  ${String(ep.identical).padStart(9)}`);
  }
  if (plan.issues.length) {
    console.log(`\n⚠ ${plan.issues.length} issue di validazione:`);
    for (const i of plan.issues.slice(0, 20)) console.log(`  [${i.entity}] ${i.sourceKey}: ${i.reason}`);
  }
  console.log(commit ? '\nMODE: COMMIT (scrittura su DB)' : '\nMODE: DRY-RUN (nessuna scrittura). Aggiungi --commit per applicare.');
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }

  const inputs = args.files.map((f) => {
    try {
      return JSON.parse(readFileSync(f, 'utf8'));
    } catch (err: any) {
      console.error(`Impossibile leggere/parsare "${f}": ${err?.message ?? err}`);
      process.exit(1);
    }
  });
  const db = getDb();

  try {
    const plan = await buildImportPlan(db, inputs, { userEmail: args.userEmail, slug: args.slug });
    printReport(plan, args.commit);
    if (args.commit) {
      const { snapshotPath } = await applyImportPlan(db, plan, { commit: true, skipInvalid: args.skipInvalid });
      console.log(`\n✓ Import applicato. Snapshot pre-import: ${snapshotPath}`);
    } else if (plan.issues.length) {
      process.exit(2);
    }
    process.exit(0);
  } catch (err: any) {
    if (err instanceof ImportError && err.code === 'USER_NOT_FOUND') {
      console.error(err.message);
      process.exit(3);
    }
    console.error('Errore import:', err?.message ?? err);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('import-from-calcolivari.ts')) {
  void main();
}
