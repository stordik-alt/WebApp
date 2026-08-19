import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * E2E ověření pravidel úložiště screenshotů:
 * číst / nahrávat / mazat smí pouze správce a pouze v adresáři `daily/`.
 * Testy běží proti reálné databázi; bez servisního klíče se přeskočí.
 */

function envFile(): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = envFile();
const pick = (...keys: string[]) => keys.map((k) => process.env[k] ?? fileEnv[k]).find(Boolean);

const URL_ = pick("SUPABASE_URL", "VITE_SUPABASE_URL");
const PUBLISHABLE = pick("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY");
const SERVICE = pick("SUPABASE_SERVICE_ROLE_KEY");

const BUCKET = "screenshots";
const runId = Math.random().toString(36).slice(2, 10);
const dailyPath = (n: string) => `daily/__test__/${runId}/${n}`;
const outsidePath = (n: string) => `other/__test__/${runId}/${n}`;
const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });

const enabled = Boolean(URL_ && PUBLISHABLE && SERVICE);

const anonClient = () =>
  createClient(URL_!, PUBLISHABLE!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });

type TestUser = { id: string; email: string; password: string; client: SupabaseClient };

describe.skipIf(!enabled)("screenshots storage access", () => {
  let admin: SupabaseClient;
  let adminUser: TestUser;
  let plainUser: TestUser;

  async function makeUser(kind: "admin" | "plain"): Promise<TestUser> {
    const email = `e2e-${kind}-${runId}@example.com`;
    const password = `Pw-${runId}-${kind}-9!x`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const id = data.user!.id;
    if (kind === "admin") {
      const { error: rErr } = await admin.from("user_roles").insert({ user_id: id, role: "admin" });
      if (rErr) throw rErr;
    }
    const client = anonClient();
    const { error: sErr } = await client.auth.signInWithPassword({ email, password });
    if (sErr) throw sErr;
    return { id, email, password, client };
  }

  /** Existuje objekt v bucketu (kontrola servisním klientem, obchází pravidla)? */
  async function existsRaw(path: string) {
    const { data } = await admin.storage.from(BUCKET).download(path);
    return Boolean(data);
  }

  beforeAll(async () => {
    admin = createClient(URL_!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    adminUser = await makeUser("admin");
    plainUser = await makeUser("plain");
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    const { data } = await admin.storage.from(BUCKET).list(`daily/__test__/${runId}`);
    if (data?.length) {
      await admin.storage
        .from(BUCKET)
        .remove(data.map((f) => `daily/__test__/${runId}/${f.name}`));
    }
    const { data: outside } = await admin.storage.from(BUCKET).list(`other/__test__/${runId}`);
    if (outside?.length) {
      await admin.storage
        .from(BUCKET)
        .remove(outside.map((f) => `other/__test__/${runId}/${f.name}`));
    }
    for (const u of [adminUser, plainUser]) {
      if (u) {
        await u.client.auth.signOut();
        await admin.auth.admin.deleteUser(u.id);
      }
    }
  }, 60_000);

  it("správce nahraje, přečte a smaže soubor v daily/", async () => {
    const path = dailyPath("ok.png");

    const up = await adminUser.client.storage.from(BUCKET).upload(path, png(), {
      contentType: "image/png",
    });
    expect(up.error).toBeNull();
    expect(await existsRaw(path)).toBe(true);

    const dl = await adminUser.client.storage.from(BUCKET).download(path);
    expect(dl.error).toBeNull();
    expect(dl.data).toBeTruthy();

    const signed = await adminUser.client.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(signed.error).toBeNull();

    const del = await adminUser.client.storage.from(BUCKET).remove([path]);
    expect(del.error).toBeNull();
    expect(await existsRaw(path)).toBe(false);
  }, 60_000);

  it("správce nesmí nahrát mimo adresář daily/", async () => {
    const path = outsidePath("nope.png");
    const up = await adminUser.client.storage.from(BUCKET).upload(path, png(), {
      contentType: "image/png",
    });
    expect(up.error).not.toBeNull();
    expect(await existsRaw(path)).toBe(false);
  }, 60_000);

  it("běžný uživatel nesmí nahrát do daily/", async () => {
    const path = dailyPath("plain-upload.png");
    const up = await plainUser.client.storage.from(BUCKET).upload(path, png(), {
      contentType: "image/png",
    });
    expect(up.error).not.toBeNull();
    expect(await existsRaw(path)).toBe(false);
  }, 60_000);

  it("běžný uživatel nesmí číst, vypisovat ani mazat cizí soubor v daily/", async () => {
    const path = dailyPath("admin-owned.png");
    const up = await adminUser.client.storage.from(BUCKET).upload(path, png(), {
      contentType: "image/png",
    });
    expect(up.error).toBeNull();

    const dl = await plainUser.client.storage.from(BUCKET).download(path);
    expect(dl.error).not.toBeNull();

    const signed = await plainUser.client.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(signed.error).not.toBeNull();

    const list = await plainUser.client.storage.from(BUCKET).list(`daily/__test__/${runId}`);
    expect(list.data ?? []).toHaveLength(0);

    const del = await plainUser.client.storage.from(BUCKET).remove([path]);
    expect(del.data ?? []).toHaveLength(0);
    expect(await existsRaw(path)).toBe(true);

    await admin.storage.from(BUCKET).remove([path]);
  }, 60_000);

  it("nepřihlášený návštěvník nesmí číst ani nahrávat", async () => {
    const guest = anonClient();
    const path = dailyPath("guest.png");

    const up = await guest.storage.from(BUCKET).upload(path, png(), { contentType: "image/png" });
    expect(up.error).not.toBeNull();
    expect(await existsRaw(path)).toBe(false);

    const seeded = dailyPath("guest-read.png");
    await adminUser.client.storage.from(BUCKET).upload(seeded, png(), { contentType: "image/png" });
    const dl = await guest.storage.from(BUCKET).download(seeded);
    expect(dl.error).not.toBeNull();
    await admin.storage.from(BUCKET).remove([seeded]);
  }, 60_000);
});
