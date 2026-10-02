import { createRoot } from 'react-dom/client'
import PhonationGame from '../ui/PhonationGame.jsx'

createRoot(document.getElementById('root')).render(
  <PhonationGame onResult={(r) => console.log('phonation result', r)} />
)
