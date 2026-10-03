// Fantasy content for the kids' studio. Pure data + tiny helpers: no audio, nothing about the child is stored.
// A chapter = one short story beat that asks for one level. `sound` + `mode` build the level; the story is just the wrapper.
import { validateLevel } from '../../levelSchema.js'

export const AVATARS = [
  { id: 'lumi', name: 'Lumi', kind: 'lantern sprite', badge: '🕯️', body: [255, 155, 84], glow: [255, 208, 138], blurb: 'Glows brighter when you sing!' },
  { id: 'ember', name: 'Ember', kind: 'baby dragon', badge: '🐲', body: [96, 200, 120], glow: [180, 255, 160], blurb: 'Breathes sparkles, not fire.' },
  { id: 'stardust', name: 'Stardust', kind: 'unicorn', badge: '🦄', body: [255, 170, 220], glow: [255, 230, 250], blurb: 'Her horn lights up with every sound.' },
  { id: 'merlo', name: 'Merlo', kind: 'tiny wizard', badge: '🧙', body: [130, 110, 240], glow: [200, 190, 255], blurb: 'Knows 1,000 spells. Needs your voice.' },
  { id: 'fizz', name: 'Fizz', kind: 'cloud fairy', badge: '🧚', body: [120, 200, 255], glow: [220, 245, 255], blurb: 'Floats, twirls and giggles.' },
]

export const WORLDS = {
  cave: { name: 'Crystal Cave', emoji: '💎', sky: ['#0b1030', '#1b2a5c', '#2a4a7a'], wave: [120, 230, 255], spark: [190, 245, 255], deco: ['💎', '✨', '🔮', '💠'] },
  clouds: { name: 'Cloud Kingdom', emoji: '🏰', sky: ['#2a2f6e', '#6a63b8', '#f2a6c8'], wave: [255, 220, 240], spark: [255, 240, 200], deco: ['☁️', '🏰', '🌈', '🦋'] },
  forest: { name: 'Whisper Woods', emoji: '🌲', sky: ['#07201c', '#0f3d33', '#2d6a4f'], wave: [170, 255, 170], spark: [220, 255, 140], deco: ['🍄', '🌲', '🦉', '🧚'] },
  volcano: { name: 'Dragon Mountain', emoji: '🌋', sky: ['#200a14', '#53182a', '#a8452a'], wave: [255, 190, 90], spark: [255, 220, 120], deco: ['🔥', '🌋', '🐉', '💥'] },
  sea: { name: 'Starlit Sea', emoji: '🐙', sky: ['#05122e', '#0b3a6b', '#1c7a8c'], wave: [140, 240, 230], spark: [200, 255, 250], deco: ['🐙', '🫧', '🐚', '🐳'] },
}

// Sounds to pick from (the child, or a grown-up, can also type their own).
export const SOUNDS = ['ba', 'ma', 'pa', 'da', 'ta', 'ka', 'na', 'la', 'wa', 'ha', 'a', 'o', 'ee', 'oo', 'mmm', 'sss'].filter((s) => /^[a-z]{1,6}$/.test(s))
export const MODES = [
  { id: 'pop', label: 'Pop it', hint: 'Say it a few times', icon: '✨' },
  { id: 'train', label: 'Again & again', hint: 'Like a drum', icon: '🥁' },
  { id: 'hold', label: 'Hold it', hint: 'Keep it going', icon: '🚂' },
]

export const cleanSound = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 6)

// Build a level from a sound + mode. Returns null if the sound is not valid.
export function makeLevel(sound, mode = 'pop', extra = {}) {
  const s = cleanSound(sound); if (!s) return null
  const base = { id: `fun-${mode}-${s}`, label: `“${s}”`, ...extra }
  const spec = mode === 'train' ? { ...base, type: 'syllable_train', syllable: s, minSyllables: 5, durationSec: 5 }
    : mode === 'hold' ? { ...base, type: 'sustained_voicing', sound: s[0], syllable: s, targetDurationSec: 2 }
    : { ...base, type: 'cv_syllable', syllable: s, reps: 3 }
  const v = validateLevel(spec)
  return v.ok ? { ...v.level, syllable: s } : null
}

