import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { profiles } from '../../db/schema';
import { ImportError } from './errors';
import { CHILD_ENTITIES } from './registry';
import type { ImportPlan } from './types';

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function snapshotProfile(db: Db, profileId: string): Promise<Record<string, any>> {
  const snap: Record<string, any> = {};
  const [prof] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  snap.profile = prof ?? null;
  for (const spec of CHILD_ENTITIES) {
    snap[spec.name] = await db.select().from(spec.table).where(eq(spec.table.profileId, profileId));
  }
  return snap;
}

export async function applyImportPlan(
  db: Db,
  plan: ImportPlan,
  opts: { commit: boolean; skipInvalid?: boolean },
): Promise<{ snapshotPath?: string }> {
  if (!opts.commit) return {};
  if (plan.issues.length && !opts.skipInvalid) {
    throw new ImportError('VALIDATION_ISSUES', `VALIDATION_ISSUES: ${plan.issues.length} issue di validazione — rivedi il dry-run o usa --skip-invalid.`);
  }

  const snap = await snapshotProfile(db, plan.profileId);
  const snapshotPath = join(tmpdir(), `lira-import-snapshot-${plan.slug}-${nowStamp()}.json`);
  writeFileSync(snapshotPath, JSON.stringify(snap, null, 2), 'utf8');

  await db.transaction(async (tx) => {
    if (plan.profileOp === 'insert') await tx.insert(profiles).values(plan.profileRow);
    else if (plan.profileOp === 'update') {
      const { id, ...rest } = plan.profileRow;
      await tx.update(profiles).set({ ...rest, updatedAt: new Date().toISOString() }).where(eq(profiles.id, plan.profileId));
    }
    for (const spec of CHILD_ENTITIES) {
      const ep = plan.entities[spec.name]!;
      if (ep.inserts.length) await tx.insert(spec.table).values(ep.inserts);
      for (const row of ep.updates) {
        const set = spec.touch ? { ...row, updatedAt: new Date().toISOString() } : { ...row };
        await tx.update(spec.table).set(set).where(spec.whereOf(row));
      }
    }
  });

  return { snapshotPath };
}
