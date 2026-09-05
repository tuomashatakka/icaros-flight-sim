/** Data only: CLI and browser code can share these limits without pulling in either runtime. */
export const PERFORMANCE_TIERS = {
  'low-mobile': {
    target:   'pixel 4a emulation · chromium · 720x1280 · dpr 1',
    viewport: '720x1280',
    limits:   { p95FrameMs: 30, p99FrameMs: 42, worstFrameMs: 80, drawCalls: 450, triangles: 1800000 },
  },
  'modern-mobile': {
    target:   'pixel 8 emulation · chromium · 1080x2400 · dpr 1',
    viewport: '1080x2400',
    limits:   { p95FrameMs: 16.67, p99FrameMs: 22, worstFrameMs: 50, drawCalls: 400, triangles: 1500000 },
  },
  'desktop': {
    target:   'desktop chromium · 1920x1080 · dpr 1',
    viewport: '1920x1080',
    // 14 ms reserves 2.67 ms of the 16.67 ms 60 fps envelope for composition/input.
    limits:   { p95FrameMs: 14, p99FrameMs: 16.67, worstFrameMs: 40, drawCalls: 350, triangles: 1200000 },
  },
}

export const TOTAL_FRAME_60_FPS_MS = 16.67
