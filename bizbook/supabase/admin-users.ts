// BizBook step 2: lets the admin create, lock and reset staff logins.
// Deploy as an Edge Function named: admin-users
// It runs on Supabase's server, so the secret key never reaches the phone.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    // 1. Who is calling? Only an active admin may continue.
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await service.from("profiles").select("role, active, org_id").eq("id", user.id).single();
    if (!me || me.role !== "admin" || !me.active) return json({ error: "Admins only" }, 403);

    const b = await req.json();

    // 2. Create a staff login
    if (b.action === "create") {
      const username = String(b.username ?? "").trim().toLowerCase();
      const pin = String(b.pin ?? "");
      const name = String(b.full_name ?? "").trim();
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: "Username: 3-30 letters, numbers, dots or dashes" }, 400);
      if (!/^\d{6}$/.test(pin)) return json({ error: "PIN must be exactly 6 digits" }, 400);
      if (!name || !b.business_id) return json({ error: "Name and business are required" }, 400);

      // The business must belong to the admin's own company
      const { data: biz } = await service.from("businesses").select("id").eq("id", b.business_id).eq("org_id", me.org_id).single();
      if (!biz) return json({ error: "Business not found" }, 404);
      const { data: org } = await service.from("organizations").select("code").eq("id", me.org_id).single();
      const { data: dup } = await service.from("profiles").select("id").eq("org_id", me.org_id).eq("username", username).maybeSingle();
      if (dup) return json({ error: "That username is taken" }, 400);

      const { data: created, error: e1 } = await service.auth.admin.createUser({
        email: `${username}@${org!.code}.bizbook.app`,
        password: pin,
        email_confirm: true,
      });
      if (e1) return json({ error: e1.message.includes("already") ? "That username is taken" : e1.message }, 400);

      const { error: e2 } = await service.from("profiles").insert({
        id: created.user.id, org_id: me.org_id, username, full_name: name, role: "staff", business_id: b.business_id,
      });
      if (e2) {
        await service.auth.admin.deleteUser(created.user.id); // undo, keep things clean
        return json({ error: e2.message }, 400);
      }
      return json({ ok: true, username });
    }

    // Everything below needs a target staff member (never another admin)
    const { data: target } = await service.from("profiles").select("id, role").eq("id", b.user_id).eq("org_id", me.org_id).single();
    if (!target || target.role !== "staff") return json({ error: "Staff member not found" }, 404);

    // 3. Deactivate or reactivate. Also bans the login so open sessions end.
    if (b.action === "set_active") {
      const active = !!b.active;
      await service.from("profiles").update({ active }).eq("id", target.id);
      await service.auth.admin.updateUserById(target.id, { ban_duration: active ? "none" : "876000h" });
      return json({ ok: true });
    }

    // 4. Reset a PIN
    if (b.action === "reset_pin") {
      const pin = String(b.pin ?? "");
      if (!/^\d{6}$/.test(pin)) return json({ error: "PIN must be exactly 6 digits" }, 400);
      const { error } = await service.auth.admin.updateUserById(target.id, { password: pin });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
