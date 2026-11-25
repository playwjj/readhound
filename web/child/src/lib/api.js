// API for the child app. A 401 flips `auth.ok` so App shows the PIN pad.
// A failed fetch is an Offline error: reading goes on from the device copy.
import { reactive } from "vue";
import { net, toast } from "@shared/ui.js";

export const auth = reactive({ ok: true });
export { toast };

export class Offline extends Error {
  constructor() {
    super("网络断开了");
    this.offline = true;
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await net(path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new Offline();
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") {
    auth.ok = false;
    throw new Error("login");
  }
  if (!res.ok) throw new Error(data.error || `出错了（${res.status}）`);
  return data;
}

/** Quest calls need the network (answers are judged on the server). Offline → a gentle note, nothing lost. */
export async function questApi(method, path, body) {
  try {
    return await api(method, path, body);
  } catch (e) {
    if (e.offline) toast("闯关需要联网：连上网再点一次，读过的进度都还在", 3200);
    else if (e.message !== "login") toast(e.message);
    return null;
  }
}

/** Upload a recording (fluency / retell); returns the JSON answer or throws a child-friendly message. */
export async function upload(path, blob, offlineMsg) {
  let res;
  try {
    res = await net(path, { method: "POST", body: blob, headers: { "content-type": blob.type }, credentials: "same-origin" });
  } catch {
    throw new Error(offlineMsg);
  }
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) {
    auth.ok = false;
    throw new Error("请重新输入密码");
  }
  if (!res.ok) throw new Error(d.error || "出错了");
  return d;
}
