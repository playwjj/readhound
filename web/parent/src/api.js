// API calls for the parent console. A 401/403 flips `auth.ok` so App shows the
// login card; the page the parent was on comes back after signing in.
import { reactive } from "vue";
import { net, toast } from "@shared/ui.js";

export const auth = reactive({ ok: null }); // null = not checked yet
export { toast };

export async function api(method, path, body) {
  const headers = { "x-rh-area": "parent" };
  if (body) headers["content-type"] = "application/json";
  const res = await net(path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    auth.ok = false;
    throw new Error("login");
  }
  if (!res.ok) throw new Error(data.error || `出错了（${res.status}）`);
  return data;
}

/** Run an action; show its error as a toast (the "login" error is handled by App). */
export async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.message !== "login") toast(e.message);
    return undefined;
  }
}
