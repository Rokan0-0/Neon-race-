import React, { useEffect, useRef } from 'react';
import type { RiderState, RoomSnapshot, TrackFeature } from '../shared/raceTypes';
import { getRoadCurveOffset, TRACKS } from '../shared/trackData';

interface RaceCanvasProps {
  snapshot: RoomSnapshot;
  features: TrackFeature[];
  myClientId: string;
  localSteer: -1 | 0 | 1;
  onDragSteer: (steer: -1 | 0 | 1) => void;
}

interface SmoothRider {
  x: number;
  z: number;
  lean: number;
  prevBoostPadTimer: number;
  prevStumbleTimer: number;
  prevAirTimer: number;
  prevNitro: number;
  prevHoleshot: boolean;
  prevFinished: boolean;
}

interface Particle {
  worldZ: number;
  worldXFrac: number;
  vz: number;
  vx: number;
  yOffset: number;
  vyOffset: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  ring?: boolean;
}

interface SkidMark {
  z1: number;
  x1Frac: number;
  z2: number;
  x2Frac: number;
  alpha: number;
  color: string;
}

interface FloatingCallout {
  text: string;
  color: string;
  worldZ: number;
  worldXFrac: number;
  life: number;
  maxLife: number;
}

export default function RaceCanvas({
  snapshot,
  features,
  myClientId,
  localSteer,
  onDragSteer,
}: RaceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestSnapshotRef = useRef<RoomSnapshot>(snapshot);
  const snapshotReceivedAtRef = useRef<number>(performance.now());
  const featuresRef = useRef<TrackFeature[]>(features);
  const myClientIdRef = useRef<string>(myClientId);
  const localSteerRef = useRef<-1 | 0 | 1>(localSteer);

  const smoothRidersRef = useRef<Map<string, SmoothRider>>(new Map());
  const smoothCameraZRef = useRef<number>(snapshot.cameraZ);
  const smoothMetersVisRef = useRef<number>(106);
  const particlesRef = useRef<Particle[]>([]);
  const skidsRef = useRef<SkidMark[]>([]);
  const calloutsRef = useRef<FloatingCallout[]>([]);
  const shakeMagRef = useRef<number>(0);
  const prevPhaseRef = useRef<RoomSnapshot['phase']>(snapshot.phase);
  const dragOriginXRef = useRef<number | null>(null);

  if (latestSnapshotRef.current !== snapshot) {
    latestSnapshotRef.current = snapshot;
    snapshotReceivedAtRef.current = performance.now();
  }
  featuresRef.current = features;
  myClientIdRef.current = myClientId;
  localSteerRef.current = localSteer;

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let exhaustEmitAccum = 0;
    let bumpSparkCooldown = 0;

    function spawnBurst(
      worldZ: number,
      worldXFrac: number,
      color: string,
      count: number,
      speedScale = 1,
      includeRing = false
    ) {
      const list = particlesRef.current;
      if (includeRing && list.length < 220) {
        list.push({
          worldZ,
          worldXFrac,
          vz: 0,
          vx: 0,
          yOffset: 0,
          vyOffset: 0,
          life: 0.34,
          maxLife: 0.34,
          size: 28,
          color,
          ring: true,
        });
      }
      for (let i = 0; i < count; i++) {
        if (list.length >= 220) break;
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const mag = (0.35 + Math.random() * 0.85) * speedScale;
        list.push({
          worldZ,
          worldXFrac,
          vz: Math.sin(angle) * 14 * mag,
          vx: Math.cos(angle) * 0.65 * mag,
          yOffset: 0,
          vyOffset: (Math.random() - 0.5) * 30,
          life: 0.28 + Math.random() * 0.22,
          maxLife: 0.5,
          size: 2.5 + Math.random() * 2.5,
          color,
        });
      }
    }

    function addCallout(text: string, color: string, worldZ: number, worldXFrac: number) {
      const list = calloutsRef.current;
      list.push({
        text,
        color,
        worldZ,
        worldXFrac,
        life: 0.95,
        maxLife: 0.95,
      });
      if (list.length > 8) list.shift();
    }

    function drawBike(
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      rider: RiderState,
      lean: number,
      isMe: boolean,
      nowMs: number
    ) {
      const airNorm = rider.airTimer > 0 ? Math.min(1, Math.max(0, rider.airTimer / 0.85)) : 0;
      const airArc = airNorm > 0 ? Math.sin(airNorm * Math.PI) : 0;
      const airLiftY = airArc * 26;
      const airScale = 1 + airArc * 0.34;
      const wobble = rider.stumbleTimer > 0 ? Math.sin(nowMs * 0.048) * 0.24 : 0;
      const rot = lean * 0.36 + wobble;

      // Ground Shadow (stays on road while bike lifts during jumps)
      ctx.save();
      ctx.translate(cx + airArc * 8, cy + 6 + airArc * 12);
      ctx.rotate(rot * 0.7);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.52 - airArc * 0.24})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11 * (1 - airArc * 0.18), 22 * (1 - airArc * 0.18), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Bike Chassis (lifted & scaled in air)
      ctx.save();
      ctx.translate(cx, cy - airLiftY);
      ctx.scale(airScale, airScale);
      ctx.rotate(rot);

      // Slipstream Drafting Wind Arcs
      if (rider.drafting && rider.airTimer <= 0) {
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
        ctx.lineWidth = 1.5;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(side * 12, -18);
          ctx.quadraticCurveTo(side * 16, 0, side * 11, 20);
          ctx.stroke();
        }
      }

      // Nitro / Boost Pad / Holeshot Exhaust Flame
      if (rider.boosting || rider.boostPadTimer > 0) {
        const flameLen =
          rider.boostPadTimer > 0
            ? 36 + Math.sin(nowMs * 0.09) * 8
            : 25 + Math.sin(nowMs * 0.09) * 6;
        const grad = ctx.createLinearGradient(0, 18, 0, 18 + flameLen);
        grad.addColorStop(0, '#FFFFFF');
        grad.addColorStop(0.35, rider.boostPadTimer > 0 ? '#22C55E' : '#00F0FF');
        grad.addColorStop(1, 'rgba(0, 240, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-5, 18);
        ctx.lineTo(5, 18);
        ctx.lineTo(0, 18 + flameLen);
        ctx.closePath();
        ctx.fill();
      }

      // Headlight Beam
      const beamGrad = ctx.createLinearGradient(0, -20, 0, -78);
      beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
      beamGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(-4, -20);
      ctx.lineTo(4, -20);
      ctx.lineTo(18, -78);
      ctx.lineTo(-18, -78);
      ctx.closePath();
      ctx.fill();

      // Rear & Front Tires
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(-4, 10, 8, 12);
      ctx.fillRect(-3.5, -22, 7, 11);

      // Bike Fairing Body
      ctx.fillStyle = rider.color;
      ctx.strokeStyle = '#0B0F17';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(8.5, -4);
      ctx.lineTo(6.5, 15);
      ctx.lineTo(-6.5, 15);
      ctx.lineTo(-8.5, -4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Windshield
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      ctx.moveTo(0, -15);
      ctx.lineTo(4.5, -6);
      ctx.lineTo(-4.5, -6);
      ctx.closePath();
      ctx.fill();

      // Rider Torso & Helmet
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.ellipse(0, 4, 6.5, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#F8FAFC';
      ctx.strokeStyle = rider.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -1, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Taillight
      ctx.fillStyle = '#FF2A4B';
      ctx.fillRect(-3, 15, 6, 3);

      // Highlight Ring under local player's bike
      if (isMe) {
        ctx.strokeStyle = airArc > 0 ? '#E879F9' : '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();

      // Always-visible Nameplate (unrotated, follows lift)
      ctx.save();
      const label = isMe ? `${rider.name} (You)` : rider.name;
      ctx.font = `600 11px "Plus Jakarta Sans", sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const boxW = textWidth + 12;
      const boxY = cy - airLiftY - (39 + airArc * 6);

      ctx.fillStyle = 'rgba(9, 11, 16, 0.84)';
      ctx.strokeStyle = rider.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cx - boxW / 2, boxY, boxW, 18, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, boxY + 9.5);
      ctx.restore();
    }

    function render(now: number) {
      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(render);
        return;
      }

      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const snap = latestSnapshotRef.current;
      const track = TRACKS[snap.trackId];

      // Clear transient effects when resetting to WAITING or COUNTDOWN
      if (prevPhaseRef.current !== snap.phase) {
        if (snap.phase === 'WAITING' || snap.phase === 'COUNTDOWN') {
          particlesRef.current = [];
          skidsRef.current = [];
          calloutsRef.current = [];
          smoothRidersRef.current.clear();
          smoothCameraZRef.current = snap.cameraZ;
        }
        prevPhaseRef.current = snap.phase;
      }

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(300, Math.floor(rect.width));
      const height = Math.max(340, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafId = requestAnimationFrame(render);
        return;
      }

      // Dead-reckoning + framerate-independent exponential reconciliation
      const snapAgeSec = Math.min(0.06, Math.max(0, (now - snapshotReceivedAtRef.current) / 1000));
      const posLerp = 1 - Math.exp(-17 * dt);
      const leanLerp = 1 - Math.exp(-20 * dt);
      const camLerp = 1 - Math.exp(-13 * dt);

      const smoothMap = smoothRidersRef.current;
      let avgSpeed = 0;
      let activeCount = 0;
      const isRacing = snap.phase === 'RACING';

      exhaustEmitAccum += dt;
      bumpSparkCooldown = Math.max(0, bumpSparkCooldown - dt);
      const shouldEmitExhaust = exhaustEmitAccum >= 0.032;
      if (shouldEmitExhaust) exhaustEmitAccum = 0;

      for (const r of snap.riders) {
        const isMe = r.id === myClientIdRef.current;
        const targetZ = isRacing ? r.z + r.speed * snapAgeSec : r.z;
        const targetX = isRacing
          ? Math.max(-0.92, Math.min(0.92, r.x + r.vx * snapAgeSec))
          : r.x;

        if (!r.finished && isRacing) {
          avgSpeed += r.speed;
          activeCount++;
        }

        const prev = smoothMap.get(r.id);
        if (!prev) {
          smoothMap.set(r.id, {
            x: targetX,
            z: targetZ,
            lean: r.lean,
            prevBoostPadTimer: r.boostPadTimer,
            prevStumbleTimer: r.stumbleTimer,
            prevAirTimer: r.airTimer,
            prevNitro: r.nitro,
            prevHoleshot: r.holeshot,
            prevFinished: r.finished,
          });
        } else {
          const oldX = prev.x;
          const oldZ = prev.z;

          if (isRacing) {
            prev.z += r.speed * dt;
            prev.x += r.vx * dt;
          }
          prev.z += (targetZ - prev.z) * posLerp;
          prev.x += (targetX - prev.x) * posLerp;

          const desiredLean =
            isMe && isRacing && localSteerRef.current !== 0
              ? localSteerRef.current * 0.92
              : r.lean;
          prev.lean += (desiredLean - prev.lean) * leanLerp;

          // Detect gameplay events for particles, camera shake, and callouts
          if (isRacing) {
            if (r.holeshot && !prev.prevHoleshot) {
              spawnBurst(prev.z, prev.x, '#22C55E', 16, 1.3, true);
              if (isMe) {
                shakeMagRef.current = Math.max(shakeMagRef.current, 4);
                addCallout('HOLESHOT LAUNCH!', '#4ADE80', prev.z + 6, prev.x);
              }
            }
            if (r.boostPadTimer > 0.85 && prev.prevBoostPadTimer <= 0.85 && !r.holeshot) {
              spawnBurst(prev.z, prev.x, '#22C55E', 12, 1.1, true);
              if (isMe) {
                shakeMagRef.current = Math.max(shakeMagRef.current, 2.6);
                addCallout('PAD SURGE!', '#4ADE80', prev.z + 6, prev.x);
              }
            }
            if (r.airTimer > 0.55 && prev.prevAirTimer <= 0.55) {
              spawnBurst(prev.z, prev.x, '#E879F9', 14, 1.15, true);
              if (isMe) {
                shakeMagRef.current = Math.max(shakeMagRef.current, 2.5);
                addCallout('AIR TIME +20% NITRO', '#E879F9', prev.z + 6, prev.x);
              }
            }
            if (r.nitro - prev.prevNitro > 22 && prev.prevAirTimer <= 0.55) {
              spawnBurst(prev.z, prev.x, '#00F0FF', 10, 0.9, true);
              if (isMe) {
                addCallout('NITRO +36%', '#00F0FF', prev.z + 5, prev.x);
              }
            }
            if (r.stumbleTimer > 0.45 && prev.prevStumbleTimer <= 0.45) {
              spawnBurst(prev.z, prev.x, '#EF4444', 14, 1.2, true);
              if (isMe) {
                shakeMagRef.current = Math.max(shakeMagRef.current, 6);
                addCallout('HAZARD HIT!', '#F87171', prev.z + 4, prev.x);
              }
            }

            // Tire Skid Marks when leaning hard or stumbling on ground
            if (r.airTimer <= 0 && (Math.abs(prev.lean) > 0.64 || r.stumbleTimer > 0)) {
              const skids = skidsRef.current;
              if (Math.hypot(prev.x - oldX, (prev.z - oldZ) * 0.05) > 0.005) {
                skids.push({
                  z1: oldZ - 1.5,
                  x1Frac: oldX,
                  z2: prev.z - 1.5,
                  x2Frac: prev.x,
                  alpha: r.stumbleTimer > 0 ? 0.5 : 0.28,
                  color: r.stumbleTimer > 0 ? '#EF4444' : '#020617',
                });
                if (skids.length > 130) skids.shift();
              }
            }

            // Exhaust Flame Particles when boosting
            if (shouldEmitExhaust && (r.boosting || r.boostPadTimer > 0)) {
              const list = particlesRef.current;
              if (list.length < 220) {
                list.push({
                  worldZ: prev.z - 3.2,
                  worldXFrac: prev.x + (Math.random() - 0.5) * 0.04,
                  vz: -18 - Math.random() * 14,
                  vx: (Math.random() - 0.5) * 0.25,
                  yOffset: r.airTimer > 0 ? -Math.sin((r.airTimer / 0.85) * Math.PI) * 20 : 0,
                  vyOffset: 0,
                  life: 0.22,
                  maxLife: 0.22,
                  size: r.boostPadTimer > 0 ? 4 : 3,
                  color: r.boostPadTimer > 0 ? '#4ADE80' : '#00F0FF',
                });
              }
            }
          }

          if (r.finished && !prev.prevFinished) {
            spawnBurst(snap.trackLength, prev.x, r.color, 20, 1.5, true);
            spawnBurst(snap.trackLength, prev.x, '#FFFFFF', 12, 1.2, false);
          }

          prev.prevBoostPadTimer = r.boostPadTimer;
          prev.prevStumbleTimer = r.stumbleTimer;
          prev.prevAirTimer = r.airTimer;
          prev.prevNitro = r.nitro;
          prev.prevHoleshot = r.holeshot;
          prev.prevFinished = r.finished;
        }
      }

      // Bike-to-bike proximity bump sparks
      if (isRacing && bumpSparkCooldown <= 0) {
        for (let i = 0; i < snap.riders.length; i++) {
          for (let j = i + 1; j < snap.riders.length; j++) {
            const a = snap.riders[i];
            const b = snap.riders[j];
            if (a.finished || b.finished) continue;
            if ((a.airTimer > 0) !== (b.airTimer > 0)) continue;
            if (Math.abs(a.z - b.z) < 6.5 && Math.abs(a.x - b.x) < 0.2) {
              const smA = smoothMap.get(a.id);
              const smB = smoothMap.get(b.id);
              if (smA && smB) {
                spawnBurst((smA.z + smB.z) * 0.5, (smA.x + smB.x) * 0.5, '#FACC15', 7, 0.8);
                bumpSparkCooldown = 0.18;
              }
            }
          }
        }
      }

      // Smooth Camera Z & Dynamic Speed FOV
      const meanPackSpeed = activeCount > 0 ? avgSpeed / activeCount : 0;
      const targetCamZ = isRacing ? snap.cameraZ + meanPackSpeed * snapAgeSec : snap.cameraZ;
      if (isRacing) {
        smoothCameraZRef.current += meanPackSpeed * dt;
      }
      smoothCameraZRef.current += (targetCamZ - smoothCameraZRef.current) * camLerp;

      const me = snap.riders.find((r) => r.id === myClientIdRef.current);
      const speedNorm = me && isRacing ? Math.max(0, Math.min(1, (me.speed - 52) / 38)) : 0;
      const targetMetersVis = 104 + speedNorm * 14;
      smoothMetersVisRef.current += (targetMetersVis - smoothMetersVisRef.current) * (1 - Math.exp(-6 * dt));

      // Update particles, skids, callouts, shake
      shakeMagRef.current *= Math.exp(-14 * dt);
      if (shakeMagRef.current < 0.1) shakeMagRef.current = 0;
      const shakeX = shakeMagRef.current > 0 ? (Math.random() - 0.5) * 2 * shakeMagRef.current : 0;
      const shakeY = shakeMagRef.current > 0 ? (Math.random() - 0.5) * 2 * shakeMagRef.current : 0;

      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.worldZ += p.vz * dt;
        p.worldXFrac += p.vx * dt;
        p.yOffset += p.vyOffset * dt;
      }

      const skids = skidsRef.current;
      for (let i = skids.length - 1; i >= 0; i--) {
        skids[i].alpha -= dt * 0.16;
        if (skids[i].alpha <= 0) skids.splice(i, 1);
      }

      const callouts = calloutsRef.current;
      for (let i = callouts.length - 1; i >= 0; i--) {
        callouts[i].life -= dt;
        if (callouts[i].life <= 0) callouts.splice(i, 1);
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.translate(shakeX, shakeY);

      const camZ = smoothCameraZRef.current;
      const metersVisible = smoothMetersVisRef.current;
      const pxPerMeter = height / metersVisible;
      const anchorScreenY = height * 0.57;
      const roadWidth = Math.min(width * 0.78, 360);
      const halfW = roadWidth * 0.5;
      const baseCurve = getRoadCurveOffset(snap.trackId, camZ);

      const worldZToScreenY = (z: number) => anchorScreenY - (z - camZ) * pxPerMeter;
      const roadCenterXAtZ = (z: number) =>
        width * 0.5 + (getRoadCurveOffset(snap.trackId, z) - baseCurve);

      // 1. Background Shoulder
      ctx.fillStyle = track.shoulderHex;
      ctx.fillRect(-10, -10, width + 20, height + 20);

      // Subtle Scrolling Shoulder Grid Lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.lineWidth = 1;
      const gridStepM = 20;
      const minVisZ = camZ - (height - anchorScreenY) / pxPerMeter - 14;
      const maxVisZ = camZ + anchorScreenY / pxPerMeter + 14;
      const firstGridZ = Math.floor(minVisZ / gridStepM) * gridStepM;
      for (let gz = firstGridZ; gz <= maxVisZ; gz += gridStepM) {
        const sy = worldZToScreenY(gz);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
        ctx.stroke();
      }

      // 2. Continuous Winding Asphalt Road Polygon (Zero Seam Gaps)
      const stepM = 3;
      const startZ = Math.floor(minVisZ / stepM) * stepM;
      const endZ = Math.ceil(maxVisZ / stepM) * stepM;
      const spinePoints: { z: number; y: number; cx: number }[] = [];
      for (let z = startZ; z <= endZ; z += stepM) {
        spinePoints.push({ z, y: worldZToScreenY(z), cx: roadCenterXAtZ(z) });
      }

      if (spinePoints.length >= 2) {
        // Road Drop Edge Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.moveTo(spinePoints[0].cx - halfW - 11, spinePoints[0].y);
        for (let i = 1; i < spinePoints.length; i++) {
          ctx.lineTo(spinePoints[i].cx - halfW - 11, spinePoints[i].y);
        }
        for (let i = spinePoints.length - 1; i >= 0; i--) {
          ctx.lineTo(spinePoints[i].cx + halfW + 11, spinePoints[i].y);
        }
        ctx.closePath();
        ctx.fill();

        // Main Continuous Asphalt Polygon
        ctx.fillStyle = track.roadHex;
        ctx.beginPath();
        ctx.moveTo(spinePoints[0].cx - halfW, spinePoints[0].y);
        for (let i = 1; i < spinePoints.length; i++) {
          ctx.lineTo(spinePoints[i].cx - halfW, spinePoints[i].y);
        }
        for (let i = spinePoints.length - 1; i >= 0; i--) {
          ctx.lineTo(spinePoints[i].cx + halfW, spinePoints[i].y);
        }
        ctx.closePath();
        ctx.fill();

        // Subtle Center Track Sheen Strip
        ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.beginPath();
        ctx.moveTo(spinePoints[0].cx - halfW * 0.42, spinePoints[0].y);
        for (let i = 1; i < spinePoints.length; i++) {
          ctx.lineTo(spinePoints[i].cx - halfW * 0.42, spinePoints[i].y);
        }
        for (let i = spinePoints.length - 1; i >= 0; i--) {
          ctx.lineTo(spinePoints[i].cx + halfW * 0.42, spinePoints[i].y);
        }
        ctx.closePath();
        ctx.fill();

        // Continuous Alternating Rumble Curbs (Left & Right)
        const curbW = 7;
        for (let i = 0; i < spinePoints.length - 1; i++) {
          const p0 = spinePoints[i];
          const p1 = spinePoints[i + 1];
          const curbBand = Math.floor(p0.z / 9) % 2 === 0;
          ctx.fillStyle = curbBand ? track.curbHexA : track.curbHexB;

          ctx.beginPath();
          ctx.moveTo(p0.cx - halfW - curbW, p0.y + 0.5);
          ctx.lineTo(p0.cx - halfW, p0.y + 0.5);
          ctx.lineTo(p1.cx - halfW, p1.y - 0.5);
          ctx.lineTo(p1.cx - halfW - curbW, p1.y - 0.5);
          ctx.closePath();
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(p0.cx + halfW, p0.y + 0.5);
          ctx.lineTo(p0.cx + halfW + curbW, p0.y + 0.5);
          ctx.lineTo(p1.cx + halfW + curbW, p1.y - 0.5);
          ctx.lineTo(p1.cx + halfW, p1.y - 0.5);
          ctx.closePath();
          ctx.fill();
        }

        // Smooth Dashed Center & Quarter Lane Dividers
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;
        for (const laneFrac of [-0.5, 0, 0.5]) {
          for (let i = 0; i < spinePoints.length - 1; i++) {
            const p0 = spinePoints[i];
            const p1 = spinePoints[i + 1];
            if (Math.floor(p0.z / 12) % 2 !== 0) continue;
            ctx.beginPath();
            ctx.moveTo(p0.cx + laneFrac * halfW, p0.y);
            ctx.lineTo(p1.cx + laneFrac * halfW, p1.y);
            ctx.stroke();
          }
        }
      }

      // 2.5. Tire Skid Marks on Asphalt
      for (const sk of skids) {
        if (sk.z2 < minVisZ || sk.z1 > maxVisZ) continue;
        const x1 = roadCenterXAtZ(sk.z1) + sk.x1Frac * (roadWidth * 0.45);
        const y1 = worldZToScreenY(sk.z1);
        const x2 = roadCenterXAtZ(sk.z2) + sk.x2Frac * (roadWidth * 0.45);
        const y2 = worldZToScreenY(sk.z2);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(0.6, sk.alpha));
        ctx.strokeStyle = sk.color;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
      }

      // 3. Distance Markers Every 500m
      for (let dm = 500; dm < snap.trackLength; dm += 500) {
        if (dm < minVisZ || dm > maxVisZ) continue;
        const sy = worldZToScreenY(dm);
        const cx = roadCenterXAtZ(dm);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = `600 11px "JetBrains Mono", monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(`${dm}m`, cx - halfW + 10, sy - 4);
      }

      // 4. Start Line & Checkered Finish Line Gate
      const drawCheckeredStrip = (zPos: number, label: string) => {
        if (zPos < minVisZ - 10 || zPos > maxVisZ + 10) return;
        const sy = worldZToScreenY(zPos);
        const cx = roadCenterXAtZ(zPos);
        const cols = 12;
        const sqW = roadWidth / cols;

        for (let r = 0; r < 2; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? '#FFFFFF' : '#090B10';
            ctx.fillRect(cx - halfW + c * sqW, sy - (r + 1) * 8, sqW, 8);
          }
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `700 12px "Chakra Petch", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, sy - 22);
      };

      drawCheckeredStrip(0, 'START GRID');
      drawCheckeredStrip(snap.trackLength, 'FINISH LINE');

      // 5. Track Features (Boost Pads, Stunt Ramps, Nitro Orbs, Hazards)
      const collectedSet = new Set(snap.collectedIds);
      for (const feat of featuresRef.current) {
        if (feat.z < minVisZ - 14 || feat.z > maxVisZ + 14) continue;
        if (feat.kind === 'nitro_orb' && collectedSet.has(feat.id)) continue;

        const sy = worldZToScreenY(feat.z);
        const fx = roadCenterXAtZ(feat.z) + feat.lane * (roadWidth * 0.46);

        if (feat.kind === 'boost_pad') {
          const padW = feat.width * roadWidth * 0.55;
          const padH = 34;
          ctx.save();
          ctx.translate(fx, sy);
          ctx.fillStyle = 'rgba(34, 197, 94, 0.24)';
          ctx.strokeStyle = '#22C55E';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(-padW * 0.5, -padH * 0.5, padW, padH, 6);
          ctx.fill();
          ctx.stroke();

          const pulse = (now * 0.008) % 1;
          ctx.strokeStyle = '#86EFAC';
          ctx.lineWidth = 2.5;
          for (let i = 0; i < 3; i++) {
            const oy = 10 - i * 9 - pulse * 5;
            ctx.beginPath();
            ctx.moveTo(-padW * 0.28, oy + 5);
            ctx.lineTo(0, oy);
            ctx.lineTo(padW * 0.28, oy + 5);
            ctx.stroke();
          }
          ctx.restore();
        } else if (feat.kind === 'ramp') {
          const rampW = feat.width * roadWidth * 0.58;
          const rampH = 38;
          ctx.save();
          ctx.translate(fx, sy);

          const rampGrad = ctx.createLinearGradient(0, rampH * 0.5, 0, -rampH * 0.5);
          rampGrad.addColorStop(0, 'rgba(168, 85, 247, 0.22)');
          rampGrad.addColorStop(1, 'rgba(250, 204, 21, 0.65)');
          ctx.fillStyle = rampGrad;
          ctx.strokeStyle = '#E879F9';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(-rampW * 0.5, -rampH * 0.5, rampW, rampH, 5);
          ctx.fill();
          ctx.stroke();

          // Launch lip highlight at top edge
          ctx.fillStyle = '#FEF08A';
          ctx.fillRect(-rampW * 0.46, -rampH * 0.5, rampW * 0.92, 4);

          // Animated jump chevrons
          const pulse = (now * 0.007) % 1;
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2.2;
          for (let i = 0; i < 2; i++) {
            const oy = 9 - i * 11 - pulse * 4;
            ctx.beginPath();
            ctx.moveTo(-rampW * 0.25, oy + 5);
            ctx.lineTo(0, oy - 1);
            ctx.lineTo(rampW * 0.25, oy + 5);
            ctx.stroke();
          }
          ctx.restore();
        } else if (feat.kind === 'nitro_orb') {
          const bob = Math.sin(now * 0.006 + feat.z) * 3;
          ctx.save();
          ctx.translate(fx, sy + bob);
          ctx.fillStyle = 'rgba(0, 240, 255, 0.22)';
          ctx.beginPath();
          ctx.arc(0, 0, 15, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#00F0FF';
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, 0, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#090B10';
          ctx.font = `700 10px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('N', 0, 0.5);
          ctx.restore();
        } else if (feat.kind === 'hazard') {
          const hazW = feat.width * roadWidth * 0.55;
          ctx.save();
          ctx.translate(fx, sy);
          ctx.fillStyle = '#EF4444';
          ctx.strokeStyle = '#FCA5A5';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(-hazW * 0.5, -7, hazW, 14, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#111827';
          ctx.fillRect(-hazW * 0.25, -5, hazW * 0.14, 10);
          ctx.fillRect(hazW * 0.12, -5, hazW * 0.14, 10);
          ctx.restore();
        }
      }

      // 6. Particles & Expanding Rings
      for (const p of particles) {
        const py = worldZToScreenY(p.worldZ) + p.yOffset;
        const px = roadCenterXAtZ(p.worldZ) + p.worldXFrac * (roadWidth * 0.45);
        const alpha = Math.max(0, p.life / p.maxLife);
        ctx.save();
        ctx.globalAlpha = alpha;
        if (p.ring) {
          const radius = p.size * (1.4 - alpha);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(4, radius), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(px, py, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 7. Draw All Riders Sorted Back-to-Front (Airborne riders drawn last on top)
      const orderedRiders = [...snap.riders].sort((a, b) => {
        const airDiff = (a.airTimer > 0 ? 1 : 0) - (b.airTimer > 0 ? 1 : 0);
        if (airDiff !== 0) return airDiff;
        return a.z - b.z;
      });

      for (const rider of orderedRiders) {
        const sm = smoothMap.get(rider.id);
        const rx = sm ? sm.x : rider.x;
        const rz = sm ? sm.z : rider.z;
        const rLean = sm ? sm.lean : rider.lean;
        const sy = Math.max(46, Math.min(height - 32, worldZToScreenY(rz)));
        const sx = roadCenterXAtZ(rz) + rx * (roadWidth * 0.45);
        drawBike(ctx, sx, sy, rider, rLean, rider.id === myClientIdRef.current, now);
      }

      // 8. Floating Action Callouts
      for (const c of callouts) {
        const progress = 1 - c.life / c.maxLife;
        const cy = worldZToScreenY(c.worldZ) - 48 - progress * 26;
        const cx = roadCenterXAtZ(c.worldZ) + c.worldXFrac * (roadWidth * 0.45);
        ctx.save();
        ctx.globalAlpha = Math.min(1, c.life * 2.2);
        ctx.font = `700 12px "Chakra Petch", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#090B10';
        ctx.fillText(c.text, cx + 1, cy + 1);
        ctx.fillStyle = c.color;
        ctx.fillText(c.text, cx, cy);
        ctx.restore();
      }

      // 9. Speed Lines Overlay when Local Player is Boosting or Airborne
      if (me && (me.boosting || me.boostPadTimer > 0 || me.airTimer > 0) && isRacing) {
        ctx.strokeStyle =
          me.airTimer > 0
            ? 'rgba(232, 121, 249, 0.28)'
            : me.boostPadTimer > 0
            ? 'rgba(34, 197, 94, 0.28)'
            : 'rgba(0, 240, 255, 0.24)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 10; i++) {
          const lx = i % 2 === 0 ? 12 + i * 9 : width - (12 + i * 9);
          const ly = ((now * 1.55 + i * 95) % (height + 80)) - 40;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx, ly + 46);
          ctx.stroke();
        }
      }

      ctx.restore();
      rafId = requestAnimationFrame(render);
    }

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Optional thumb-drag steering directly on the track canvas
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    dragOriginXRef.current = e.clientX;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragOriginXRef.current === null) return;
    const dx = e.clientX - dragOriginXRef.current;
    if (dx < -14) {
      onDragSteer(-1);
    } else if (dx > 14) {
      onDragSteer(1);
    } else {
      onDragSteer(0);
    }
  }

  function handlePointerEnd() {
    if (dragOriginXRef.current !== null) {
      dragOriginXRef.current = null;
      onDragSteer(0);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      className="w-full h-full block touch-none select-none rounded-xl border border-slate-800 bg-[#090B10]"
    />
  );
}
