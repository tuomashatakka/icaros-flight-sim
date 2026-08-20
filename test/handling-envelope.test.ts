import { describe, expect, it } from 'vitest'
import { vehicleConfig } from '@/lib/utils'


describe('deliberate control authority', () => {
  it('keeps high-speed steering below 45 degrees per second', () => {
    const highSpeedYaw = vehicleConfig.maxYawRate * vehicleConfig.highSpeedYawScale
    expect(highSpeedYaw).toBeLessThan(Math.PI / 4)
    expect(vehicleConfig.yawResponse).toBeLessThanOrEqual(4.5)
  })

  it('keeps strafe below fifteen percent of cruise with a controlled ramp', () => {
    expect(vehicleConfig.strafeSpeedScale).toBeLessThanOrEqual(0.14)
    expect(vehicleConfig.maxSpeed * vehicleConfig.strafeSpeedScale).toBeLessThan(8)
    expect(vehicleConfig.strafeResponse).toBeLessThanOrEqual(8)
  })
})
