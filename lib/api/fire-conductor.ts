export interface FireShot {
  ticket: string;
  randstr: string;
  productId: string;
  wave?: 'initial' | 'follow-up' | 'burst';
  scheduledAt?: number;
}

export interface ShotResult {
  shotIdx: number;
  productId: string;
  outcome: 'success' | 'busy' | 'soldout' | 'error' | 'neterr';
  code?: number;
  rtt?: number;
  bizId?: string;
  wave?: string;
}

export interface ConductorOptions {
  maxConcurrent?: number;
  backpressureFactor?: number;
  /** Min concurrent after backpressure kicks in */
  minConcurrent?: number;
  /** Called per completed shot */
  onShot?: (result: ShotResult) => void;
  /** Called when any shot succeeds */
  onSuccess?: (result: ShotResult) => void;
  /** Called when all shots are fired without success */
  onDepleted?: () => void;
}

export class FireConductor {
  private queue: FireShot[];
  private processor: (shot: FireShot, shotIdx: number) => Promise<ShotResult>;
  private maxConcurrent: number;
  private minConcurrent: number;
  private backpressureFactor: number;
  private inFlight = 0;
  private idx = 0;
  private completed = 0;
  private success = false;
  private onShot: ((r: ShotResult) => void) | null;
  private onSuccess: ((r: ShotResult) => void) | null;
  private onDepleted: (() => void) | null;
  private drainTimer: ReturnType<typeof setInterval> | null = null;

  constructor(shots: FireShot[], processor: (shot: FireShot, shotIdx: number) => Promise<ShotResult>, opts: ConductorOptions = {}) {
    this.queue = [...shots];
    this.processor = processor;
    this.maxConcurrent = opts.maxConcurrent ?? 8;
    this.minConcurrent = opts.minConcurrent ?? 2;
    this.backpressureFactor = opts.backpressureFactor ?? 0.5;
    this.onShot = opts.onShot ?? null;
    this.onSuccess = opts.onSuccess ?? null;
    this.onDepleted = opts.onDepleted ?? null;
  }

  start(): void {
    if (this.queue.length === 0) {
      this.onDepleted?.();
      return;
    }
    this.tick();
    if (this.inFlight === 0 && this.idx >= this.queue.length) {
      return;
    }
    this.drainTimer = setInterval(() => this.tick(), 100);
  }

  cancel(): void {
    this.success = true;
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private tick(): void {
    while (this.inFlight < this.maxConcurrent && this.idx < this.queue.length && !this.success) {
      const shotIdx = this.idx++;
      const shot = this.queue[shotIdx];
      if (!shot) break;
      this.inFlight++;
      this.execute(shot, shotIdx);
    }
    if (this.inFlight === 0 && this.idx >= this.queue.length) {
      this.cancel();
      this.onDepleted?.();
    }
  }

  private async execute(shot: FireShot, shotIdx: number): Promise<void> {
    if (shot.scheduledAt && shot.scheduledAt > Date.now()) {
      const delay = shot.scheduledAt - Date.now();
      await new Promise((r) => setTimeout(r, delay));
    }

    const result = await this.processor(shot, shotIdx);
    this.completed++;
    this.inFlight--;

    this.onShot?.(result);

    if (result.outcome === 'success') {
      this.success = true;
      this.cancel();
      this.onSuccess?.(result);
      return;
    }

    if (result.outcome === 'busy') {
      const reduced = Math.round(this.maxConcurrent * this.backpressureFactor);
      this.maxConcurrent = Math.max(this.minConcurrent, reduced);
    }

    this.tick();
  }
}
