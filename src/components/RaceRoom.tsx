import React, { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Flag,
  Flame,
  Link2,
  Play,
  RotateCcw,
  Share2,
  Trophy,
} from 'lucide-react';
import { soundEngine } from '../lib/sound';
import {
  saveCompletedRaceToFirestore,
  type SaveRaceOutcome,
} from '../services/recordsService';
import type { RoomSnapshot, TrackFeature, TrackId } from '../shared/raceTypes';
import { TRACKS } from '../shared/trackData';
import RaceCanvas from './RaceCanvas';

interface RaceRoomProps {
  user: User;
  clientId: string;
  snapshot: RoomSnapshot;
  features: TrackFeature[];
  onSendConfig: (cfg: { trackId?: TrackId; maxPlayers?: number; fillWithBots?: boolean }) => void;
  onStartRace: () => void;
  onRematch: () => void;
  onSendInput: (steer: -1 | 0 | 1, boost: boolean) => void;
  onLeaveRoom: () => void;
  onOpenGlobalRecords: (trackId: TrackId, highlightTimeMs?: number | null) => void;
}

function formatRaceTime(ms: number | null): string {
  if (ms === null) return '--.--s';
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function RaceRoom({
  user,
  clientId,
  snapshot,
  features,
  onSendConfig,
  onStartRace,
  onRematch,
  onSendInput,
  onLeaveRoom,
  onOpenGlobalRecords,
}: RaceRoomProps) {
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);
  const [savedRaceFlag, setSavedRaceFlag] = useState(false);
  const [savingRecord, setSavingRecord] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState<SaveRaceOutcome | null>(null);

  // Multi-touch input tracking for mobile thumb buttons + keyboard
  const leftHeldRef = useRef(false);
  const rightHeldRef = useRef(false);
  const dragSteerRef = useRef<-1 | 0 | 1>(0);
  const boostHeldRef = useRef(false);

  const [uiSteer, setUiSteer] = useState<-1 | 0 | 1>(0);
  const [uiBoost, setUiBoost] = useState(false);

  const prevCountdownRef = useRef<number>(snapshot.countdownSec);
  const prevPhaseRef = useRef(snapshot.phase);
  const prevBoostPadRef = useRef(0);
  const prevStumbleRef = useRef(0);
  const prevAirRef = useRef(0);
  const prevHoleshotRef = useRef(false);
  const prevNitroRef = useRef(60);

  const isHost = snapshot.hostId === clientId;
  const myRider = snapshot.riders.find((r) => r.id === clientId) || snapshot.riders[0];
  const shareUrl = `${window.location.origin}${window.location.pathname}?race=${snapshot.roomCode}`;
  const canNativeShare = typeof navigator !== 'undefined' && Boolean(navigator.share);

  function syncAndEmitInput() {
    let steer: -1 | 0 | 1 = 0;
    if (leftHeldRef.current && !rightHeldRef.current) steer = -1;
    else if (rightHeldRef.current && !leftHeldRef.current) steer = 1;
    else if (dragSteerRef.current !== 0) steer = dragSteerRef.current;

    const boost = boostHeldRef.current;
    setUiSteer(steer);
    setUiBoost(boost);
    onSendInput(steer, boost);
  }

  // Keyboard support for desktop players (includes Boost during COUNTDOWN for Holeshot)
  useEffect(() => {
    if (snapshot.phase !== 'RACING' && snapshot.phase !== 'COUNTDOWN') return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        if (!leftHeldRef.current) {
          leftHeldRef.current = true;
          syncAndEmitInput();
        }
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        if (!rightHeldRef.current) {
          rightHeldRef.current = true;
          syncAndEmitInput();
        }
      } else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        if (!boostHeldRef.current) {
          boostHeldRef.current = true;
          syncAndEmitInput();
        }
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        leftHeldRef.current = false;
        syncAndEmitInput();
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        rightHeldRef.current = false;
        syncAndEmitInput();
      } else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        boostHeldRef.current = false;
        syncAndEmitInput();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  // Reset held buttons when returning to lobby or finishing
  useEffect(() => {
    if (snapshot.phase !== 'RACING' && snapshot.phase !== 'COUNTDOWN') {
      leftHeldRef.current = false;
      rightHeldRef.current = false;
      dragSteerRef.current = 0;
      boostHeldRef.current = false;
      setUiSteer(0);
      setUiBoost(false);
    }
    if (snapshot.phase === 'WAITING' || snapshot.phase === 'COUNTDOWN') {
      setSavedRaceFlag(false);
      setSavingRecord(false);
      setSaveOutcome(null);
    }
  }, [snapshot.phase]);

  // Stop engine sound on unmount
  useEffect(() => {
    return () => {
      soundEngine.stopEngine();
    };
  }, []);

  // Audio cues for countdown, engine synth, boost pads, ramps, pickups, stumbles, and finish
  useEffect(() => {
    if (snapshot.phase === 'COUNTDOWN' && snapshot.countdownSec !== prevCountdownRef.current) {
      soundEngine.playCountdown(false);
      prevCountdownRef.current = snapshot.countdownSec;
    }
    if (prevPhaseRef.current === 'COUNTDOWN' && snapshot.phase === 'RACING') {
      soundEngine.playCountdown(true);
      soundEngine.startEngine();
    }
    if (prevPhaseRef.current !== 'FINISHED' && snapshot.phase === 'FINISHED') {
      soundEngine.stopEngine();
      soundEngine.playFinish(myRider?.rank === 1);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(myRider?.rank === 1 ? [40, 30, 60] : 30);
      }
    }
    if (snapshot.phase === 'WAITING') {
      soundEngine.stopEngine();
    }
    prevPhaseRef.current = snapshot.phase;
  }, [snapshot.phase, snapshot.countdownSec, myRider?.rank]);

  useEffect(() => {
    if (!myRider || snapshot.phase !== 'RACING') return;

    if (myRider.finished) {
      soundEngine.stopEngine();
    } else {
      soundEngine.updateEngine(
        myRider.speed / 65,
        myRider.boosting || myRider.boostPadTimer > 0,
        myRider.airTimer > 0
      );
    }

    if (myRider.holeshot && !prevHoleshotRef.current) {
      soundEngine.playHoleshot();
      navigator.vibrate?.(45);
    }
    if (myRider.airTimer > 0.55 && prevAirRef.current <= 0.55) {
      soundEngine.playRampJump();
      navigator.vibrate?.(25);
    }
    if (myRider.boostPadTimer > 0.8 && prevBoostPadRef.current <= 0.8 && !myRider.holeshot) {
      soundEngine.playBoostPad();
      navigator.vibrate?.(25);
    }
    if (myRider.stumbleTimer > 0.4 && prevStumbleRef.current <= 0.4) {
      soundEngine.playStumble();
      navigator.vibrate?.([30, 20, 30]);
    }
    if (myRider.nitro - prevNitroRef.current > 22 && prevAirRef.current <= 0.55) {
      soundEngine.playPickup();
    }

    prevBoostPadRef.current = myRider.boostPadTimer;
    prevStumbleRef.current = myRider.stumbleTimer;
    prevAirRef.current = myRider.airTimer;
    prevHoleshotRef.current = myRider.holeshot;
    prevNitroRef.current = myRider.nitro;
  }, [myRider, snapshot.phase]);

  // Persist finished race to Firestore
  useEffect(() => {
    if (snapshot.phase !== 'FINISHED' || savedRaceFlag) return;
    setSavedRaceFlag(true);
    setSavingRecord(true);
    saveCompletedRaceToFirestore({ snapshot, user, isHost })
      .then((outcome) => {
        if (outcome) setSaveOutcome(outcome);
      })
      .catch((err) => {
        console.error('Failed to save race record:', err);
      })
      .finally(() => {
        setSavingRecord(false);
      });
  }, [snapshot, user, isHost, savedRaceFlag]);

  function handleCopy(value: string, type: 'code' | 'link') {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    });
  }

  async function handleNativeShare() {
    if (!canNativeShare) return;
    try {
      await navigator.share({
        title: 'Apex Moto Multiplayer Race',
        text: `Race me on ${TRACKS[snapshot.trackId].name}! Room Code: ${snapshot.roomCode}`,
        url: shareUrl,
      });
    } catch {
      // Dismissed
    }
  }

  // --- WAITING ROOM ---
  if (snapshot.phase === 'WAITING') {
    const humanCount = snapshot.riders.filter((r) => !r.isBot).length;
    const canStart = isHost && (snapshot.fillWithBots || humanCount >= 2);

    return (
      <main className="min-h-[calc(100vh-61px)] cyber-grid-surface flex items-center justify-center px-4 py-6">
        <section className="w-full max-w-xl rounded-2xl border border-slate-800 bg-[#111622] p-5 sm:p-7 space-y-5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={onLeaveRoom}
              className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Leave Room</span>
            </button>
            <span className="font-mono text-xs text-cyan-300 tabular-nums">
              {humanCount} / {snapshot.maxPlayers} Connected
            </span>
          </div>

          <div>
            <h1 className="font-display text-2xl font-bold text-white">Starting Grid Lobby</h1>
            <p className="text-sm text-slate-400 mt-1">
              {TRACKS[snapshot.trackId].name} · {snapshot.trackLength}m Sprint
            </p>
          </div>

          {/* Share Code & Invite Link */}
          <div className="space-y-3 border-y border-slate-800 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="block text-xs text-slate-400">Room Code</span>
                <span className="font-mono text-3xl font-bold tracking-[0.18em] text-cyan-300 tabular-nums">
                  {snapshot.roomCode}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(snapshot.roomCode, 'code')}
                className="min-h-[44px] flex items-center gap-1.5 rounded-xl border border-slate-700 bg-[#090B10] px-4 py-2 text-xs font-medium text-slate-200 hover:border-cyan-400/50"
              >
                {copiedType === 'code' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                readOnly
                value={shareUrl}
                aria-label="Race invite link"
                className="flex-1 min-h-[44px] rounded-xl border border-slate-800 bg-[#090B10] px-3 py-2 font-mono text-xs text-slate-300 truncate"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(shareUrl, 'link')}
                  className="flex-1 sm:flex-none min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 px-4 py-2 text-xs font-medium text-cyan-200 whitespace-nowrap"
                >
                  {copiedType === 'link' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="h-3.5 w-3.5" />
                      <span>Copy Invite</span>
                    </>
                  )}
                </button>
                {canNativeShare && (
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-[#090B10] px-3.5 py-2 text-xs font-medium text-slate-200"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    <span>Share</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Host Controls for Track / Bots */}
          {isHost && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="block text-xs text-slate-400 mb-1.5">Circuit</span>
                <select
                  value={snapshot.trackId}
                  onChange={(e) => onSendConfig({ trackId: e.target.value as TrackId })}
                  className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#090B10] px-3 py-2 text-sm text-white"
                >
                  {(Object.keys(TRACKS) as TrackId[]).map((id) => (
                    <option key={id} value={id}>
                      {TRACKS[id].name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="block text-xs text-slate-400 mb-1.5">AI Rivals</span>
                <button
                  type="button"
                  onClick={() => onSendConfig({ fillWithBots: !snapshot.fillWithBots })}
                  className={`w-full min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                    snapshot.fillWithBots
                      ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                      : 'border-slate-700 bg-[#090B10] text-slate-300'
                  }`}
                >
                  {snapshot.fillWithBots
                    ? `Fill Empty Slots (${snapshot.maxPlayers} Bikes Total)`
                    : 'Humans Only'}
                </button>
              </div>
            </div>
          )}

          {/* Connected Roster */}
          <div className="space-y-2">
            <h2 className="text-xs font-medium text-slate-400">Riders on the Line</h2>
            <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-[#090B10]">
              {Array.from({ length: snapshot.maxPlayers }).map((_, idx) => {
                const rider = snapshot.riders[idx];
                return (
                  <div key={idx} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: rider ? rider.color : '#334155' }}
                      />
                      {rider ? (
                        <span className="font-medium text-white truncate">
                          {rider.name}
                          {rider.id === clientId ? ' (You)' : ''}
                          {rider.id === snapshot.hostId ? ' · Host' : ''}
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          {snapshot.fillWithBots ? 'AI Rival Slot' : 'Waiting for friend...'}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-xs text-slate-400">Lane {idx + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {isHost ? (
            <button
              type="button"
              onClick={onStartRace}
              disabled={!canStart}
              className="w-full min-h-[50px] flex items-center justify-center gap-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-display font-bold text-base px-5 py-3 transition-colors disabled:opacity-40"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>
                {canStart ? 'Start Race' : 'Waiting for another player...'}
              </span>
            </button>
          ) : (
            <p className="py-2 text-center text-sm text-cyan-300">
              Waiting for the room host to start the race...
            </p>
          )}
        </section>
      </main>
    );
  }

  // --- ACTIVE RACE / COUNTDOWN / FINISHED ---
  const sortedStandings = [...snapshot.riders].sort((a, b) => a.rank - b.rank);
  const distRemaining = myRider
    ? Math.max(0, Math.round(snapshot.trackLength - myRider.z))
    : snapshot.trackLength;
  const speedKmh = myRider ? Math.round(myRider.speed * 3.6) : 0;

  return (
    <main className="h-[calc(100dvh-61px)] cyber-grid-surface flex flex-col px-2 py-2 sm:px-6 sm:py-4 overflow-hidden">
      <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col lg:grid lg:grid-cols-12 gap-3 min-h-0">
        {/* Left / Center: Shared Race Screen + Bottom Thumb Controls */}
        <div className="lg:col-span-8 flex-1 flex flex-col gap-2 min-h-0">
          {/* Compact Top Race Telemetry Strip */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#111622] px-3 py-2 shrink-0">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onLeaveRoom}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Exit</span>
              </button>
              <div className="font-mono text-xs sm:text-sm font-bold text-white tabular-nums">
                <span className="text-cyan-300">#{myRider?.rank || 1}</span>
                <span className="text-slate-500">/{snapshot.riders.length}</span>
              </div>
              <span className="font-mono text-xs text-slate-300 tabular-nums">
                {speedKmh} km/h
              </span>
            </div>

            <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
              {myRider && myRider.airTimer > 0 && (
                <span className="text-fuchsia-300 font-semibold">AIR TIME</span>
              )}
              {myRider?.holeshot && (
                <span className="text-emerald-300 font-semibold">HOLESHOT</span>
              )}
              {myRider?.drafting && snapshot.phase === 'RACING' && myRider.airTimer <= 0 && (
                <span className="text-emerald-400 font-semibold">SLIPSTREAM</span>
              )}
              {myRider && myRider.boostPadTimer > 0 && !myRider.holeshot && (
                <span className="text-emerald-300 font-semibold">PAD BOOST</span>
              )}
              <span className="text-slate-300">{distRemaining}m to finish</span>
            </div>
          </div>

          {/* Shared-Screen Track Canvas + Side Start-to-Finish Progress Rail */}
          <div className="relative flex-1 flex gap-2 min-h-0">
            <div className="relative flex-1 min-h-0">
              <RaceCanvas
                snapshot={snapshot}
                features={features}
                myClientId={clientId}
                localSteer={uiSteer}
                onDragSteer={(steer) => {
                  dragSteerRef.current = steer;
                  syncAndEmitInput();
                }}
              />

              {/* Countdown Overlay */}
              {snapshot.phase === 'COUNTDOWN' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/45 rounded-xl pointer-events-none">
                  <div className="text-center space-y-1.5 px-4">
                    <span className="block font-display text-7xl font-bold text-cyan-300 drop-shadow-[0_0_24px_rgba(0,240,255,0.6)] tabular-nums">
                      {snapshot.countdownSec > 0 ? snapshot.countdownSec : 'GO!'}
                    </span>
                    <span className="block font-mono text-xs text-slate-200">
                      {TRACKS[snapshot.trackId].name}
                    </span>
                    <span
                      className={`block font-mono text-xs font-semibold ${
                        snapshot.countdownSec === 1 ? 'text-emerald-300' : 'text-slate-400'
                      }`}
                    >
                      {snapshot.countdownSec === 1
                        ? 'TAP BOOST NOW FOR HOLESHOT!'
                        : 'Get ready: Tap BOOST on 1 for Holeshot'}
                    </span>
                  </div>
                </div>
              )}

              {/* Finished Podium Overlay */}
              {snapshot.phase === 'FINISHED' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm rounded-xl p-4">
                  <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#111622] p-5 sm:p-6 space-y-4">
                    <div className="flex items-center gap-3">
                      <Trophy className="h-7 w-7 text-amber-400 shrink-0" />
                      <div className="min-w-0">
                        <h2 className="font-display text-xl font-bold text-white">
                          {sortedStandings[0]?.id === clientId
                            ? 'You Won the Race!'
                            : `${sortedStandings[0]?.name || 'Winner'} Takes 1st Place`}
                        </h2>
                        <p className="text-xs text-slate-400">
                          {TRACKS[snapshot.trackId].name}
                          <span aria-hidden="true"> · </span>
                          {savingRecord ? (
                            <span className="text-cyan-300">Saving score...</span>
                          ) : saveOutcome?.isNewPersonalBest ? (
                            <span className="text-emerald-400 font-medium">
                              {saveOutcome.previousBestMs !== null
                                ? `New Personal Best (-${((saveOutcome.previousBestMs - saveOutcome.bestTimeMs) / 1000).toFixed(2)}s)`
                                : 'New Personal Best posted!'}
                            </span>
                          ) : (
                            <span>Personal best synced</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-[#090B10]">
                      {sortedStandings.map((rider) => (
                        <div
                          key={rider.id}
                          className="flex items-center justify-between px-3.5 py-2.5 text-sm"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="font-mono text-xs text-slate-400 w-5 tabular-nums">
                              #{rider.rank}
                            </span>
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: rider.color }}
                            />
                            <span className="font-medium text-white truncate">
                              {rider.name}
                              {rider.id === clientId ? ' (You)' : ''}
                            </span>
                          </div>
                          <div className="font-mono text-xs text-cyan-300 shrink-0 tabular-nums">
                            {formatRaceTime(rider.finishTimeMs)}
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      disabled={savingRecord}
                      onClick={() =>
                        onOpenGlobalRecords(snapshot.trackId, myRider?.finishTimeMs ?? null)
                      }
                      className="w-full min-h-[46px] flex items-center justify-center gap-2 rounded-xl border border-amber-400/50 bg-amber-500/10 hover:bg-amber-500/20 px-4 py-2 font-display text-sm font-bold text-amber-300 transition-colors disabled:opacity-50"
                    >
                      <Trophy className="h-4 w-4 text-amber-400" />
                      <span>
                        {savingRecord ? 'Syncing Global Records...' : 'View Global Records'}
                      </span>
                    </button>

                    <div className="flex gap-2.5">
                      {isHost ? (
                        <button
                          type="button"
                          onClick={onRematch}
                          className="flex-1 min-h-[46px] flex items-center justify-center gap-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 font-display text-sm font-bold text-slate-950 transition-colors"
                        >
                          <RotateCcw className="h-4 w-4" />
                          <span>Race Again</span>
                        </button>
                      ) : (
                        <div className="flex-1 min-h-[46px] flex items-center justify-center rounded-xl border border-slate-700 text-xs text-slate-300">
                          Host can start rematch
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={onLeaveRoom}
                        className="min-h-[46px] rounded-xl border border-slate-700 bg-[#090B10] hover:border-slate-500 px-4 py-2 font-display text-sm font-semibold text-slate-200"
                      >
                        Lobby
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Vertical Start-to-Finish Progress Rail (Always shows all riders to the finish line) */}
            <div
              className="w-8 sm:w-10 rounded-xl border border-slate-800 bg-[#111622] py-2 flex flex-col items-center justify-between relative shrink-0"
              aria-label="Race progress to finish line"
            >
              <Flag className="h-3.5 w-3.5 text-white shrink-0" />
              <div className="relative flex-1 w-1 my-2 rounded-full bg-slate-800">
                {snapshot.riders.map((r) => {
                  const pct = Math.min(100, Math.max(0, (r.z / snapshot.trackLength) * 100));
                  const isMe = r.id === clientId;
                  return (
                    <div
                      key={r.id}
                      style={{
                        bottom: `${pct}%`,
                        backgroundColor: r.color,
                      }}
                      title={`${r.name}: ${Math.round(pct)}%`}
                      className={`absolute left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full transition-all duration-75 ${
                        isMe
                          ? 'h-3.5 w-3.5 ring-2 ring-white z-10'
                          : 'h-2.5 w-2.5 opacity-90'
                      }`}
                    />
                  );
                })}
              </div>
              <span className="font-mono text-[9px] text-slate-500">GO</span>
            </div>
          </div>

          {/* Mobile Thumb Control Deck */}
          <div className="grid grid-cols-3 gap-2 shrink-0 pb-1">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                leftHeldRef.current = true;
                syncAndEmitInput();
              }}
              onPointerUp={() => {
                leftHeldRef.current = false;
                syncAndEmitInput();
              }}
              onPointerCancel={() => {
                leftHeldRef.current = false;
                syncAndEmitInput();
              }}
              onPointerLeave={() => {
                if (leftHeldRef.current) {
                  leftHeldRef.current = false;
                  syncAndEmitInput();
                }
              }}
              disabled={snapshot.phase !== 'RACING'}
              className={`min-h-[64px] sm:min-h-[68px] flex flex-col items-center justify-center rounded-xl border font-display text-xs font-bold transition-colors touch-none select-none ${
                uiSteer === -1
                  ? 'border-cyan-400 bg-cyan-500/25 text-white'
                  : 'border-slate-700 bg-[#111622] text-slate-200'
              } disabled:opacity-40`}
            >
              <ChevronLeft className="h-6 w-6 text-cyan-300" />
              <span>LEFT</span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                boostHeldRef.current = true;
                syncAndEmitInput();
              }}
              onPointerUp={() => {
                boostHeldRef.current = false;
                syncAndEmitInput();
              }}
              onPointerCancel={() => {
                boostHeldRef.current = false;
                syncAndEmitInput();
              }}
              onPointerLeave={() => {
                if (boostHeldRef.current) {
                  boostHeldRef.current = false;
                  syncAndEmitInput();
                }
              }}
              disabled={
                snapshot.phase === 'FINISHED' ||
                (snapshot.phase === 'RACING' && (myRider?.nitro ?? 0) <= 4)
              }
              className={`relative overflow-hidden min-h-[64px] sm:min-h-[68px] flex flex-col items-center justify-center rounded-xl border font-display text-xs font-bold transition-colors touch-none select-none ${
                uiBoost
                  ? 'border-emerald-400 bg-emerald-500/25 text-white'
                  : snapshot.phase === 'COUNTDOWN' && snapshot.countdownSec === 1
                  ? 'border-emerald-400/80 bg-emerald-500/15 text-emerald-200'
                  : 'border-cyan-500/50 bg-[#111622] text-cyan-200'
              } disabled:opacity-40`}
            >
              {/* Live Nitro Tank Fill Background */}
              <div
                className="absolute bottom-0 left-0 top-0 bg-cyan-500/20 pointer-events-none transition-all duration-75"
                style={{ width: `${Math.round(myRider?.nitro ?? 0)}%` }}
              />
              <Flame className="relative z-10 h-5 w-5 text-cyan-300" />
              <span className="relative z-10 tabular-nums">
                {snapshot.phase === 'COUNTDOWN'
                  ? 'HOLESHOT'
                  : `BOOST ${Math.round(myRider?.nitro ?? 0)}%`}
              </span>
            </button>

            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                rightHeldRef.current = true;
                syncAndEmitInput();
              }}
              onPointerUp={() => {
                rightHeldRef.current = false;
                syncAndEmitInput();
              }}
              onPointerCancel={() => {
                rightHeldRef.current = false;
                syncAndEmitInput();
              }}
              onPointerLeave={() => {
                if (rightHeldRef.current) {
                  rightHeldRef.current = false;
                  syncAndEmitInput();
                }
              }}
              disabled={snapshot.phase !== 'RACING'}
              className={`min-h-[64px] sm:min-h-[68px] flex flex-col items-center justify-center rounded-xl border font-display text-xs font-bold transition-colors touch-none select-none ${
                uiSteer === 1
                  ? 'border-cyan-400 bg-cyan-500/25 text-white'
                  : 'border-slate-700 bg-[#111622] text-slate-200'
              } disabled:opacity-40`}
            >
              <ChevronRight className="h-6 w-6 text-cyan-300" />
              <span>RIGHT</span>
            </button>
          </div>
        </div>

        {/* Desktop Sidebar: Live Pack Standings & Booster Guide */}
        <aside className="hidden lg:flex lg:col-span-4 flex-col gap-4">
          <section className="rounded-2xl border border-slate-800 bg-[#111622] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-white">Live Standings</h2>
              <span className="font-mono text-xs text-slate-400 tabular-nums">
                {formatRaceTime(snapshot.elapsedMs)}
              </span>
            </div>

            <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-xl bg-[#090B10]">
              {sortedStandings.map((r) => {
                const progressPct = Math.min(
                  100,
                  Math.round((r.z / snapshot.trackLength) * 100)
                );
                return (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between gap-3 px-3.5 py-3 text-sm ${
                      r.id === clientId ? 'bg-slate-800/40' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-xs text-slate-400 w-5 tabular-nums">
                        #{r.rank}
                      </span>
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="font-medium text-white truncate">
                        {r.name}
                        {r.id === clientId ? ' (You)' : ''}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-cyan-300 tabular-nums shrink-0">
                      {r.finished ? formatRaceTime(r.finishTimeMs) : `${progressPct}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-[#111622] p-5 space-y-2.5 text-xs text-slate-300">
            <h2 className="font-display text-sm font-bold text-white">Track Guide</h2>
            <p>
              <strong className="text-emerald-400">Holeshot Start:</strong> Tap Boost when the countdown hits 1 for an instant launch surge.
            </p>
            <p>
              <strong className="text-emerald-400">Green Chevron Pads:</strong> Instant hyper-boost surge.
            </p>
            <p>
              <strong className="text-fuchsia-300">Gold/Violet Ramps:</strong> Launch over hazards, gain speed, and earn +20% Nitro.
            </p>
            <p>
              <strong className="text-cyan-300">Blue Nitro Orbs (N):</strong> Refills +36% of your Nitro tank.
            </p>
            <p>
              <strong className="text-rose-400">Red Barriers:</strong> Slows your bike briefly—steer around, jump over, or boost through.
            </p>
            <p className="text-slate-400 pt-1">
              Keyboard: A/D or Arrow Keys to steer, Space or W to boost.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
