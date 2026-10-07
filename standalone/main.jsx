import { createRoot } from 'react-dom/client'
import PhonationStudio from '../ui/studio/index.js'
import { ServerRecognizer } from '../recognition/serverRecognizer.js'

// Server-side sound check (Modal). Off unless VITE_SCORER_URL is set at build time.
const recognizer = import.meta.env.VITE_SCORER_URL ? new ServerRecognizer() : null
createRoot(document.getElementById('r')).render(<PhonationStudio recognizer={recognizer} />)
