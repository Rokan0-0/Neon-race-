export type TrackId = 'coastal' | 'canyon' | 'midnight';

export type RoomPhase = 'WAITING' | 'COUNTDOWN' | 'RACING' | 'FINISHED';

export interface TrackDefinition {
  id: TrackId;
  name: string;
  subtitle: string;
  lengthMeters: number;
  accentHex: string;
  roadHex: string;
  shoulderHex: string;
  curbHexA: string;
  curbHexB: string;
}

export interface TrackFeature {
  id: string;
  kind: 'boost_pad' | 'nitro_orb' | 'hazard' | 'ramp';
  z: number;
  lane: number; // -0.85 to +0.85
  width: number;
}

export interface RiderState {
  id: string;
  uid: string;
  name: string;
  slot: number;
  color: string;
  isBot: boolean;
  connected: boolean;
  x: number; // -1.0 (left edge) to +1.0 (right edge)
  z: number; // 0 to trackLength
  vx: number;
  speed: number; // forward m/s
  lean: number; // -1 to +1
  nitro: number; // 0 to 100
  boosting: boolean;
  boostPadTimer: number;
  stumbleTimer: number;
  airTimer: number; // > 0 when airborne off a ramp
  holeshot: boolean;
  drafting: boolean;
  rank: number;
  finished: boolean;
  finishTimeMs: number | null;
  topSpeedKmh: number;
}

export interface RoomSnapshot {
  roomCode: string;
  hostId: string;
  trackId: TrackId;
  trackLength: number;
  maxPlayers: number;
  fillWithBots: boolean;
  phase: RoomPhase;
  countdownSec: number;
  elapsedMs: number;
  cameraZ: number;
  riders: RiderState[];
  collectedIds: string[];
  serverTime: number;
}

export interface RaceStanding {
  name: string;
  uid: string;
  rank: number;
  finishTimeMs: number;
  topSpeedKmh: number;
  isBot: boolean;
  color: string;
}

export interface RaceResultDoc {
  raceId: string;
  roomCode: string;
  trackId: TrackId;
  hostUid: string;
  memberUids: string[];
  standings: RaceStanding[];
  createdAt?: unknown;
}

export interface TrackRecordDoc {
  uid: string;
  displayName: string;
  trackId: TrackId;
  bestTimeMs: number;
  topSpeedKmh: number;
  racesWon: number;
  racesPlayed: number;
  updatedAt?: unknown;
}

export interface RiderInputPacket {
  steer: -1 | 0 | 1;
  boost: boolean;
}

export const RIDER_COLORS = [
  '#00F0FF', // Electric Cyan
  '#FF2A85', // Neon Crimson
  '#FFB800', // Solar Amber
  '#22C55E', // Volt Green
] as const;

export type ClientToServerMessage =
  | {
      type: 'room:create';
      uid: string;
      name: string;
      trackId?: TrackId;
      maxPlayers?: number;
      fillWithBots?: boolean;
    }
  | {
      type: 'room:join';
      roomCode: string;
      uid: string;
      name: string;
    }
  | {
      type: 'room:config';
      trackId?: TrackId;
      maxPlayers?: number;
      fillWithBots?: boolean;
    }
  | { type: 'race:start' }
  | { type: 'race:rematch' }
  | { type: 'race:input'; steer: -1 | 0 | 1; boost: boolean }
  | { type: 'room:leave' };

export type ServerToClientMessage =
  | {
      type: 'room:joined';
      clientId: string;
      snapshot: RoomSnapshot;
      features: TrackFeature[];
    }
  | {
      type: 'room:state';
      snapshot: RoomSnapshot;
    }
  | {
      type: 'race:features';
      features: TrackFeature[];
      snapshot: RoomSnapshot;
    }
  | {
      type: 'room:error';
      message: string;
    };
