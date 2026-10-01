/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as atBat from "../atBat.js";
import type * as atBatView from "../atBatView.js";
import type * as bot from "../bot.js";
import type * as clubSide from "../clubSide.js";
import type * as duelContract from "../duelContract.js";
import type * as game from "../game.js";
import type * as gameView from "../gameView.js";
import type * as participants from "../participants.js";
import type * as revealDismissals from "../revealDismissals.js";
import type * as seed from "../seed.js";
import type * as seedRoster from "../seedRoster.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  atBat: typeof atBat;
  atBatView: typeof atBatView;
  bot: typeof bot;
  clubSide: typeof clubSide;
  duelContract: typeof duelContract;
  game: typeof game;
  gameView: typeof gameView;
  participants: typeof participants;
  revealDismissals: typeof revealDismissals;
  seed: typeof seed;
  seedRoster: typeof seedRoster;
  users: typeof users;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
