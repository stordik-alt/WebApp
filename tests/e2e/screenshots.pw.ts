import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * Průchod UI: import screenshotu smí jen správce a soubor musí skončit v adresáři `daily/`.
 * Účty se zakládají a po testu mažou. Bez servisního klíče se testy přeskočí.
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
const SERVICE = pick("SUPABASE_SERVICE_ROLE_KEY");
const BUCKET = "screenshots";

const runId = Math.random().toString(36).slice(2, 10);
const users: { id: string; email: string; password: string }[] = [];

// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let admin: SupabaseClient;

test.skip(!URL_ || !SERVICE, "Chybí přístup k databázi pro E2E testy.");

async function makeUser(kind: "admin" | "plain") {
  const email = `e2e-ui-${kind}-${runId}@example.com`;
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
  users.push({ id, email, password });
  return { email, password };
}

test.beforeAll(() => {
  admin = createClient(URL_!, SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

test.afterAll(async () => {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
});

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Heslo").fill(password);
  await page.getByRole("button", { name: "Přihlásit se" }).click();
  await expect(page.getByLabel("Heslo")).toHaveCount(0);
}

test("správce nahraje screenshot a soubor vznikne v daily/", async ({ page }) => {
  const { email, password } = await makeUser("admin");
  await signIn(page, email, password);

  await page.goto("/denni-data", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Import ze screenshotu" })).toBeVisible({
    timeout: 30_000,
  });

  await page.setInputFiles('input[type="file"]', {
    name: `e2e-${runId}.png`,
    mimeType: "image/png",
    buffer: PNG,
  });

  await expect(page.getByAltText("Náhled nahraného screenshotu")).toBeVisible();

  // Soubor musí skutečně existovat pod prefixem daily/ (ověřeno mimo aplikaci).
  const today = new Date().toISOString().slice(0, 10);
  await expect
    .poll(
      async () => {
        const { data } = await admin.storage.from(BUCKET).list(`daily/${today}`, { limit: 1000 });
        return data?.length ?? 0;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  const { data: listed } = await admin.storage.from(BUCKET).list(`daily/${today}`, { limit: 1000 });
  const uploaded = (listed ?? []).sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  )[0];
  expect(uploaded).toBeTruthy();
  await admin.storage.from(BUCKET).remove([`daily/${today}/${uploaded!.name}`]);
});

test("běžný uživatel se k importu vůbec nedostane", async ({ page }) => {
  const { email, password } = await makeUser("plain");
  await signIn(page, email, password);

  await expect(page.getByText("Přístup zamítnut")).toBeVisible();

  await page.goto("/denni-data", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Přístup zamítnut")).toBeVisible();
  await expect(page.getByText("Import ze screenshotu")).toHaveCount(0);
});
