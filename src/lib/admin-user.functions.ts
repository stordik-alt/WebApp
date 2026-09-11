import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const createTesterUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { email: string; password: string; firstName?: string; lastName?: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: callerRole, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError) throw roleError;
    if (!callerRole) throw new Error("Pouze správce může vytvářet Tester účty.");

    const email = data.email.trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Zadej platný e-mail.");
    if (data.password.length < 6) throw new Error("Heslo musí mít alespoň 6 znaků.");

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.firstName?.trim() || "Tester",
        last_name: data.lastName?.trim() || "",
      },
    });

    if (createError) throw createError;
    if (!created.user) throw new Error("Účet se nepodařilo vytvořit.");

    const userId = created.user.id;
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: userId,
        email,
        first_name: data.firstName?.trim() || "Tester",
        last_name: data.lastName?.trim() || "",
      });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw profileError;
    }

    const { error: roleInsertError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "tester" as never });

    if (roleInsertError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw roleInsertError;
    }

    return { userId, email };
  });
