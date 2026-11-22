import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempDir = mkdtempSync(join(tmpdir(), "aniflow-health-"));
process.env.DATABASE_PATH = join(tempDir, "health.sqlite");

const { getSqlite } = await import("@/lib/db/client");
const { touchWorkerHeartbeat } = await import("@/lib/db/repositories");
const { GET } = await import("@/app/api/health/route");

describe("GET /api/health", () => {
  beforeAll(() => {
    getSqlite();
  });

  afterAll(() => {
    try {
      getSqlite().close();
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports database health and worker heartbeat status without leaking secrets", async () => {
    const initial = await GET();
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as Record<string, unknown>;
    expect(initialBody).toEqual({
      ok: true,
      db: "ok",
      worker: {
        ok: false,
        secondsSinceLastSeen: null
      }
    });

    touchWorkerHeartbeat();
    const healthy = await GET();
    expect(healthy.status).toBe(200);
    const healthyBody = (await healthy.json()) as {
      ok: boolean;
      db: string;
      worker: { ok: boolean; secondsSinceLastSeen: number | null };
    };
    expect(healthyBody.ok).toBe(true);
    expect(healthyBody.db).toBe("ok");
    expect(healthyBody.worker.ok).toBe(true);
    expect(healthyBody.worker.secondsSinceLastSeen).toBeTypeOf("number");
  });
});
