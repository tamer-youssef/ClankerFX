/**
 * Final safety stage after the effect chain: a fast, high-ratio compressor acting as a limiter, so a
 * badly set effect cannot send full-scale bursts to the speakers.
 *
 * INTERIM: Phase 5 replaces this with a look-ahead brickwall limiter shared with the offline render path.
 */
export function createSafetyLimiter(context: BaseAudioContext): DynamicsCompressorNode {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  return limiter;
}
