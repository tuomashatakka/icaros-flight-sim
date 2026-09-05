import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  benchmarkRenderPreset,
  createQualityTransition,
  qualityBufferSize,
  RENDERER_QUALITY_LEVELS,
} from 'Δengine/renderer-quality'
import { createBattlePost } from 'Δengine/battle/post'


const CAMERA_POSE = [ 0, 8, 12, 0, 0, 0, 1 ] as const
const BUFFER      = { width: 1280, height: 720 }

afterEach(() => vi.useRealTimers())

describe('renderer quality budgets', () => {
  it('benchmarks every preset against a direct draw at the same pose and buffer', () => {
    const direct = benchmarkRenderPreset('direct', CAMERA_POSE, BUFFER)
    const runs   = RENDERER_QUALITY_LEVELS.map(level => benchmarkRenderPreset(level, CAMERA_POSE, BUFFER))

    expect(runs.every(run => run.cameraPose === direct.cameraPose)).toBe(true)
    expect(runs.every(run => run.drawingBuffer === direct.drawingBuffer)).toBe(true)
    expect(runs.map(run => run.fragmentPixels)).toEqual([
      direct.fragmentPixels,
      direct.fragmentPixels,
      direct.fragmentPixels * 3,
      direct.fragmentPixels * 5,
    ])
  })

  it('scales renderer and effect buffers from the same tier', () => {
    expect(qualityBufferSize('low', 1000, 500, 2)).toEqual({ width: 1500, height: 750 })
    expect(qualityBufferSize('medium', 1000, 500, 2)).toEqual({ width: 1800, height: 900 })
  })

  it('keeps off and low on the direct path', () => {
    expect(createBattlePost('off').options).toBeUndefined()
    expect(createBattlePost('low').options).toBeUndefined()
    expect(createBattlePost('medium').options?.bloom).not.toBe(false)
    expect(createBattlePost('high').options?.bloom).not.toBe(false)
  })

  it('recreates a tier once after a debounced transition', () => {
    vi.useFakeTimers()

    const apply      = vi.fn()
    const transition = createQualityTransition('high', apply, 300)

    transition.request('medium')
    transition.request('low')
    vi.advanceTimersByTime(299)
    expect(apply).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith('low')
    transition.dispose()
  })
})
