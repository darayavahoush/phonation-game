import { createRoot } from 'react-dom/client'
import PhonationStudio from '../ui/studio/index.js'
import { ServerRecognizer } from '../recognition/serverRecognizer.js'

// Server-side sound check (Modal). Off unless VITE_SCORER_URL is set at build time.
const useServer = !!import.meta.env.VITE_SCORER_URL
async function serverRecognizerFactory() {
  const r = new ServerRecognizer()
  try { await r.ready() } catch (e) { console.warn('Scorer not reachable yet:', e.message) } // wakes Modal; recognize() reports errors itself
  return r
}
createRoot(document.getElementById('r')).render(
  useServer ? <PhonationStudio recognizerFactory={serverRecognizerFactory} serverCheck /> : <PhonationStudio />
)
