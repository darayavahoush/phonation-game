const BASE = import.meta.env.VITE_SCORER_URL;

// Call once on page load so the Modal container is warm before the first clip.
export function warmScorer() {
  if (BASE) fetch(`${BASE}/health`).catch(() => {});
}

// target like "ta". Returns the JSON result, {noSpeech:true}, or throws.
export async function scoreClip(blob, target) {
  const fd = new FormData();
  fd.append('file', blob, 'clip.webm');
  fd.append('target', target);
  const r = await fetch(`${BASE}/score`, { method: 'POST', body: fd });
  if (r.status === 422) return { noSpeech: true };
  if (!r.ok) throw new Error('scorer ' + r.status);
  return r.json();
}
