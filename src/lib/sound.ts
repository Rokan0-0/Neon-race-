class RaceSoundEngine {
  private muted = false;
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopEngine();
    }
    return this.muted;
  }

  startEngine(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.engineOsc) return;

    const osc = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(74, ctx.currentTime);

    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(37, ctx.currentTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(240, ctx.currentTime);
    filter.Q.setValueAtTime(1.8, ctx.currentTime);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.setTargetAtTime(0.032, ctx.currentTime, 0.12);

    osc.connect(filter);
    subOsc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    subOsc.start();

    this.engineOsc = osc;
    this.engineSubOsc = subOsc;
    this.engineFilter = filter;
    this.engineGain = gain;
  }

  updateEngine(speedRatio: number, boosting: boolean, airborne: boolean): void {
    if (this.muted) {
      this.stopEngine();
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (!this.engineOsc) {
      this.startEngine();
    }
    if (!this.engineOsc || !this.engineSubOsc || !this.engineFilter || !this.engineGain) return;

    const clamped = Math.max(0.1, Math.min(1.5, speedRatio));
    const boostPitch = boosting ? 1.2 : 1.0;
    const airPitch = airborne ? 1.14 : 1.0;
    const baseFreq = (68 + clamped * 96) * boostPitch * airPitch;
    const cutoff = (210 + clamped * 380) * (boosting ? 1.45 : 1.0);
    const targetGain = airborne ? 0.022 : boosting ? 0.044 : 0.03;

    const t = ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(baseFreq, t, 0.06);
    this.engineSubOsc.frequency.setTargetAtTime(baseFreq * 0.5, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.06);
    this.engineGain.gain.setTargetAtTime(targetGain, t, 0.08);
  }

  stopEngine(): void {
    const ctx = this.ctx;
    if (this.engineGain && ctx) {
      try {
        this.engineGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.04);
      } catch {
        // Ignore stopped node errors
      }
    }
    const osc = this.engineOsc;
    const subOsc = this.engineSubOsc;
    const filter = this.engineFilter;
    const gain = this.engineGain;

    this.engineOsc = null;
    this.engineSubOsc = null;
    this.engineFilter = null;
    this.engineGain = null;

    setTimeout(() => {
      try {
        osc?.stop();
        osc?.disconnect();
        subOsc?.stop();
        subOsc?.disconnect();
        filter?.disconnect();
        gain?.disconnect();
      } catch {
        // Already stopped
      }
    }, 120);
  }

  playCountdown(isGo: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isGo ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, ctx.currentTime);
    gain.gain.setValueAtTime(isGo ? 0.12 : 0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (isGo ? 0.35 : 0.16));

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (isGo ? 0.38 : 0.18));
  }

  playHoleshot(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(220, now);
    osc1.frequency.exponentialRampToValueAtTime(920, now + 0.3);
    osc2.frequency.setValueAtTime(440, now);
    osc2.frequency.exponentialRampToValueAtTime(1180, now + 0.3);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.36);
    osc2.stop(now + 0.36);
  }

  playRampJump(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.22);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  playBoostPad(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(780, ctx.currentTime + 0.22);

    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.27);
  }

  playPickup(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1040, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  }

  playStumble(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(160, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.2);

    gain.gain.setValueAtTime(0.09, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  }

  playBump(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(125, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(58, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.055, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  playFinish(won: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const notes = won ? [523.25, 659.25, 783.99, 1046.5] : [392.0, 493.88, 587.33];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + idx * 0.08;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }
}

export const soundEngine = new RaceSoundEngine();
