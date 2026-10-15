/** Which club of a game a push is for. Not a role: the club holds the same seat
 * for the whole game, while who bats and who pitches flips every half-inning. */
export enum PushSeat {
  Home = 'home',
  Away = 'away',
}
