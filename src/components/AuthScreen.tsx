import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';

interface AuthScreenProps {
  pendingJoinCode: string;
}

export default function AuthScreen({ pendingJoinCode }: AuthScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSignIn() {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed. Please try again.';
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-61px)] cyber-grid-surface flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <section className="lg:col-span-7 space-y-5">
          <p className="font-mono text-xs tracking-widest text-cyan-400">
            Mobile Multiplayer Bike Racing
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white text-balance leading-[1.08]">
            Race side-by-side to the finish line.
          </h1>
          <p className="text-base text-slate-300 leading-relaxed max-w-xl">
            Compete live on your phone with up to four riders on the same shared screen.
            Hit green boost pads, grab nitro canisters, draft behind rivals, and fire your
            turbo across the checkered finish line.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-800/80">
            <div>
              <h2 className="font-display text-sm font-semibold text-white">Shared Screen Pack</h2>
              <p className="text-xs text-slate-400 mt-1">
                Every racer stays visible together on your phone from start grid to finish.
              </p>
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">Boosters & Slipstream</h2>
              <p className="text-xs text-slate-400 mt-1">
                Ride over chevron boost pads, scoop nitro orbs, and draft behind leaders.
              </p>
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">Thumb Controls</h2>
              <p className="text-xs text-slate-400 mt-1">
                Auto-throttle lets you focus on steering left, right, and firing nitro.
              </p>
            </div>
          </div>
        </section>

        <section className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#111622] p-6 sm:p-8 space-y-6">
          <div>
            <h2 className="font-display text-xl font-bold text-white">
              Sign in to hit the track
            </h2>
            <p className="text-sm text-slate-400 mt-1.5">
              Sign in with Google to race friends live and save your fastest track times.
            </p>
          </div>

          {pendingJoinCode && (
            <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
              Race invite detected for room <strong className="font-mono">{pendingJoinCode}</strong>. Sign in to join!
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading}
            className="w-full min-h-[48px] flex items-center justify-center gap-3 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-display font-bold text-sm px-5 py-3 transition-colors disabled:opacity-50"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" />
            </svg>
            <span>{loading ? 'Connecting...' : 'Sign in with Google'}</span>
          </button>
        </section>
      </div>
    </main>
  );
}
