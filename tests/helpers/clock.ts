/**
 * Injectable clock (`now()` dep, design.md §1) so TTL/retention/office-hours contract
 * cases never `sleep()` — they advance a fake clock instead.
 */
export interface FakeClock {
  now(): Date;
  /** Jump to an absolute instant. */
  set(at: Date | string | number): void;
  /** Move forward by a duration; returns the new `now()`. */
  advance(ms: number): Date;
  advanceSeconds(seconds: number): Date;
  advanceMinutes(minutes: number): Date;
  advanceHours(hours: number): Date;
  advanceDays(days: number): Date;
}

/** Default epoch: a Monday, safely inside office-hours test ranges (design.md §8). */
const DEFAULT_START = '2026-01-12T10:00:00.000Z';

export function createFakeClock(initial: Date | string | number = DEFAULT_START): FakeClock {
  let current = new Date(initial);

  const clock: FakeClock = {
    now: () => new Date(current.getTime()),
    set: (at) => {
      current = new Date(at);
    },
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
      return clock.now();
    },
    advanceSeconds: (seconds) => clock.advance(seconds * 1000),
    advanceMinutes: (minutes) => clock.advance(minutes * 60 * 1000),
    advanceHours: (hours) => clock.advance(hours * 60 * 60 * 1000),
    advanceDays: (days) => clock.advance(days * 24 * 60 * 60 * 1000),
  };
  return clock;
}
