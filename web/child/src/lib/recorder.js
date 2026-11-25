// Microphone recording for 朗读 and 复述.
export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/** Returns {start, stop, recording}; onDone(blob, ms) after stop (or after maxMs). */
export function recorder(onDone, onError, maxMs = 120000) {
  let rec = null, stream = null, t0 = 0, cap = null;
  return {
    get recording() { return rec?.state === "recording"; },
    get startedAt() { return t0; },
    async start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        onError("需要允许使用麦克风才能录音。请让爸爸妈妈在设置里打开。");
        return false;
      }
      const chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        clearTimeout(cap);
        stream.getTracks().forEach((t) => t.stop());
        onDone(new Blob(chunks, { type: rec.mimeType || "audio/mp4" }), Date.now() - t0);
      };
      rec.start();
      t0 = Date.now();
      cap = setTimeout(() => rec.state === "recording" && rec.stop(), maxMs);
      return true;
    },
    stop() { if (rec?.state === "recording") rec.stop(); },
  };
}
