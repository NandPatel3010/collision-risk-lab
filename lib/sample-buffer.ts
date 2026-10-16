export type RecordedSample = {
  clientSampleId: string;
  elapsedMs: number;
  scale: number;
  rawTtc: number | null;
  quality: number;
};

/** One buffer per run: failures retain the exact IDs so retries are idempotent. */
export class SampleBuffer {
  private pending: RecordedSample[] = [];
  private inFlight: Promise<void> | null = null;
  savedCount = 0;

  get pendingCount() { return this.pending.length; }

  add(sample: RecordedSample) { this.pending.push(sample); }

  flush(send: (batch: RecordedSample[]) => Promise<void>): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.drain(send).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async drain(send: (batch: RecordedSample[]) => Promise<void>) {
    while (this.pending.length) {
      const batch = this.pending.slice(0, 32);
      await send(batch);
      // Remove samples only after acknowledgement. A failed request rejects flush.
      this.pending.splice(0, batch.length);
      this.savedCount += batch.length;
    }
  }
}
