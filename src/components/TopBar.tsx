import React from 'react';
import type { User } from 'firebase/auth';
import { LogOut, Volume2, VolumeX } from 'lucide-react';
import type { SocketStatus } from '../services/raceSocket';

interface TopBarProps {
  user: User | null;
  muted: boolean;
  socketStatus: SocketStatus;
  onToggleMute: () => void;
  onGoHome: () => void;
  onSignOut: () => void;
  onShowRules: () => void;
  onOpenGlobalRecords: () => void;
}

export default function TopBar({
  user,
  muted,
  socketStatus,
  onToggleMute,
  onGoHome,
  onSignOut,
  onShowRules,
  onOpenGlobalRecords,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#090B10]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:gap-8 sm:px-6">
        <button
          type="button"
          onClick={onGoHome}
          className="font-display text-lg font-bold tracking-wider text-white whitespace-nowrap shrink-0 hover:text-cyan-300 transition-colors"
        >
          APEX <span className="text-cyan-400">MOTO</span>
        </button>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          {user && (
            <>
              <button
                type="button"
                onClick={onGoHome}
                className="hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                Race Lobby
              </button>
              <button
                type="button"
                onClick={onOpenGlobalRecords}
                className="hover:text-amber-300 transition-colors whitespace-nowrap shrink-0"
              >
                Global Records
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onShowRules}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            How to Race
          </button>
          <span className="font-mono text-xs text-slate-500 whitespace-nowrap shrink-0">
            {socketStatus === 'connected'
              ? 'Live Sync Ready'
              : socketStatus === 'connecting'
              ? 'Connecting...'
              : 'Reconnecting...'}
          </span>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-[#111622] text-slate-300 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          {user && (
            <div className="flex items-center gap-2.5">
              <span className="hidden sm:inline max-w-[140px] truncate text-sm font-medium text-slate-200">
                {user.displayName || 'Rider'}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-800 bg-[#111622] px-3 py-2 text-xs font-medium text-slate-300 hover:border-pink-500/50 hover:text-pink-300 transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
