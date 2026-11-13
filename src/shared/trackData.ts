import type { TrackDefinition, TrackFeature, TrackId } from './raceTypes.ts';

export const TRACKS: Record<TrackId, TrackDefinition> = {
  coastal: {
    id: 'coastal',
    name: 'Pacific Neon Highway',
    subtitle: '2,400m coastal sprint with sweeping curves, ramps & boost lanes',
    lengthMeters: 2400,
    accentHex: '#00F0FF',
    roadHex: '#151B29',
    shoulderHex: '#0B1320',
    curbHexA: '#00F0FF',
    curbHexB: '#1E293B',
  },
  canyon: {
    id: 'canyon',
    name: 'Redrock Ridge',
    subtitle: '2,600m canyon switchbacks with stunt jumps & hazard slaloms',
    lengthMeters: 2600,
    accentHex: '#FFB800',
    roadHex: '#1C1718',
    shoulderHex: '#160E0D',
    curbHexA: '#FFB800',
    curbHexB: '#3B231E',
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Expressway',
    subtitle: '2,800m high-speed run packed with nitro cells, ramps & overdrive pads',
    lengthMeters: 2800,
    accentHex: '#FF2A85',
    roadHex: '#131320',
    shoulderHex: '#090910',
    curbHexA: '#FF2A85',
    curbHexB: '#2A1636',
  },
};

export function getRoadCurveOffset(trackId: TrackId, z: number): number {
  if (trackId === 'coastal') {
    return Math.sin(z * 0.0042) * 58 + Math.sin(z * 0.0017) * 32;
  }
  if (trackId === 'canyon') {
    return Math.sin(z * 0.0058) * 74 + Math.cos(z * 0.0025) * 38;
  }
  return Math.sin(z * 0.0036) * 52 + Math.cos(z * 0.0072) * 28;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function generateTrackFeatures(trackId: TrackId, seedOffset = 1): TrackFeature[] {
  const track = TRACKS[trackId];
  const seedBase =
    trackId === 'coastal' ? 104729 : trackId === 'canyon' ? 224737 : 350377;
  const rand = seededRandom(seedBase + seedOffset * 7919);

  const features: TrackFeature[] = [];
  const laneChoices = [-0.68, -0.24, 0.24, 0.68];

  let z = 135;
  let idx = 0;

  while (z < track.lengthMeters - 115) {
    const laneIdx = Math.floor(rand() * laneChoices.length);
    const lane = laneChoices[laneIdx];
    const roll = rand();

    if (roll < 0.28) {
      // Track Boost Pad
      features.push({
        id: `pad_${idx}`,
        kind: 'boost_pad',
        z,
        lane,
        width: 0.34,
      });
    } else if (roll < 0.44) {
      // Stunt Launch Ramp (leaps over hazards + awards nitro)
      features.push({
        id: `ramp_${idx}`,
        kind: 'ramp',
        z,
        lane,
        width: 0.34,
      });
      // Often place a hazard slightly past the ramp so jumping clears it
      if (rand() < 0.6) {
        features.push({
          id: `haz_jump_${idx}`,
          kind: 'hazard',
          z: z + 24,
          lane,
          width: 0.24,
        });
      }
    } else if (roll < 0.74) {
      // Collectible Nitro Energy Cell
      features.push({
        id: `orb_${idx}`,
        kind: 'nitro_orb',
        z,
        lane,
        width: 0.24,
      });
      if (rand() < 0.45) {
        const oppLane = laneChoices[(laneIdx + 2) % laneChoices.length];
        features.push({
          id: `orb_${idx}_b`,
          kind: 'nitro_orb',
          z: z + 18,
          lane: oppLane,
          width: 0.24,
        });
      }
    } else {
      // Road Hazard Barrier
      features.push({
        id: `haz_${idx}`,
        kind: 'hazard',
        z,
        lane,
        width: 0.24,
      });
      if (rand() < 0.6) {
        const rewardLane = laneChoices[(laneIdx + 1) % laneChoices.length];
        features.push({
          id: `pad_alt_${idx}`,
          kind: 'boost_pad',
          z: z + 10,
          lane: rewardLane,
          width: 0.3,
        });
      }
    }

    const spacing = trackId === 'midnight' ? 50 + rand() * 32 : 56 + rand() * 36;
    z += spacing;
    idx++;
  }

  // Final sprint double boost pads + center jump ramp before the finish line
  features.push({
    id: 'final_ramp_center',
    kind: 'ramp',
    z: track.lengthMeters - 190,
    lane: 0,
    width: 0.36,
  });
  features.push({
    id: 'final_pad_left',
    kind: 'boost_pad',
    z: track.lengthMeters - 125,
    lane: -0.45,
    width: 0.34,
  });
  features.push({
    id: 'final_pad_right',
    kind: 'boost_pad',
    z: track.lengthMeters - 125,
    lane: 0.45,
    width: 0.34,
  });

  return features;
}
