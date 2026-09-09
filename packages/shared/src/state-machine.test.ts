import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  isTerminalState,
} from './state-machine.js';
import { requestStates } from './types.js';

describe('request state machine', () => {
  it('supports the supervised movie happy path', () => {
    const path = [
      'REQUESTED',
      'APPROVED',
      'ADDING_TO_ARR',
      'SELECTING_RELEASE',
      'QUEUED',
      'DOWNLOADING',
      'IMPORTING',
      'WAITING_FOR_BAZARR',
      'SUBTITLES_REQUIRED',
      'VERIFYING_JELLYFIN',
      'READY',
    ] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransition(path[index]!, path[index + 1]!)).toBe(true);
    }
  });

  it('never permits automatic release selection directly from approval', () => {
    expect(canTransition('APPROVED', 'QUEUED')).toBe(false);
    expect(() => assertTransition('APPROVED', 'QUEUED')).toThrow(/Invalid request transition/);
  });

  it('skips duplicate download work when Radarr already has the movie file', () => {
    expect(canTransition('ADDING_TO_ARR', 'WAITING_FOR_BAZARR')).toBe(true);
    expect(canTransition('ADDING_TO_ARR', 'READY')).toBe(false);
  });

  it('allows replacing a manually selected subtitle before Jellyfin verification', () => {
    expect(canTransition('VERIFYING_JELLYFIN', 'SUBTITLES_REQUIRED')).toBe(true);
  });

  it('allows recovery from a stalled download without hiding human choice', () => {
    expect(canTransition('STALLED', 'DOWNLOADING')).toBe(true);
    expect(canTransition('STALLED', 'SELECTING_RELEASE')).toBe(true);
  });

  it('supports pausing and resuming without losing ownership', () => {
    expect(canTransition('DOWNLOADING', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSED', 'DOWNLOADING')).toBe(true);
    expect(canTransition('PAUSED', 'READY')).toBe(false);
  });

  it('defines transitions for every known state', () => {
    expect(Object.keys(allowedTransitions).sort()).toEqual([...requestStates].sort());
  });

  it('marks only completed decisions as terminal', () => {
    expect(isTerminalState('READY')).toBe(true);
    expect(isTerminalState('REJECTED')).toBe(true);
    expect(isTerminalState('CANCELLED')).toBe(true);
    expect(isTerminalState('FAILED')).toBe(false);
  });
});
