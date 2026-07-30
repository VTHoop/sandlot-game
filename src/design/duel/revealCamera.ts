import type { LandingZone } from './ballFlight'

/**
 * The reveal's camera.
 *
 * It opens tight on the diamond, widens only as far as the ball forces it, and
 * then holds — so the frame it comes to rest in is itself a readout of how far the
 * ball went. How far it opens is derived from the landing point, never from the
 * outcome key, so an outcome nobody framed by hand still frames correctly.
 */

/** A viewBox, as numbers so it can be interpolated. */
export interface Frame {
  x: number
  y: number
  w: number
  h: number
}

/** The opening shot: the diamond, filling the frame. */
export const TIGHT_FRAME: Frame = { x: 8, y: 14, w: 224, h: 224 }

/** The widest the camera ever goes: the whole park. */
export const WIDE_FRAME: Frame = { x: -100, y: -120, w: 440, h: 360 }

/** Park units from the plate at which the camera is fully open. */
export const FULL_OPEN_REACH = 330

export interface CameraShot {
  /** Where this ball finishes, or undefined when nothing was put in play. */
  zone: LandingZone | undefined
  /** When the ball leaves the bat, in the reveal's own seconds. */
  ballAt: number
}

/** The frame at time `t`. */
export function cameraFrameAt(_t: number, _shot: CameraShot): Frame {
  throw new Error('not implemented')
}

/** A frame as an SVG viewBox attribute. */
export function frameToViewBox(_frame: Frame): string {
  throw new Error('not implemented')
}
