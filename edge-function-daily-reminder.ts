// Supabase Edge Function: 매시 정각(pg_cron) 호출 → 알림 시각이 된 사용자에게 오늘 훈련 웹 푸시
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
webpush.setVapidDetails("mailto:cjever2h@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const input = await req.json().catch(() => ({}));
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!key) { try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); key = k.default ?? Object.values(k)[0] ?? ""; } catch { /* ignore */ } }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, key);
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const hour = kst.getUTCHours();
  const today = kst.toISOString().slice(0, 10);
  const { data: users, error } = await sb.from("settings").select("user_id, notify_hour, last_notified_on").eq("notify_enabled", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const targets = (users ?? []).filter((u) => input.force || ((u.notify_hour ?? 6) === hour && u.last_notified_on !== today));
  let sent = 0, removed = 0;
  const errors: string[] = [];
  for (const u of targets) {
    const { data: ws } = await sb.from("workouts").select("title,type,planned_distance,target_pace,status").eq("user_id", u.user_id).eq("date", today);
    const todo = (ws ?? []).filter((w) => w.status !== "done");
    const { data: races } = await sb.from("races").select("name,date").eq("user_id", u.user_id).gte("date", today).order("date").limit(1);
    const r = races?.[0];
    const dday = r ? Math.round((Date.parse(r.date) - Date.parse(today)) / 86400000) : null;
    const lines = todo.length
      ? todo.map((w) => w.type === "rest" ? "휴식일 · 스트레칭과 회복에 집중" : `${w.title}${w.target_pace ? ` @ ${w.target_pace}/km` : ""}`)
      : ["오늘은 계획된 훈련이 없어요"];
    const payload = JSON.stringify({
      title: `오늘의 훈련${r ? ` · ${r.name} ${dday === 0 ? "D-DAY" : `D-${dday}`}` : ""}`,
      body: lines.join("\n"), url: "/", tag: `today-${today}`,
    });
    const { data: subs } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", u.user_id);
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { await sb.from("push_subscriptions").delete().eq("id", s.id); removed++; }
        else errors.push(String((e as Error).message ?? e));
      }
    }
    if (!input.force) await sb.from("settings").update({ last_notified_on: today }).eq("user_id", u.user_id);
  }
  return Response.json({ hour, today, targets: targets.length, sent, removed, errors });
});
