import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trophy, X } from 'lucide-react';
import { fetchGlobalLeaderboard, fetchMyBestForTrack } from '../services/recordsService';
import type { TrackId, TrackRecordDoc } from '../shared/raceTypes';
import { TRACKS } from '../shared/trackData';

interface GlobalRecordsModalProps {
  isOpen: boolean;
  initialTrackId?: TrackId;
  currentUid: string;
  highlightTimeMs?: number | null;
  onClose: () => void;
}

function formatTimeMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function GlobalRecordsModal({
  isOpen,
  initialTrackId = 'coastal',
  currentUid,
  highlightTimeMs,
  onClose,
}: GlobalRecordsModalProps) {
  const [selectedTrack, setSelectedTrack] = useState<TrackId>(initialTrackId);
  const [records, setRecords] = useState<TrackRecordDoc[]>([]);
  const [myRecord, setMyRecord] = useState<TrackRecordDoc | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setSelectedTrack(initialTrackId);
    }
  }, [isOpen, initialTrackId]);

  const loadRecords = useCallback(
    async (trackId: TrackId) => {
      setLoading(true);
      setErrorMsg('');
      try {
        const [board, mine] = await Promise.all([
          fetchGlobalLeaderboard(trackId, 25),
          fetchMyBestForTrack(currentUid, trackId),
        ]);
        setRecords(board);
        setMyRecord(mine);
      } catch (err) {
        console.error('Failed to fetch global records:', err);
        setErrorMsg('Could not load global records right now. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [currentUid]
  );

  useEffect(() => {
    if (!isOpen) return;
    loadRecords(selectedTrack);
  }, [isOpen, selectedTrack, loadRecords]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const trackMeta = TRACKS[selectedTrack];
  const leaderTimeMs = records[0]?.bestTimeMs ?? null;
  const myRankIndex = records.findIndex((r) => r.uid === currentUid);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="global-records-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-2xl border border-slate-700 bg-[#111622] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <Trophy className="h-5 w-5 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <h2
                id="global-records-title"
                className="font-display text-xl font-bold text-white truncate"
              >
                Global Records
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Fastest verified sprint times synced from Firestore
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => loadRecords(selectedTrack)}
              disabled={loading}
              aria-label="Refresh global records"
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-700 bg-[#090B10] px-3 py-2 text-xs font-medium text-slate-200 hover:border-cyan-400/50 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-cyan-300' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Global Records"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-[#090B10] text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Circuit Filter Tabs */}
        <div className="border-b border-slate-800 px-5 py-3 bg-[#0D111B]">
          <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-slate-800 bg-[#090B10] p-1">
            {(Object.keys(TRACKS) as TrackId[]).map((id) => {
              const t = TRACKS[id];
              const active = selectedTrack === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedTrack(id)}
                  className={`min-h-[44px] rounded-lg px-2 py-2 text-center transition-colors ${
                    active
                      ? 'bg-cyan-500/20 text-white border border-cyan-400/50'
                      : 'text-slate-400 hover:text-white border border-transparent'
                  }`}
                >
                  <span
                    className="block font-display text-xs sm:text-sm font-bold truncate"
                    style={active ? { color: t.accentHex } : undefined}
                  >
                    {t.name}
                  </span>
                  <span className="block font-mono text-[11px] text-slate-400 tabular-nums">
                    {t.lengthMeters}m
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Records List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{trackMeta.subtitle}</span>
            {highlightTimeMs && selectedTrack === initialTrackId && (
              <span className="font-mono text-cyan-300 shrink-0 tabular-nums">
                Last Run: {formatTimeMs(highlightTimeMs)}
              </span>
            )}
          </div>

          {errorMsg ? (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200 flex items-center justify-between gap-3">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => loadRecords(selectedTrack)}
                className="min-h-[40px] rounded-lg border border-red-400/50 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500/20 whitespace-nowrap shrink-0"
              >
                Retry
              </button>
            </div>
          ) : loading && records.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Loading fastest {trackMeta.name} times...
            </div>
          ) : records.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-[#090B10] px-4 py-10 text-center space-y-2">
              <p className="font-display text-base font-bold text-white">
                No Official Records Yet
              </p>
              <p className="text-xs text-slate-400">
                Complete a sprint on {trackMeta.name} to claim the #1 global spot.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-[#090B10] divide-y divide-slate-800/80">
              <div className="grid grid-cols-12 gap-2 px-3.5 py-2 text-[11px] font-medium text-slate-400">
                <span className="col-span-2">Rank</span>
                <span className="col-span-5">Rider</span>
                <span className="col-span-2 text-right hidden sm:block">Speed</span>
                <span className="col-span-5 sm:col-span-3 text-right">Best Time</span>
              </div>

              {records.map((rec, idx) => {
                const rank = idx + 1;
                const isMe = rec.uid === currentUid;
                const deltaMs = leaderTimeMs !== null ? rec.bestTimeMs - leaderTimeMs : 0;

                return (
                  <div
                    key={`${rec.uid}_${rec.trackId}`}
                    className={`grid grid-cols-12 items-center gap-2 px-3.5 py-3 text-sm ${
                      isMe ? 'bg-cyan-500/10' : ''
                    }`}
                  >
                    <div className="col-span-2 font-mono text-xs font-bold tabular-nums">
                      <span
                        className={
                          rank === 1
                            ? 'text-amber-400'
                            : rank === 2
                            ? 'text-slate-200'
                            : rank === 3
                            ? 'text-amber-600'
                            : 'text-slate-400'
                        }
                      >
                        #{rank}
                      </span>
                    </div>

                    <div className="col-span-5 min-w-0">
                      <p className="font-medium text-white truncate">
                        {rec.displayName}
                        {isMe ? ' (You)' : ''}
                      </p>
                      <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {rec.racesWon}W / {rec.racesPlayed}R
                        <span className="sm:hidden"> · {rec.topSpeedKmh} km/h</span>
                      </p>
                    </div>

                    <div className="col-span-2 hidden sm:block text-right font-mono text-xs text-slate-300 tabular-nums">
                      {rec.topSpeedKmh} km/h
                    </div>

                    <div className="col-span-5 sm:col-span-3 text-right font-mono tabular-nums">
                      <span
                        className={`block text-sm font-bold ${
                          rank === 1 ? 'text-amber-300' : 'text-cyan-300'
                        }`}
                      >
                        {formatTimeMs(rec.bestTimeMs)}
                      </span>
                      <span className="block text-[11px] text-slate-400">
                        {rank === 1 ? 'Record' : `+${formatTimeMs(deltaMs)}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer: Player's Personal Best Summary */}
        <div className="border-t border-slate-800 bg-[#090B10] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          {myRecord ? (
            <div className="text-xs text-slate-300 space-y-0.5">
              <div className="font-medium text-white">
                Your Best on {trackMeta.name}:{' '}
                <span className="font-mono text-cyan-300 font-bold tabular-nums">
                  {formatTimeMs(myRecord.bestTimeMs)}
                </span>
                {myRankIndex >= 0 && (
                  <span className="text-slate-400 font-mono tabular-nums">
                    {' '}
                    · Global #{myRankIndex + 1}
                  </span>
                )}
              </div>
              <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                Top Speed {myRecord.topSpeedKmh} km/h · {myRecord.racesWon} Wins /{' '}
                {myRecord.racesPlayed} Races
                {leaderTimeMs !== null && myRecord.bestTimeMs > leaderTimeMs
                  ? ` · +${formatTimeMs(myRecord.bestTimeMs - leaderTimeMs)} off #1`
                  : leaderTimeMs !== null
                  ? ' · Current #1 Record Holder'
                  : ''}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              Finish a race on {trackMeta.name} to post your personal best to the global board.
            </p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl bg-cyan-400 hover:bg-cyan-300 px-5 py-2 font-display text-sm font-bold text-slate-950 transition-colors whitespace-nowrap shrink-0"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
