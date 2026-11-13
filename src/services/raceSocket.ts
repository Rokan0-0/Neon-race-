import type {
  ClientToServerMessage,
  RoomSnapshot,
  ServerToClientMessage,
  TrackFeature,
} from '../shared/raceTypes';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

interface RaceSocketCallbacks {
  onStatus: (status: SocketStatus) => void;
  onJoined: (clientId: string, snapshot: RoomSnapshot, features: TrackFeature[]) => void;
  onState: (snapshot: RoomSnapshot) => void;
  onFeatures: (features: TrackFeature[], snapshot: RoomSnapshot) => void;
  onError: (message: string) => void;
}

export class RaceSocketClient {
  private ws: WebSocket | null = null;
  private callbacks: RaceSocketCallbacks;
  private closedManually = false;
  private pendingQueue: ClientToServerMessage[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastJoinCredentials: { roomCode: string; uid: string; name: string } | null = null;

  constructor(callbacks: RaceSocketCallbacks) {
    this.callbacks = callbacks;
    this.connect();
  }

  private getWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  private connect() {
    if (this.closedManually) return;
    this.callbacks.onStatus('connecting');

    const ws = new WebSocket(this.getWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.callbacks.onStatus('connected');

      // Re-join room automatically if reconnecting after a drop
      if (this.lastJoinCredentials && this.pendingQueue.length === 0) {
        this.send({
          type: 'room:join',
          roomCode: this.lastJoinCredentials.roomCode,
          uid: this.lastJoinCredentials.uid,
          name: this.lastJoinCredentials.name,
        });
      }

      while (this.pendingQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
        const msg = this.pendingQueue.shift();
        if (msg) ws.send(JSON.stringify(msg));
      }
    };

    ws.onmessage = (event) => {
      let msg: ServerToClientMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerToClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'room:joined') {
        this.callbacks.onJoined(msg.clientId, msg.snapshot, msg.features);
      } else if (msg.type === 'room:state') {
        this.callbacks.onState(msg.snapshot);
      } else if (msg.type === 'race:features') {
        this.callbacks.onFeatures(msg.features, msg.snapshot);
      } else if (msg.type === 'room:error') {
        this.callbacks.onError(msg.message);
      }
    };

    ws.onclose = () => {
      this.callbacks.onStatus('disconnected');
      if (!this.closedManually) {
        this.reconnectTimer = setTimeout(() => this.connect(), 1500);
      }
    };
  }

  setRoomReconnectInfo(info: { roomCode: string; uid: string; name: string } | null) {
    this.lastJoinCredentials = info;
  }

  send(msg: ClientToServerMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      if (msg.type !== 'race:input') {
        this.pendingQueue.push(msg);
      }
    }
  }

  destroy() {
    this.closedManually = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
