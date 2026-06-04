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
  /** Max retries per shot on busy (555) response */
  maxRetries?: number;
  /** Initial backoff delay in ms (doubles each retry) */
  retryBackoffMs?: number;
  /** Backoff multiplier per retry */
  retryBackoffFactor?: number;
  /** Called per completed shot */
  onShot?: (result: ShotResult) => void;
  /** Called when any shot succeeds */
  onSuccess?: (result: ShotResult) => void;
  /** Called when all shots are fired without success */
  onDepleted?: () => void;
}

interface RetryItem {
  shot: FireShot;
  shotIdx: number;
  scheduledAt: number;
}

export class FireConductor {
  private queue: FireShot[];
  private processor: (shot: FireShot, shotIdx: number) => Promise<ShotResult>;
  private maxConcurrent: number;
  private minConcurrent: number;
  private backpressureFactor: number;
  private maxRetries: number;
  private retryBackoffMs: number;
  private retryBackoffFactor: number;
  private inFlight = 0;
  private idx = 0;
  private completed = 0;
  private success = false;
  private retryQueue: RetryItem[] = [];
  private retryCounts = new Map<number, number>();
  private onShot: ((r: ShotResult) => void) | null;
  private onSuccess: ((r: ShotResult) => void) | null;
  private onDepleted: (() => void) | null;
  private drainTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    shots: FireShot[],
    processor: (shot: FireShot, shotIdx: number) => Promise<ShotResult>,
    opts: ConductorOptions = {},
  ) {
    this.queue = [...shots];
    this.processor = processor;
    this.maxConcurrent = opts.maxConcurrent ?? 8;
    this.minConcurrent = opts.minConcurrent ?? 2;
    this.backpressureFactor = opts.backpressureFactor ?? 0.5;
    this.maxRetries = opts.maxRetries ?? 6;
    this.retryBackoffMs = opts.retryBackoffMs ?? 200;
    this.retryBackoffFactor = opts.retryBackoffFactor ?? 2;
    this.onShot = opts.onShot ?? null;
    this.onSuccess = opts.onSuccess ?? null;
    this.onDepleted = opts.onDepleted ?? null;
  }

  start(): void {
    if (this.queue.length === 0 && this.retryQueue.length === 0) {
      this.onDepleted?.();
      return;
    }
    this.tick();
    if (this.inFlight === 0 && this.idx >= this.queue.length && this.retryQueue.length === 0) {
      return;
    }
    this.drainTimer = setInterval(() => this.tick(), 100);
  }

  cancel(): void {
    this.success = true;
    this.retryQueue = [];
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private tick(): void {
    const now = Date.now();

    // Promote ready retries into flight
    const ready: RetryItem[] = [];
    const pending: RetryItem[] = [];
    for (const item of this.retryQueue) {
      if (item.scheduledAt <= now) {
        ready.push(item);
      } else {
        pending.push(item);
      }
    }
    this.retryQueue = pending;

    for (const item of ready) {
      this.inFlight++;
      this.execute(item.shot, item.shotIdx);
    }

    // Fill remaining capacity from main queue
    while (this.inFlight < this.maxConcurrent && this.idx < this.queue.length && !this.success) {
      const shotIdx = this.idx++;
      const shot = this.queue[shotIdx];
      if (!shot) break;
      this.inFlight++;
      this.execute(shot, shotIdx);
    }

    // Depleted only when nothing is in flight, nothing queued, nothing waiting to retry
    if (this.inFlight === 0 && this.idx >= this.queue.length && this.retryQueue.length === 0) {
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

      // Exponential backoff retry
      const retryCount = this.retryCounts.get(shotIdx) ?? 0;
      if (retryCount < this.maxRetries) {
        this.retryCounts.set(shotIdx, retryCount + 1);
        const delay = this.retryBackoffMs * Math.pow(this.retryBackoffFactor, retryCount);
        const jitter = Math.random() * delay * 0.1;
        this.retryQueue.push({
          shot: { ...shot },
          shotIdx,
          scheduledAt: Date.now() + delay + jitter,
        });
        return; // tick() picks this up from retryQueue when scheduledAt is reached
      }
    }

    this.tick();
  }
}
