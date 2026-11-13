import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  RaceResultDoc,
  RaceStanding,
  RoomSnapshot,
  TrackId,
  TrackRecordDoc,
} from '../shared/raceTypes';

function sanitizeName(raw: string | null | undefined): string {
  const trimmed = (raw || '').trim();
  return trimmed ? trimmed.slice(0, 60) : 'Rider';
}

export interface SaveRaceOutcome {
  isNewPersonalBest: boolean;
  bestTimeMs: number;
  previousBestMs: number | null;
}

export async function saveCompletedRaceToFirestore(params: {
  snapshot: RoomSnapshot;
  user: User;
  isHost: boolean;
}): Promise<SaveRaceOutcome | null> {
  const { snapshot, user, isHost } = params;
  const sorted = [...snapshot.riders].sort((a, b) => a.rank - b.rank);
  const myRider = sorted.find((r) => !r.isBot && r.uid === user.uid);
  if (!myRider) return null;

  // 1. Host records the shared race result document once
  if (isHost) {
    const raceId = `${snapshot.roomCode}_${Date.now()}`;
    const racePath = `races/${raceId}`;
    const memberUids = Array.from(
      new Set(sorted.filter((r) => !r.isBot).map((r) => r.uid))
    );
    if (memberUids.length === 0) memberUids.push(user.uid);

    const standings: RaceStanding[] = sorted.map((r) => ({
      name: r.name,
      uid: r.uid,
      rank: r.rank,
      finishTimeMs: Math.round(r.finishTimeMs ?? snapshot.elapsedMs),
      topSpeedKmh: Math.round(Math.max(50, r.topSpeedKmh)),
      isBot: r.isBot,
      color: r.color,
    }));

    try {
      await setDoc(doc(db, 'races', raceId), {
        raceId,
        roomCode: snapshot.roomCode,
        trackId: snapshot.trackId,
        hostUid: user.uid,
        memberUids,
        standings,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, racePath);
    }
  }

  // 2. Each human rider updates their personal best record on this track
  const recordId = `${user.uid}_${snapshot.trackId}`;
  const recordPath = `records/${recordId}`;
  const recordRef = doc(db, 'records', recordId);
  const myFinishMs = Math.round(
    Math.max(5000, Math.min(600000, myRider.finishTimeMs ?? snapshot.elapsedMs))
  );
  const myTopSpeed = Math.round(Math.max(50, Math.min(600, myRider.topSpeedKmh || 195)));
  const won = myRider.rank === 1 ? 1 : 0;

  let outcome: SaveRaceOutcome = {
    isNewPersonalBest: true,
    bestTimeMs: myFinishMs,
    previousBestMs: null,
  };

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(recordRef);
      if (!snap.exists()) {
        tx.set(recordRef, {
          uid: user.uid,
          displayName: sanitizeName(user.displayName),
          trackId: snapshot.trackId,
          bestTimeMs: myFinishMs,
          topSpeedKmh: myTopSpeed,
          racesWon: won,
          racesPlayed: 1,
          updatedAt: serverTimestamp(),
        });
        outcome = {
          isNewPersonalBest: true,
          bestTimeMs: myFinishMs,
          previousBestMs: null,
        };
      } else {
        const prev = snap.data() as TrackRecordDoc;
        const nextBest = Math.min(prev.bestTimeMs, myFinishMs);
        tx.update(recordRef, {
          displayName: sanitizeName(user.displayName),
          bestTimeMs: nextBest,
          topSpeedKmh: Math.max(prev.topSpeedKmh, myTopSpeed),
          racesWon: prev.racesWon + won,
          racesPlayed: prev.racesPlayed + 1,
          updatedAt: serverTimestamp(),
        });
        outcome = {
          isNewPersonalBest: myFinishMs < prev.bestTimeMs,
          bestTimeMs: nextBest,
          previousBestMs: prev.bestTimeMs,
        };
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, recordPath);
  }

  return outcome;
}

export async function fetchGlobalLeaderboard(
  trackId: TrackId,
  maxRows = 25
): Promise<TrackRecordDoc[]> {
  const path = 'records';
  try {
    const q = query(
      collection(db, 'records'),
      where('bestTimeMs', '>', 0),
      orderBy('bestTimeMs', 'asc'),
      limit(250)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as TrackRecordDoc)
      .filter((r) => r.trackId === trackId)
      .sort((a, b) => a.bestTimeMs - b.bestTimeMs || b.topSpeedKmh - a.topSpeedKmh)
      .slice(0, maxRows);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchTrackLeaderboard(trackId: TrackId): Promise<TrackRecordDoc[]> {
  return fetchGlobalLeaderboard(trackId, 8);
}

export async function fetchRecentRaces(uid: string): Promise<RaceResultDoc[]> {
  const path = 'races';
  try {
    const q = query(
      collection(db, 'races'),
      where('memberUids', 'array-contains', uid),
      limit(8)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as RaceResultDoc)
      .sort((a, b) => {
        const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
        return tb - ta;
      });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchMyBestForTrack(
  uid: string,
  trackId: TrackId
): Promise<TrackRecordDoc | null> {
  const recordId = `${uid}_${trackId}`;
  const path = `records/${recordId}`;
  try {
    const snap = await getDoc(doc(db, 'records', recordId));
    return snap.exists() ? (snap.data() as TrackRecordDoc) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}
