import type { FeedbackKind } from './scan-model'

/**
 * Optional sound + vibration after the SERVER answered a scan (never
 * before). Both fail silently where unsupported (iOS has no vibration;
 * audio needs a prior user gesture, which opening the scanner is).
 */

const SOUND_KEY = 'krunameclass:scan-sound'

export function readSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off')
  } catch {
    // Private mode — the in-memory toggle still applies.
  }
}

let audio: AudioContext | null = null

function tone(frequency: number, startAt: number, duration: number) {
  if (!audio) return
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain).connect(audio.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

export function playScanFeedback(kind: FeedbackKind, soundEnabled: boolean): void {
  try {
    navigator.vibrate?.(kind === 'success' ? 60 : kind === 'warning' ? [40, 60, 40] : [120, 60, 120])
  } catch {
    // Vibration unsupported.
  }
  if (!soundEnabled) return
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audio ??= new Ctx()
    if (audio.state === 'suspended') void audio.resume()
    const now = audio.currentTime
    if (kind === 'success') tone(1046, now, 0.12)
    else if (kind === 'warning') {
      tone(784, now, 0.09)
      tone(784, now + 0.14, 0.09)
    } else tone(220, now, 0.28)
  } catch {
    // Audio unavailable — visual feedback still applies.
  }
}
