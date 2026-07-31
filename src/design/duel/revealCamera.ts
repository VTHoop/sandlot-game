import { LANDING_ZONES } from './Ballpark'
import { type LandingZone, PLATE } from './ballFlight'

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

/**
 * The reach at which the camera is fully open — derived as the distance to the
 * deepest landing zone there is, so the longest ball in the game opens the whole
 * park and nothing opens it further. Deriving rather than hardcoding means moving
 * a landing zone can never quietly leave the widest frame unreachable.
 */
export const FULL_OPEN_REACH = Math.max(
  ...Object.values(LANDING_ZONES).map((zone) => Math.hypot(zone.x - PLATE.x, zone.y - PLATE.y)),
)

export interface CameraShot {
  /** Where this ball finishes, or undefined when nothing was put in play. */
  zone: LandingZone | undefined
  /** When the ball leaves the bat, in the reveal's own seconds. */
  ballAt: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const easeInOut = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * How far open the camera ends up, from where the ball finishes — never from which
 * outcome it was. A ball that dies on the dirt barely moves the frame; one that
 * clears the fence opens it all the way. Outcomes nobody framed by hand get the
 * right frame for free, which is the whole point of deriving it.
 */
function openness(shot: CameraShot): number {
  if (!shot.zone) return 0
  const reach = Math.hypot(shot.zone.x - PLATE.x, shot.zone.y - PLATE.y)
  return clamp01(reach / FULL_OPEN_REACH)
}

/**
 * The frame at time `t`.
 *
 * Tight until the ball is struck, opening across exactly the flight so it arrives
 * at its widest as the ball lands, then held — the resting frame is a readout of
 * how far the ball went, and holding it means the base running never fights a
 * second camera move for attention.
 */
export function cameraFrameAt(t: number, shot: CameraShot): Frame {
  const zone = shot.zone
  if (!zone || zone.flight <= 0) return { ...TIGHT_FRAME }
  const spread = easeInOut(clamp01((t - shot.ballAt) / zone.flight)) * openness(shot)
  return {
    x: lerp(TIGHT_FRAME.x, WIDE_FRAME.x, spread),
    y: lerp(TIGHT_FRAME.y, WIDE_FRAME.y, spread),
    w: lerp(TIGHT_FRAME.w, WIDE_FRAME.w, spread),
    h: lerp(TIGHT_FRAME.h, WIDE_FRAME.h, spread),
  }
}

/** A frame as an SVG viewBox attribute. */
export function frameToViewBox(frame: Frame): string {
  return `${frame.x} ${frame.y} ${frame.w} ${frame.h}`
}
