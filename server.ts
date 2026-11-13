import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  RIDER_COLORS,
  type ClientToServerMessage,
  type RiderInputPacket,
  type RiderState,
  type RoomSnapshot,
  type ServerToClientMessage,
  type TrackFeature,
  type TrackId,
} from './src/shared/raceTypes.ts';
import { generateTrackFeatures, TRACKS } from './src/shared/trackData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 25; // 40Hz authoritative simulation for extra smoothness
const MAX_PACK_SPREAD = 84; // Ensures all riders stay visible on the same phone screen

interface ConnectedClient {
  clientId: string;
  ws: WebSocket;
  roomCode: string | null;
  uid: string;
  name: string;
}

interface ServerRoom {
  roomCode: string;
  hostId: string;
  trackId: TrackId;
  trackLength: number;
  maxPlayers: number;
  fillWithBots: boolean;
  phase: 'WAITING' | 'COUNTDOWN' | 'RACING' | 'FINISHED';
  countdownSec: number;
  countdownAccumulatorMs: number;
  elapsedMs: number;
  cameraZ: number;
  riders: RiderState[];
  inputs: Map<string, RiderInputPacket>;
  holeshotWindowSet: Set<string>;
  features: TrackFeature[];
  collectedSet: Set<string>;
  seedCounter: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

const clients = new Map<string, ConnectedClient>();
const rooms = new Map<string, ServerRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `R${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

function createRider(params: {
  id: string;
  uid: string;
  name: string;
  slot: number;
  isBot: boolean;
}): RiderState {
  const startLanes = [-0.66, -0.22, 0.22, 0.66];
  return {
    id: params.id,
    uid: params.uid,
    name: params.name.slice(0, 24),
    slot: params.slot,
    color: RIDER_COLORS[params.slot % RIDER_COLORS.length],
    isBot: params.isBot,
    connected: true,
    x: startLanes[params.slot % startLanes.length],
    z: 0,
    vx: 0,
    speed: 0,
    lean: 0,
    nitro: 60,
    boosting: false,
    boostPadTimer: 0,
    stumbleTimer: 0,
    airTimer: 0,
    holeshot: false,
    drafting: false,
    rank: params.slot + 1,
    finished: false,
    finishTimeMs: null,
    topSpeedKmh: 0,
  };
}

function resetRoomRidersForStart(room: ServerRoom) {
  const startLanes = [-0.66, -0.22, 0.22, 0.66];
  const humanRiders = room.riders.filter((r) => !r.isBot);
  const allRiders: RiderState[] = humanRiders.map((r, idx) => ({
    ...r,
    slot: idx,
    color: RIDER_COLORS[idx % RIDER_COLORS.length],
    x: startLanes[idx % startLanes.length],
    z: 0,
    vx: 0,
    speed: 0,
    lean: 0,
    nitro: 60,
    boosting: false,
    boostPadTimer: 0,
    stumbleTimer: 0,
    airTimer: 0,
    holeshot: false,
    drafting: false,
    rank: idx + 1,
    finished: false,
    finishTimeMs: null,
    topSpeedKmh: 0,
  }));

  if (room.fillWithBots || allRiders.length < 2) {
    const botNames = ['Veloce AI', 'Apex Bot', 'Turbo Ronin', 'Drift Ghost'];
    let botIdx = 0;
    while (allRiders.length < room.maxPlayers) {
      const slot = allRiders.length;
      allRiders.push(
        createRider({
          id: `bot_${room.roomCode}_${slot}`,
          uid: `BOT_${slot}`,
          name: botNames[botIdx % botNames.length],
          slot,
          isBot: true,
        })
      );
      botIdx++;
    }
  }

  room.riders = allRiders;
  room.seedCounter += 1;
  room.trackLength = TRACKS[room.trackId].lengthMeters;
  room.features = generateTrackFeatures(room.trackId, room.seedCounter);
  room.collectedSet.clear();
  room.holeshotWindowSet.clear();
  room.cameraZ = 0;
  room.elapsedMs = 0;

  for (const rider of room.riders) {
    room.inputs.set(rider.id, { steer: 0, boost: false });
  }
}

function toSnapshot(room: ServerRoom): RoomSnapshot {
  return {
    roomCode: room.roomCode,
    hostId: room.hostId,
    trackId: room.trackId,
    trackLength: room.trackLength,
    maxPlayers: room.maxPlayers,
    fillWithBots: room.fillWithBots,
    phase: room.phase,
    countdownSec: room.countdownSec,
    elapsedMs: Math.round(room.elapsedMs),
    cameraZ: room.cameraZ,
    riders: room.riders,
    collectedIds: Array.from(room.collectedSet),
    serverTime: Date.now(),
  };
}

function sendJson(ws: WebSocket, payload: ServerToClientMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(room: ServerRoom, payload: ServerToClientMessage) {
  const raw = JSON.stringify(payload);
  for (const client of clients.values()) {
    if (client.roomCode === room.roomCode && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(raw);
    }
  }
}

function computeBotInput(room: ServerRoom, bot: RiderState): RiderInputPacket {
  let steer: -1 | 0 | 1 = 0;
  let boost = false;

  let targetLane: number | null = null;
  let hazardInWay = false;

  for (const feat of room.features) {
    const dz = feat.z - bot.z;
    if (dz < 6 || dz > 110) continue;

    if (
      feat.kind === 'hazard' &&
      bot.airTimer <= 0 &&
      Math.abs(feat.lane - bot.x) < feat.width + 0.14
    ) {
      hazardInWay = true;
      steer = bot.x >= feat.lane ? 1 : -1;
      break;
    }

    if (
      (feat.kind === 'boost_pad' ||
        feat.kind === 'ramp' ||
        (feat.kind === 'nitro_orb' && !room.collectedSet.has(feat.id))) &&
      dz < 85
    ) {
      targetLane = feat.lane;
    }
  }

  if (!hazardInWay && targetLane !== null) {
    const diff = targetLane - bot.x;
    if (Math.abs(diff) > 0.08) {
      steer = diff > 0 ? 1 : -1;
    }
  } else if (!hazardInWay && Math.abs(bot.x) > 0.78) {
    steer = bot.x > 0 ? -1 : 1;
  }

  const distLeft = room.trackLength - bot.z;
  if (bot.nitro > 40 && !hazardInWay && (distLeft < 440 || bot.nitro > 80)) {
    boost = true;
  }

  return { steer, boost };
}

function stepRoomPhysics(room: ServerRoom, dtSec: number) {
  if (room.phase === 'COUNTDOWN') {
    room.countdownAccumulatorMs += dtSec * 1000;
    if (room.countdownAccumulatorMs >= 1000) {
      room.countdownAccumulatorMs -= 1000;
      room.countdownSec -= 1;
      if (room.countdownSec <= 0) {
        room.phase = 'RACING';
        room.countdownSec = 0;
        // Award Holeshot Launch Boost to anyone who timed boost in the final countdown second
        for (const rider of room.riders) {
          if (!rider.isBot && room.holeshotWindowSet.has(rider.id)) {
            rider.holeshot = true;
            rider.boostPadTimer = 1.15;
            rider.speed = 46;
          }
        }
      }
    }
    broadcastToRoom(room, { type: 'room:state', snapshot: toSnapshot(room) });
    return;
  }

  if (room.phase !== 'RACING') return;

  room.elapsedMs += dtSec * 1000;

  let leaderZ = 0;
  for (const r of room.riders) {
    if (!r.finished && r.z > leaderZ) {
      leaderZ = r.z;
    }
  }

  for (const rider of room.riders) {
    if (rider.finished) {
      rider.speed = Math.max(18, rider.speed - 28 * dtSec);
      rider.z += rider.speed * dtSec;
      rider.boosting = false;
      rider.airTimer = Math.max(0, rider.airTimer - dtSec);
      continue;
    }

    const input = rider.isBot
      ? computeBotInput(room, rider)
      : room.inputs.get(rider.id) || { steer: 0, boost: false };

    if (rider.boostPadTimer > 0) {
      rider.boostPadTimer = Math.max(0, rider.boostPadTimer - dtSec);
      if (rider.boostPadTimer === 0) rider.holeshot = false;
    }
    if (rider.stumbleTimer > 0) {
      rider.stumbleTimer = Math.max(0, rider.stumbleTimer - dtSec);
    }
    if (rider.airTimer > 0) {
      rider.airTimer = Math.max(0, rider.airTimer - dtSec);
    }

    // Slipstream Drafting behind a bike ahead
    let isDrafting = false;
    for (const other of room.riders) {
      if (other.id === rider.id) continue;
      const dz = other.z - rider.z;
      if (dz > 5 && dz < 42 && Math.abs(other.x - rider.x) < 0.34) {
        isDrafting = true;
        break;
      }
    }
    rider.drafting = isDrafting;

    // Manual Nitro Boost
    const wantsBoost = Boolean(input.boost) && rider.nitro > 4 && rider.stumbleTimer <= 0;
    rider.boosting = wantsBoost;
    if (wantsBoost) {
      rider.nitro = Math.max(0, rider.nitro - 34 * dtSec);
    } else {
      const regen = isDrafting ? 13 : 5.5;
      rider.nitro = Math.min(100, rider.nitro + regen * dtSec);
    }

    // Smooth Lateral Steering & Lean
    const steerTarget = input.steer;
    const steerAccel = rider.airTimer > 0 ? 4.2 : 8.2;
    rider.vx += (steerTarget * 1.48 - rider.vx) * Math.min(1, steerAccel * dtSec);
    rider.x += rider.vx * dtSec;
    rider.lean += (steerTarget * 0.92 - rider.lean) * Math.min(1, 12 * dtSec);

    if (rider.x < -0.92) {
      rider.x = -0.92;
      rider.vx = Math.max(0, rider.vx * -0.15);
    } else if (rider.x > 0.92) {
      rider.x = 0.92;
      rider.vx = Math.min(0, rider.vx * -0.15);
    }

    // Target Speed Calculation
    let targetSpeed = 55;
    if (rider.isBot) {
      targetSpeed = 53 + (rider.slot % 2) * 1.4;
    }
    if (isDrafting) targetSpeed += 6.5;
    if (rider.boosting) targetSpeed += 25;
    if (rider.airTimer > 0) targetSpeed += 14;
    if (rider.boostPadTimer > 0) targetSpeed = Math.max(targetSpeed, 88);
    if (rider.stumbleTimer > 0) targetSpeed = 29;

    // Shared-Screen Pack Catch-Up
    const behindLeader = leaderZ - rider.z;
    if (behindLeader > 26) {
      const catchupBonus = Math.min(20, (behindLeader - 26) * 0.44);
      targetSpeed += catchupBonus;
    }

    const accelRate = targetSpeed > rider.speed ? 28 : 22;
    rider.speed += (targetSpeed - rider.speed) * Math.min(1, accelRate * dtSec);

    const prevZ = rider.z;
    rider.z += rider.speed * dtSec;

    if (leaderZ - rider.z > MAX_PACK_SPREAD && rider.z < room.trackLength - 20) {
      rider.z = leaderZ - MAX_PACK_SPREAD;
      rider.speed = Math.max(rider.speed, 58);
    }

    const kmh = Math.round(rider.speed * 3.6);
    if (kmh > rider.topSpeedKmh) {
      rider.topSpeedKmh = kmh;
    }

    // Track Feature Collisions
    for (const feat of room.features) {
      if (feat.z < prevZ - 3 || feat.z > rider.z + 4) continue;
      if (Math.abs(feat.lane - rider.x) > feat.width) continue;

      if (feat.kind === 'boost_pad' && rider.airTimer <= 0) {
        rider.boostPadTimer = 1.25;
        rider.stumbleTimer = 0;
      } else if (feat.kind === 'ramp' && rider.airTimer <= 0) {
        rider.airTimer = 0.85;
        rider.stumbleTimer = 0;
        rider.nitro = Math.min(100, rider.nitro + 20);
      } else if (feat.kind === 'nitro_orb') {
        if (!room.collectedSet.has(feat.id)) {
          room.collectedSet.add(feat.id);
          rider.nitro = Math.min(100, rider.nitro + 36);
        }
      } else if (feat.kind === 'hazard' && rider.airTimer <= 0) {
        if (rider.boostPadTimer <= 0 && !rider.boosting && rider.stumbleTimer <= 0) {
          rider.stumbleTimer = 0.7;
          rider.speed = Math.min(rider.speed, 28);
        }
      }
    }

    if (rider.z >= room.trackLength) {
      rider.finished = true;
      rider.finishTimeMs = Math.round(room.elapsedMs);
    }
  }

  // Bike-to-bike side bumps (only when at similar ground level)
  for (let i = 0; i < room.riders.length; i++) {
    for (let j = i + 1; j < room.riders.length; j++) {
      const a = room.riders[i];
      const b = room.riders[j];
      if (a.finished || b.finished) continue;
      if ((a.airTimer > 0) !== (b.airTimer > 0)) continue;
      if (Math.abs(a.z - b.z) < 6.5 && Math.abs(a.x - b.x) < 0.19) {
        const push = a.x <= b.x ? -0.055 : 0.055;
        a.x = Math.max(-0.92, Math.min(0.92, a.x + push));
        b.x = Math.max(-0.92, Math.min(0.92, b.x - push));
      }
    }
  }

  const sorted = [...room.riders].sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.finishTimeMs ?? 0) - (b.finishTimeMs ?? 0);
    }
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.z - a.z;
  });
  sorted.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  const activeRiders = room.riders.filter((r) => !r.finished);
  if (activeRiders.length > 0) {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const r of activeRiders) {
      if (r.z < minZ) minZ = r.z;
      if (r.z > maxZ) maxZ = r.z;
    }
    const targetCamZ = minZ * 0.4 + maxZ * 0.6;
    room.cameraZ += (targetCamZ - room.cameraZ) * Math.min(1, 12 * dtSec);
  } else {
    room.cameraZ = room.trackLength;
  }

  const activeHumans = room.riders.filter((r) => !r.isBot && !r.finished);
  if (activeHumans.length === 0) {
    for (const r of room.riders) {
      if (!r.finished) {
        const remaining = Math.max(0, room.trackLength - r.z);
        r.finished = true;
        r.finishTimeMs = Math.round(room.elapsedMs + (remaining / 54) * 1000);
      }
    }
    const finalSorted = [...room.riders].sort(
      (a, b) => (a.finishTimeMs ?? 0) - (b.finishTimeMs ?? 0)
    );
    finalSorted.forEach((r, idx) => {
      r.rank = idx + 1;
    });
    room.phase = 'FINISHED';
  }

  broadcastToRoom(room, { type: 'room:state', snapshot: toSnapshot(room) });
}

setInterval(() => {
  const dtSec = TICK_MS / 1000;
  for (const room of rooms.values()) {
    if (room.phase === 'COUNTDOWN' || room.phase === 'RACING') {
      stepRoomPhysics(room, dtSec);
    }
  }
}, TICK_MS);

function removeClientFromRoom(client: ConnectedClient) {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;

  if (room.phase === 'WAITING') {
    room.riders = room.riders.filter((r) => r.id !== client.clientId);
    room.riders.forEach((r, idx) => {
      r.slot = idx;
      r.color = RIDER_COLORS[idx % RIDER_COLORS.length];
    });
  } else {
    const rider = room.riders.find((r) => r.id === client.clientId);
    if (rider) {
      rider.connected = false;
    }
  }

  const connectedHumans = room.riders.filter((r) => !r.isBot && r.connected);
  if (connectedHumans.length === 0) {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = setTimeout(() => {
      rooms.delete(room.roomCode);
    }, 60_000);
    return;
  }

  if (!connectedHumans.some((r) => r.id === room.hostId)) {
    room.hostId = connectedHumans[0].id;
  }

  broadcastToRoom(room, { type: 'room:state', snapshot: toSnapshot(room) });
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const clientId = `c_${Math.random().toString(36).slice(2, 10)}`;
    const client: ConnectedClient = {
      clientId,
      ws,
      roomCode: null,
      uid: '',
      name: 'Rider',
    };
    clients.set(clientId, client);

    ws.on('message', (raw) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientToServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'room:create') {
        removeClientFromRoom(client);
        const roomCode = generateRoomCode();
        const trackId: TrackId = msg.trackId && TRACKS[msg.trackId] ? msg.trackId : 'coastal';
        const maxPlayers = Math.max(2, Math.min(4, msg.maxPlayers ?? 4));
        const fillWithBots = msg.fillWithBots ?? true;

        client.uid = msg.uid;
        client.name = msg.name || 'Rider 1';
        client.roomCode = roomCode;

        const hostRider = createRider({
          id: client.clientId,
          uid: client.uid,
          name: client.name,
          slot: 0,
          isBot: false,
        });

        const room: ServerRoom = {
          roomCode,
          hostId: client.clientId,
          trackId,
          trackLength: TRACKS[trackId].lengthMeters,
          maxPlayers,
          fillWithBots,
          phase: 'WAITING',
          countdownSec: 3,
          countdownAccumulatorMs: 0,
          elapsedMs: 0,
          cameraZ: 0,
          riders: [hostRider],
          inputs: new Map(),
          holeshotWindowSet: new Set(),
          features: generateTrackFeatures(trackId, 1),
          collectedSet: new Set(),
          seedCounter: 1,
          cleanupTimer: null,
        };
        rooms.set(roomCode, room);

        sendJson(ws, {
          type: 'room:joined',
          clientId: client.clientId,
          snapshot: toSnapshot(room),
          features: room.features,
        });
        return;
      }

      if (msg.type === 'room:join') {
        const code = (msg.roomCode || '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, {
            type: 'room:error',
            message: `Race room "${code}" was not found or has expired.`,
          });
          return;
        }

        if (room.cleanupTimer) {
          clearTimeout(room.cleanupTimer);
          room.cleanupTimer = null;
        }

        removeClientFromRoom(client);
        client.uid = msg.uid;
        client.name = msg.name || 'Rider';
        client.roomCode = code;

        const existingRider = room.riders.find((r) => !r.isBot && r.uid === msg.uid);
        if (existingRider) {
          existingRider.id = client.clientId;
          existingRider.connected = true;
          existingRider.name = client.name.slice(0, 24);
          if (room.hostId === '' || !room.riders.some((r) => r.id === room.hostId && r.connected)) {
            room.hostId = client.clientId;
          }
        } else {
          if (room.phase !== 'WAITING') {
            client.roomCode = null;
            sendJson(ws, {
              type: 'room:error',
              message: 'That race is already underway. Wait for rematch or create a new room.',
            });
            return;
          }
          const humanCount = room.riders.filter((r) => !r.isBot).length;
          if (humanCount >= room.maxPlayers) {
            client.roomCode = null;
            sendJson(ws, {
              type: 'room:error',
              message: 'That race room is already full.',
            });
            return;
          }
          const newRider = createRider({
            id: client.clientId,
            uid: client.uid,
            name: client.name,
            slot: room.riders.length,
            isBot: false,
          });
          room.riders.push(newRider);
        }

        sendJson(ws, {
          type: 'room:joined',
          clientId: client.clientId,
          snapshot: toSnapshot(room),
          features: room.features,
        });
        broadcastToRoom(room, { type: 'room:state', snapshot: toSnapshot(room) });
        return;
      }

      if (msg.type === 'room:leave') {
        removeClientFromRoom(client);
        return;
      }

      if (!client.roomCode) return;
      const room = rooms.get(client.roomCode);
      if (!room) return;

      if (msg.type === 'room:config') {
        if (room.hostId !== client.clientId || room.phase !== 'WAITING') return;
        if (msg.trackId && TRACKS[msg.trackId]) {
          room.trackId = msg.trackId;
          room.trackLength = TRACKS[msg.trackId].lengthMeters;
          room.features = generateTrackFeatures(msg.trackId, room.seedCounter);
        }
        if (msg.maxPlayers !== undefined) {
          const minAllowed = Math.max(2, room.riders.filter((r) => !r.isBot).length);
          room.maxPlayers = Math.max(minAllowed, Math.min(4, msg.maxPlayers));
        }
        if (msg.fillWithBots !== undefined) {
          room.fillWithBots = Boolean(msg.fillWithBots);
        }
        broadcastToRoom(room, {
          type: 'race:features',
          features: room.features,
          snapshot: toSnapshot(room),
        });
        return;
      }

      if (msg.type === 'race:start') {
        if (room.hostId !== client.clientId || room.phase !== 'WAITING') return;
        const humanCount = room.riders.filter((r) => !r.isBot).length;
        if (!room.fillWithBots && humanCount < 2) {
          sendJson(ws, {
            type: 'room:error',
            message: 'Wait for another player or enable AI Rivals to start.',
          });
          return;
        }
        resetRoomRidersForStart(room);
        room.phase = 'COUNTDOWN';
        room.countdownSec = 3;
        room.countdownAccumulatorMs = 0;
        broadcastToRoom(room, {
          type: 'race:features',
          features: room.features,
          snapshot: toSnapshot(room),
        });
        return;
      }

      if (msg.type === 'race:rematch') {
        if (room.hostId !== client.clientId) return;
        resetRoomRidersForStart(room);
        room.phase = 'WAITING';
        room.riders = room.riders.filter((r) => !r.isBot);
        room.riders.forEach((r, idx) => {
          r.slot = idx;
          r.color = RIDER_COLORS[idx % RIDER_COLORS.length];
        });
        broadcastToRoom(room, {
          type: 'race:features',
          features: room.features,
          snapshot: toSnapshot(room),
        });
        return;
      }

      if (msg.type === 'race:input') {
        // Allow timed boost tap/hold during the final second of countdown for a Holeshot Launch!
        if (room.phase === 'COUNTDOWN') {
          if (msg.boost && room.countdownSec === 1) {
            room.holeshotWindowSet.add(client.clientId);
          }
          return;
        }
        if (room.phase !== 'RACING') return;
        const steer = msg.steer === -1 || msg.steer === 1 ? msg.steer : 0;
        room.inputs.set(client.clientId, {
          steer,
          boost: Boolean(msg.boost),
        });
      }
    });

    ws.on('close', () => {
      removeClientFromRoom(client);
      clients.delete(clientId);
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex Moto server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
