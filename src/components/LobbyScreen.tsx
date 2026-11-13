import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { ArrowRight, Flag, Trophy, Users, Zap } from 'lucide-react';
import { fetchRecentRaces, fetchTrackLeaderboard } from '../services/recordsService';
import type { RaceResultDoc, TrackId, TrackRecordDoc } from '../shared/raceTypes';
import { TRACKS } from '../shared/trackData';

interface LobbyScreenProps {
  user: User;
  initialJoinCode: string;
  onCreateRoom: (config: {
    trackId: TrackId;
    maxPlayers: number;
    fillWithBots: boolean;
  }) => void;
  onJoinRoom: (roomCode: string) => void;
  onOpenGlobalRecords: (trackId: TrackId) => void;
}

function formatMs(ms: number): string {
  const secs = ms / 1000;
  return `${secs.toFixed(2)}s`;
}

export default function LobbyScreen({
  user,
  initialJoinCode,
  onCreateRoom,
  onJoinRoom,
  onOpenGlobalRecords,
}: LobbyScreenProps) {
  const [trackId, setTrackId] = useState<TrackId>('coastal');
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [fillWithBots, setFillWithBots] = useState<boolean>(true);
  const [joinCode, setJoinCode] = useState<string>(initialJoinCode || '');
  const [leaderboard, setLeaderboard] = useState<TrackRecordDoc[]>([]);
  const [recentRaces, setRecentRaces] = useState<RaceResultDoc[]>([]);
  const [loadingBoard, setLoadingBoard] = useState<boolean>(true);

  useEffect(() => {
    if (initialJoinCode) setJoinCode(initialJoinCode);
  }, [initialJoinCode]);

  useEffect(() => {
    let active = true;
    setLoadingBoard(true);
    Promise.allSettled([fetchTrackLeaderboard(trackId), fetchRecentRaces(user.uid)])
      .then(([recordsRes, racesRes]) => {
        if (!active) return;
        if (recordsRes.status === 'fulfilled') {
          setLeaderboard(recordsRes.value);
        } else {
          console.error('Track leaderboard load error:', recordsRes.reason);
        }
        if (racesRes.status === 'fulfilled') {
          setRecentRaces(racesRes.value);
        } else {
          console.error('Recent races load error:', racesRes.reason);
        }
      })
      .finally(() => {
        if (active) setLoadingBoard(false);
      });
    return () => {
      active = false;
    };
  }, [trackId, user.uid]);

  function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = joinCode.trim().toUpperCase();
    if (!cleaned) return;
    onJoinRoom(cleaned);
  }

  return (
    <main className="min-h-[calc(100vh-61px)] cyber-grid-surface px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Race Paddock</h1>
            <p className="text-sm text-slate-400 mt-1">
              Pick a circuit, host a live race room for your friends, or join with a room code.
            </p>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
            <p className="font-mono text-xs text-slate-400">
              Rider: <span className="text-slate-200">{user.displayName || 'Rider'}</span>
            </p>
            <button
              type="button"
              onClick={() => onOpenGlobalRecords(trackId)}
              className="min-h-[44px] flex items-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/20 px-4 py-2 font-display text-xs sm:text-sm font-bold text-amber-300 transition-colors whitespace-nowrap shrink-0"
            >
              <Trophy className="h-4 w-4 text-amber-400" />
              <span>Global Records</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Create Race Room */}
          <section className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#111622] p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-2.5 text-cyan-400">
              <Flag className="h-5 w-5" />
              <h2 className="font-display text-xl font-bold text-white">Create Live Race</h2>
            </div>

            {/* Track Selection */}
            <div className="space-y-2">
              <span className="block text-xs font-medium text-slate-400">Select Circuit</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {(Object.keys(TRACKS) as TrackId[]).map((id) => {
                  const t = TRACKS[id];
                  const selected = trackId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTrackId(id)}
                      className={`min-h-[72px] rounded-xl border p-3 text-left transition-colors ${
                        selected
                          ? 'border-cyan-400 bg-cyan-500/15'
                          : 'border-slate-800 bg-[#090B10] hover:border-slate-700'
                      }`}
                    >
                      <span
                        className="block font-display text-sm font-bold text-white"
                        style={selected ? { color: t.accentHex } : undefined}
                      >
                        {t.name}
                      </span>
                      <span className="block font-mono text-[11px] text-slate-400 mt-1 tabular-nums">
                        {t.lengthMeters}m Sprint
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-400">{TRACKS[trackId].subtitle}</p>
            </div>

            {/* Grid Size & AI Rivals */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="block text-xs font-medium text-slate-400 mb-2">
                  Grid Capacity
                </span>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#090B10] border border-slate-800">
                  {[2, 3, 4].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setMaxPlayers(count)}
                      className={`min-h-[42px] rounded-lg text-xs font-medium transition-colors ${
                        maxPlayers === count
                          ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {count} Bikes
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-400 mb-2">
                  Empty Grid Slots
                </span>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#090B10] border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setFillWithBots(true)}
                    className={`min-h-[42px] rounded-lg text-xs font-medium transition-colors ${
                      fillWithBots
                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    AI Rivals On
                  </button>
                  <button
                    type="button"
                    onClick={() => setFillWithBots(false)}
                    className={`min-h-[42px] rounded-lg text-xs font-medium transition-colors ${
                      !fillWithBots
                        ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Humans Only
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onCreateRoom({ trackId, maxPlayers, fillWithBots })}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-display font-bold text-sm px-5 py-3 transition-colors"
            >
              <Zap className="h-4 w-4 fill-current" />
              <span>Open Race Room</span>
            </button>
          </section>

          {/* Join by Code & Track Leaderboard */}
          <div className="lg:col-span-5 space-y-5">
            <section className="rounded-2xl border border-slate-800 bg-[#111622] p-5 space-y-3">
              <div className="flex items-center gap-2 text-pink-400">
                <Users className="h-5 w-5" />
                <h2 className="font-display text-lg font-bold text-white">Join Friend’s Race</h2>
              </div>
              <form onSubmit={handleJoinSubmit} className="flex gap-2">
                <input
                  type="text"
                  maxLength={10}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Room code (e.g. K9X4M2)"
                  className="flex-1 min-h-[46px] rounded-xl border border-slate-700 bg-[#090B10] px-3.5 py-2 font-mono text-sm tracking-widest text-white placeholder:tracking-normal placeholder:text-slate-500 uppercase focus:border-cyan-400 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!joinCode.trim()}
                  className="min-h-[46px] flex items-center gap-1.5 rounded-xl border border-cyan-400/60 bg-cyan-500/15 hover:bg-cyan-500/25 px-4 py-2 font-display text-sm font-bold text-cyan-200 transition-colors disabled:opacity-40 shrink-0"
                >
                  <span>Join</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            </section>

            {/* Fastest Times Leaderboard */}
            <section className="rounded-2xl border border-slate-800 bg-[#111622] p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Trophy className="h-4 w-4 text-amber-400 shrink-0" />
                  <h2 className="font-display text-base font-bold text-white truncate">
                    {TRACKS[trackId].name} Records
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenGlobalRecords(trackId)}
                  className="font-mono text-xs text-cyan-300 hover:text-cyan-200 transition-colors whitespace-nowrap shrink-0"
                >
                  View All
                </button>
              </div>

              {loadingBoard ? (
                <p className="py-4 text-xs text-slate-400">Loading track records...</p>
              ) : leaderboard.length === 0 ? (
                <p className="py-4 text-xs text-slate-400">
                  No times posted on this circuit yet. Finish a race to claim #1!
                </p>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {leaderboard.map((rec, idx) => (
                    <div
                      key={`${rec.uid}_${rec.trackId}`}
                      className="flex items-center justify-between py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono text-slate-400 w-5 tabular-nums">
                          #{idx + 1}
                        </span>
                        <span className="font-medium text-white truncate">
                          {rec.displayName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 font-mono shrink-0 tabular-nums">
                        <span className="text-slate-400">{rec.topSpeedKmh} km/h</span>
                        <span className="text-cyan-300 font-semibold">
                          {formatMs(rec.bestTimeMs)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Recent Races */}
        {recentRaces.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-[#111622] p-5 space-y-3">
            <h2 className="font-display text-base font-bold text-white">Your Recent Races</h2>
            <div className="divide-y divide-slate-800/80">
              {recentRaces.map((race) => {
                const winner = race.standings[0];
                return (
                  <div
                    key={race.raceId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2 text-slate-300">
                      <span className="font-mono text-cyan-300">{race.roomCode}</span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span>{TRACKS[race.trackId]?.name || race.trackId}</span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span>{race.standings.length} riders</span>
                    </div>
                    {winner && (
                      <span className="font-mono text-amber-300 tabular-nums">
                        1st: {winner.name} ({formatMs(winner.finishTimeMs)})
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
