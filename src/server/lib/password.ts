// src/server/lib/password.ts
import { hash, verify } from '@node-rs/argon2';

// Parametri Argon2id espliciti — config raccomandata OWASP Password Storage
// Cheat Sheet (m=64MiB, t=3, p=1). NON abbassare senza re-hash di tutti gli
// utenti: ogni verify alloca ~64MiB, vedi semaforo sotto per il limite di
// concorrenza sulla VM Fly da 512MB.
const ARGON2_PARAMS = {
  memoryCost: 64 * 1024, // KiB → 64 MiB
  timeCost: 3, // iterazioni
  parallelism: 1, // lanes
};

// ── Semaforo FIFO per le verify ──────────────────────────────────────────────
// Ogni verify Argon2id alloca 64MiB: senza limite, N login concorrenti = N×64MiB
// → OOM banale sulla VM da 512MB. Max 2 verify in volo; le altre attendono in
// coda FIFO (in-process: una sola istanza Fly, nessuna esigenza distribuita).
const MAX_CONCURRENT_VERIFY = 2;

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  private async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next(); // il posto passa direttamente al prossimo in coda (active invariato)
    } else {
      this.active -= 1;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const verifySemaphore = new Semaphore(MAX_CONCURRENT_VERIFY);

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_PARAMS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return verifySemaphore.run(async () => {
    try {
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  });
}
