import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { X } from 'lucide-react';
import AuthScreen from './components/AuthScreen';
import GlobalRecordsModal from './components/GlobalRecordsModal';
import LobbyScreen from './components/LobbyScreen';
import RaceRoom from './components/RaceRoom';
import TopBar from './components/TopBar';
import { auth } from './lib/firebase';
import { soundEngine } from './lib/sound';
import { RaceSocketClient, type SocketStatus } from './services/raceSocket';
import type { RoomSnapshot, TrackFeature, TrackId } from './shared/raceTypes';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [clientId, setClientId] = useState<string>('');
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [features, setFeatures] = useState<TrackFeature[]>([]);
  const [pendingJoinCode, setPendingJoinCode] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [muted, setMuted] = useState<boolean>(soundEngine.isMuted());
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [recordsModalState, setRecordsModalState] = useState<{
    open: boolean;
    trackId: TrackId;
    highlightTimeMs: number | null;
  }>({
    open: false,
    trackId: 'coastal',
    highlightTimeMs: null,
  });

  function openGlobalRecords(trackId: TrackId, highlightTimeMs: number | null = null) {
    setRecordsModalState({
      open: true,
      trackId,
      highlightTimeMs,
    });
  }

  const socketRef = useRef<RaceSocketClient | null>(null);

  // Check URL for ?race=CODE invite link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get('race') || params.get('join') || '').trim().toUpperCase();
    if (code) {
      setPendingJoinCode(code);
    }
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
  }, []);

  // Maintain live WebSocket connection while signed in
  useEffect(() => {
    if (!user) {
      socketRef.current?.destroy();
      socketRef.current = null;
      setRoomSnapshot(null);
      setFeatures([]);
      setClientId('');
      return;
    }

    const client = new RaceSocketClient({
      onStatus: (st) => setSocketStatus(st),
      onJoined: (cid, snap, feats) => {
        setClientId(cid);
        setRoomSnapshot(snap);
        setFeatures(feats);
        setErrorMsg('');
        client.setRoomReconnectInfo({
          roomCode: snap.roomCode,
          uid: user.uid,
          name: user.displayName || 'Rider',
        });
      },
      onState: (snap) => {
        setRoomSnapshot(snap);
      },
      onFeatures: (feats, snap) => {
        setFeatures(feats);
        setRoomSnapshot(snap);
      },
      onError: (msg) => {
        setErrorMsg(msg);
      },
    });
    socketRef.current = client;

    return () => {
      client.destroy();
      socketRef.current = null;
    };
  }, [user]);

  // Auto-join ?race=CODE once authenticated
  useEffect(() => {
    if (!user || !pendingJoinCode || roomSnapshot || !socketRef.current) return;
    const code = pendingJoinCode;
    setPendingJoinCode('');
    socketRef.current.send({
      type: 'room:join',
      roomCode: code,
      uid: user.uid,
      name: user.displayName || 'Rider',
    });
    window.history.replaceState({}, '', window.location.pathname);
  }, [user, pendingJoinCode, roomSnapshot]);

  function handleCreateRoom(cfg: {
    trackId: TrackId;
    maxPlayers: number;
    fillWithBots: boolean;
  }) {
    if (!user || !socketRef.current) return;
    setErrorMsg('');
    socketRef.current.send({
      type: 'room:create',
      uid: user.uid,
      name: user.displayName || 'Rider',
      trackId: cfg.trackId,
      maxPlayers: cfg.maxPlayers,
      fillWithBots: cfg.fillWithBots,
    });
  }

  function handleJoinRoom(roomCode: string) {
    if (!user || !socketRef.current) return;
    setErrorMsg('');
    socketRef.current.send({
      type: 'room:join',
      roomCode,
      uid: user.uid,
      name: user.displayName || 'Rider',
    });
  }

  function handleLeaveRoom() {
    socketRef.current?.setRoomReconnectInfo(null);
    socketRef.current?.send({ type: 'room:leave' });
    setRoomSnapshot(null);
    setFeatures([]);
    setErrorMsg('');
  }

  async function handleSignOut() {
    handleLeaveRoom();
    await signOut(auth);
  }

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100">
      <TopBar
        user={user}
        muted={muted}
        socketStatus={socketStatus}
        onToggleMute={() => setMuted(soundEngine.toggleMute())}
        onGoHome={handleLeaveRoom}
        onSignOut={handleSignOut}
        onShowRules={() => setShowRulesModal(true)}
        onOpenGlobalRecords={() =>
          openGlobalRecords(roomSnapshot?.trackId ?? 'coastal', null)
        }
      />

      {errorMsg && (
        <div className="mx-auto max-w-5xl px-4 pt-3">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg('')}
              className="text-red-200 hover:text-white"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {!authReady ? (
        <main className="min-h-[calc(100vh-61px)] cyber-grid-surface flex items-center justify-center">
          <p className="font-mono text-sm text-cyan-300">Checking rider session...</p>
        </main>
      ) : !user ? (
        <AuthScreen pendingJoinCode={pendingJoinCode} />
      ) : !roomSnapshot ? (
        <LobbyScreen
          user={user}
          initialJoinCode={pendingJoinCode}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onOpenGlobalRecords={(trackId) => openGlobalRecords(trackId, null)}
        />
      ) : (
        <RaceRoom
          user={user}
          clientId={clientId}
          snapshot={roomSnapshot}
          features={features}
          onSendConfig={(cfg) =>
            socketRef.current?.send({ type: 'room:config', ...cfg })
          }
          onStartRace={() => socketRef.current?.send({ type: 'race:start' })}
          onRematch={() => socketRef.current?.send({ type: 'race:rematch' })}
          onSendInput={(steer, boost) =>
            socketRef.current?.send({ type: 'race:input', steer, boost })
          }
          onLeaveRoom={handleLeaveRoom}
          onOpenGlobalRecords={(trackId, timeMs) =>
            openGlobalRecords(trackId, timeMs ?? null)
          }
        />
      )}

      {showRulesModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#111622] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-white">How to Race</h2>
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
              <p>
                <strong>1. Auto-Throttle & Steering:</strong> Your bike accelerates automatically.
                Hold <strong>LEFT</strong> or <strong>RIGHT</strong> (or drag on the road) to weave across lanes.
              </p>
              <p>
                <strong>2. Boosters & Drafting:</strong> Ride over green <strong>Boost Pads</strong> for an instant speed surge, collect blue <strong>Nitro Orbs</strong>, and tuck behind rivals to build slipstream speed.
              </p>
              <p>
                <strong>3. Shared Screen Finish:</strong> All racers stay framed together on your phone screen all the way to the checkered finish line!
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRulesModal(false)}
              className="w-full min-h-[44px] rounded-xl bg-cyan-400 hover:bg-cyan-300 font-display text-sm font-bold text-slate-950"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {user && (
        <GlobalRecordsModal
          isOpen={recordsModalState.open}
          initialTrackId={recordsModalState.trackId}
          currentUid={user.uid}
          highlightTimeMs={recordsModalState.highlightTimeMs}
          onClose={() =>
            setRecordsModalState((prev) => ({ ...prev, open: false }))
          }
        />
      )}
    </div>
  );
}
