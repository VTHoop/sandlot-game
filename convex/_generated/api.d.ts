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
import type * as atBatOpened from "../atBatOpened.js";
import type * as atBatView from "../atBatView.js";
import type * as attributes from "../attributes.js";
import type * as bot from "../bot.js";
import type * as clubSide from "../clubSide.js";
import type * as duelContract from "../duelContract.js";
import type * as game from "../game.js";
import type * as gameView from "../gameView.js";
import type * as ingest from "../ingest.js";
import type * as mlbFields from "../mlbFields.js";
import type * as mlbStats from "../mlbStats.js";
import type * as myGames from "../myGames.js";
import type * as normalize from "../normalize.js";
import type * as participants from "../participants.js";
import type * as push from "../push.js";
import type * as pushSend from "../pushSend.js";
import type * as pushTrigger from "../pushTrigger.js";
import type * as revealDismissals from "../revealDismissals.js";
import type * as seasonPlayers from "../seasonPlayers.js";
import type * as seed from "../seed.js";
import type * as seedRoster from "../seedRoster.js";
import type * as sprintSpeed from "../sprintSpeed.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  atBat: typeof atBat;
  atBatOpened: typeof atBatOpened;
  atBatView: typeof atBatView;
  attributes: typeof attributes;
  bot: typeof bot;
  clubSide: typeof clubSide;
  duelContract: typeof duelContract;
  game: typeof game;
  gameView: typeof gameView;
  ingest: typeof ingest;
  mlbFields: typeof mlbFields;
  mlbStats: typeof mlbStats;
  myGames: typeof myGames;
  normalize: typeof normalize;
  participants: typeof participants;
  push: typeof push;
  pushSend: typeof pushSend;
  pushTrigger: typeof pushTrigger;
  revealDismissals: typeof revealDismissals;
  seasonPlayers: typeof seasonPlayers;
  seed: typeof seed;
  seedRoster: typeof seedRoster;
  sprintSpeed: typeof sprintSpeed;
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