export const GLIDE = (dir) => ({ id: `glide-${dir}`, type: 'pitch_glide', direction: dir, minRangeSemitones: 4, label: dir === 'up' ? 'Slide up' : 'Slide down' })
export const RAMP = (dir) => ({ id: `ramp-${dir}`, type: 'loudness_ramp', direction: dir, minRangeDb: 10, label: dir === 'up' ? 'Quiet to loud' : 'Loud to quiet' })

// ---------- The Saga: 10 realms x 5 chapters = 50 chapters, one continuing story ----------
// who = speaking character. twist = plot turn (the sound gets swapped for a surprise one). One idea per chapter: a sound or a slide.
export const CAST = {
  skarn: { name: 'Old Skarn', icon: '🐉' }, gnorb: { name: 'Gnorbert the Gnome', icon: '🧌' }, brine: { name: 'Captain Brine', icon: '🐙' },
  oona: { name: 'Oona the Whale', icon: '🐳' }, twink: { name: 'Twinkle the Star', icon: '⭐' }, pip: { name: 'Pip the Cloud-Sheep', icon: '🐑' },
  zeph: { name: 'Queen Zephyra', icon: '👸' }, hoot: { name: 'Professor Hoot', icon: '🦉' }, bram: { name: 'Bramble the Bear', icon: '🐻' },
  echo: { name: 'Echo', icon: '👻' }, clank: { name: 'Sir Clank', icon: '🤖' }, mira: { name: 'Mira the Mirror Fairy', icon: '🧚' },
  zed: { name: 'Zed the Time-Turtle', icon: '🐢' }, grum: { name: 'Grumblor the Hush', icon: '🌫️' }, narr: { name: 'Storyteller', icon: '📖' },
}
const C = (who, text, o = {}) => ({ who, text, ...o })
export const QUESTS = [
  { id: 'dragon', world: 'volcano', title: '1. The Sleepy Dragon', icon: '🐉', blurb: 'A huge dragon snores. Only your voice can wake him!', prize: { icon: '🐲', name: 'Dragon Scale' }, chapters: [
    C('narr', 'A strange grey fog has swallowed every sound in the kingdom. Only YOU still have a voice! It leads you up Dragon Mountain…', { sound: 'pa', mode: 'pop' }),
    C('skarn', '*snore* Mmm? Who tickles my nose? Do it again, little one!', { sound: 'pa', mode: 'pop' }),
    C('gnorb', 'Psst! I’m Gnorbert. Beat the drum so Skarn wakes up happy! (I may have hidden his socks.)', { sound: 'ba', mode: 'train' }),
    C('skarn', 'Aaah, a yawn is coming. Yawn WITH me!', { sound: 'a', mode: 'hold', twist: 'Gnorbert swapped the dragon’s yawn for a sneeze! Quick, say the new word!' }),
    C('skarn', 'I’m awake! The Hush stole my roar. Start soft, then get LOUDER, and I’ll teach you my secret!', { ramp: 'up' }),
  ] },
  { id: 'star', world: 'sea', title: '2. The Lost Star', icon: '⭐', blurb: 'A little star fell in the sea. Bring it home!', prize: { icon: '🐚', name: 'Star Shell' }, chapters: [
    C('brine', 'Ahoy! Captain Brine here, eight arms and no clue. A star fell in our sea! Call “ma” across the waves!', { sound: 'ma', mode: 'pop' }),
    C('oona', 'I hear you, tiny singer. Hum a long song like a whale!', { sound: 'mmm', mode: 'hold' }),
    C('twink', 'Hic! I’m Twinkle. I’m stuck high up! Slide your voice UP like a rising bubble!', { glide: 'up' }),
    C('brine', 'Careful! The tide flipped, and Twinkle is sinking!', { glide: 'down', twist: 'The sea turned upside down! Say the surprise sound to hold the tide!' }),
    C('twink', 'Sing “la la la” and I’ll fly home! I’ll remember you, wherever the Hush hides.', { sound: 'la', mode: 'train' }),
  ] },
  { id: 'bridge', world: 'clouds', title: '3. The Rainbow Bridge', icon: '🌈', blurb: 'The cloud castle’s bridge lost its colours!', prize: { icon: '🌈', name: 'Rainbow Ribbon' }, chapters: [
    C('pip', 'Baaa! I’m Pip. The bridge is grey! Red first: pop out “ba”!', { sound: 'ba', mode: 'pop' }),
    C('pip', 'Orange! Say “da” like raindrops!', { sound: 'da', mode: 'pop' }),
    C('zeph', 'I am Queen Zephyra. Stretch the green: ooooo!', { sound: 'o', mode: 'hold', twist: 'A cloud-sheep ate the green! Say the new word to make more!' }),
    C('pip', 'Violet! Slide down like a rainbow slide!', { glide: 'down' }),
    C('zeph', 'The last colour sings “ka ka ka”! Then I must tell you who took our music…', { sound: 'ka', mode: 'train' }),
  ] },
  { id: 'potion', world: 'forest', title: '4. The Giggle Potion', icon: '🧪', blurb: 'The owl lost his giggle. Brew it back!', prize: { icon: '🦉', name: 'Owl Feather' }, chapters: [
    C('hoot', 'Hoo hoo! Professor Hoot. I lost my giggle! Stir the cauldron: “wa wa wa”!', { sound: 'wa', mode: 'train' }),
    C('bram', 'Grrr, I’m Bramble, I’m not scary, I swear. Add one “pa” at a time.', { sound: 'pa', mode: 'pop' }),
    C('hoot', 'It bubbles! Make a quiet bubble that gets BIG!', { ramp: 'up' }),
    C('gnorb', 'It was me who took the giggle! The Hush made me. I’m SO sorry. Say “ha ha” to fix it!', { sound: 'ha', mode: 'pop', twist: 'Plot twist! Gnorbert was working for the Hush… but he’s switching sides!' }),
    C('hoot', 'The giggle is back! Hold “eeee” like a magic whistle to seal it.', { sound: 'ee', mode: 'hold' }),
  ] },
  { id: 'cave', world: 'cave', title: '5. The Echo Crystals', icon: '🔮', blurb: 'The crystals glow for a friendly voice.', prize: { icon: '🔮', name: 'Echo Crystal' }, chapters: [
    C('echo', 'Hello hello hello… I’m Echo. I only repeat! Knock with “ta”!', { sound: 'ta', mode: 'pop' }),
    C('echo', 'Na na na… na na… na! Copy me!', { sound: 'na', mode: 'train' }),
    C('mira', 'I’m Mira, I live in the crystals. Find the secret door: slide HIGH like a bat!', { glide: 'up' }),
    C('echo', 'Can you trick me? Say something I don’t expect!', { sound: 'ta', mode: 'pop', twist: 'The echo is copying you, but silly! Say the surprise sound!' }),
    C('mira', 'The Hush has a map! Hum “mmm” until the whole cave glows and we can read it!', { sound: 'mmm', mode: 'hold' }),
  ] },
  { id: 'honey', world: 'forest', title: '6. The Great Honey Heist', icon: '🍯', blurb: 'Someone stole Bramble’s honey. Detective time!', prize: { icon: '🍯', name: 'Golden Honey' }, chapters: [
    C('bram', 'My honey is GONE! Sniff the clues: “sss” like a detective!', { sound: 'sss', mode: 'hold' }),
    C('hoot', 'Tiny footprints! Whisper “ka ka ka” to follow them.', { sound: 'ka', mode: 'train' }),
    C('pip', 'Baa! I saw a shadow! Slide up the tree to look!', { glide: 'up' }),
    C('gnorb', 'It wasn’t me this time, promise! Pop “bo” for the secret knock.', { sound: 'bo', mode: 'pop', twist: 'The thief left a trick lock! Say the surprise sound to open it!' }),
    C('bram', 'The thief was… the Hush’s fog-bees! They’re building a fortress. We must hurry!', { ramp: 'up' }),
  ] },
  { id: 'clank', world: 'clouds', title: '7. The Clockwork Castle', icon: '🏰', blurb: 'Sir Clank’s gears are stuck. Wind him up with your voice!', prize: { icon: '⚙️', name: 'Golden Gear' }, chapters: [
    C('clank', 'BEEP. Sir Clank, knight of the sky. My gears are silent. Tick-tock with “ti ti ti”!', { sound: 'ti', mode: 'train' }),
    C('zeph', 'Wind the great clock: hold “ooo” as it turns.', { sound: 'oo', mode: 'hold' }),
    C('clank', 'WHIRR! Pop “bee”, one at a time, for each gear!', { sound: 'bee', mode: 'pop' }),
    C('zed', 'I’m Zed, the time-turtle. Slooowly slide down… time bends for those who are patient.', { glide: 'down', twist: 'Time glitched! The words changed. Say the new sound!' }),
    C('clank', 'The clock chimes: the Hush’s fortress rises at dawn. Get LOUD to ring the alarm bell!', { ramp: 'up' }),
  ] },
  { id: 'library', world: 'sea', title: '8. The Sunken Library', icon: '📚', blurb: 'The Hush hid its secret in the deep.', prize: { icon: '📚', name: 'Wise Book' }, chapters: [
    C('hoot', 'Books sleep underwater, and they only wake to “shhh”… no wait, to “moo”! Pop it!', { sound: 'moo', mode: 'pop' }),
    C('brine', 'Octo-librarian reporting! Say “na na na” to flip the pages.', { sound: 'na', mode: 'train' }),
    C('oona', 'Dive deep. Slide your voice all the way down…', { glide: 'down' }),
    C('mira', 'This book is written in mirror words! Hold “eee” and the letters turn around.', { sound: 'ee', mode: 'hold', twist: 'The pages shuffled! Say the surprise sound to unscramble them!' }),
    C('hoot', 'It says: “The Hush is only lonely. It stole sounds because nobody ever listened to it.” Whisper then LOUD: reply to the book!', { ramp: 'up' }),
  ] },
  { id: 'fortress', world: 'volcano', title: '9. The Hush Fortress', icon: '🌫️', blurb: 'Grumblor the Hush is hiding behind a wall of silence.', prize: { icon: '🛡️', name: 'Brave Badge' }, chapters: [
    C('skarn', 'Hop on my back! The wall of silence is thick. Break it with “pa pa pa”!', { sound: 'pa', mode: 'train' }),
    C('clank', 'ALERT. Guard goblins. Say “ba”, short and sharp, to hop past them!', { sound: 'ba', mode: 'pop' }),
    C('gnorb', 'I know a secret way in! Slide up the drainpipe, quietly!', { glide: 'up' }),
    C('grum', 'WHO DARES… I mean, uh, hello? Nobody’s talked to me in a thousand years.', { sound: 'ha', mode: 'pop', twist: 'The Hush is not what it seems! Say the surprise sound softly.' }),
    C('mira', 'Be kind and be brave. Hold “aaa” steady so Grumblor knows we’re not afraid.', { sound: 'a', mode: 'hold' }),
  ] },
  { id: 'chorus', world: 'cave', title: '10. The Final Chorus', icon: '🎶', blurb: 'Every friend sings together to bring the sounds back!', prize: { icon: '👑', name: 'Hero’s Crown' }, chapters: [
    C('grum', 'I only wanted someone to hear me… Will you teach me to make a sound? Say “mo”!', { sound: 'mo', mode: 'pop' }),
    C('pip', 'Baaa! Everyone’s here! Sing “la la la” with me!', { sound: 'la', mode: 'train' }),
    C('zeph', 'The whole kingdom joins in: slide up, up, up to the stars!', { glide: 'up' }),
    C('echo', 'I’ll carry your voice to every corner! Hold one long note!', { sound: 'o', mode: 'hold', twist: 'The finale has a secret twist! Say the surprise sound!' }),
    C('narr', 'And now the loudest, happiest sound of all. Quiet… quieter… then ROAR with joy!', { ramp: 'up' }),
  ] },
]

const SURPRISE_SOUNDS = ['ba', 'ma', 'pa', 'da', 'ta', 'ka']
export function chapterLevel(ch, twisted, quest, i) {
  const base = ch.glide ? GLIDE(ch.glide) : ch.ramp ? RAMP(ch.ramp)
    : makeLevel(twisted && ch.mode !== 'hold' ? SURPRISE_SOUNDS[(i * 3 + quest.id.length) % SURPRISE_SOUNDS.length] : ch.sound, ch.mode)
  return base ? { ...base, id: `${quest.id}-${i}${twisted ? '-t' : ''}` } : null
}

export const SURPRISES = [
  { icon: '🎩', text: 'A wizard hat appeared on your friend!', gift: '🎩' },
  { icon: '👑', text: 'A tiny crown fell from the sky!', gift: '👑' },
  { icon: '🕶️', text: 'Cool shades! Your friend feels super cool.', gift: '🕶️' },
  { icon: '🎀', text: 'A magic bow tied itself on!', gift: '🎀' },
  { icon: '🦋', text: 'A butterfly landed on your friend’s head!', gift: '🦋' },
  { icon: '🌟', text: 'A shooting star granted you a sparkly wish!', gift: '🌟' },
]
