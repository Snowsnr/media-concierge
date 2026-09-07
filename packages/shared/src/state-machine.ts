import type { RequestState } from './types.js';

export const allowedTransitions: Readonly<Record<RequestState, readonly RequestState[]>> = {
  REQUESTED: ['SYNCED_TO_HOMELAB', 'NEEDS_CLARIFICATION', 'APPROVED', 'REJECTED', 'CANCELLED'],
  SYNCED_TO_HOMELAB: ['NEEDS_CLARIFICATION', 'APPROVED', 'REJECTED', 'CANCELLED'],
  NEEDS_CLARIFICATION: ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['ADDING_TO_ARR', 'CANCELLED', 'FAILED'],
  REJECTED: [],
  ADDING_TO_ARR: ['SELECTING_RELEASE', 'WAITING_FOR_BAZARR', 'FAILED', 'CANCELLED'],
  SELECTING_RELEASE: ['QUEUED', 'FAILED', 'CANCELLED'],
  QUEUED: ['DOWNLOADING', 'PAUSED', 'STALLED', 'FAILED', 'CANCELLED'],
  DOWNLOADING: ['PAUSED', 'STALLED', 'IMPORTING', 'FAILED', 'CANCELLED'],
  PAUSED: ['DOWNLOADING', 'SELECTING_RELEASE', 'CANCELLED'],
  STALLED: ['DOWNLOADING', 'PAUSED', 'SELECTING_RELEASE', 'FAILED', 'CANCELLED'],
  IMPORTING: ['WAITING_FOR_BAZARR', 'FAILED', 'CANCELLED'],
  WAITING_FOR_BAZARR: ['SUBTITLES_REQUIRED', 'VERIFYING_JELLYFIN', 'FAILED'],
  SUBTITLES_REQUIRED: ['VERIFYING_JELLYFIN', 'FAILED', 'CANCELLED'],
  VERIFYING_JELLYFIN: ['READY', 'FAILED'],
  READY: [],
  FAILED: ['DOWNLOADING', 'IMPORTING', 'SELECTING_RELEASE', 'CANCELLED'],
  CANCELLED: [],
};

export const canTransition = (from: RequestState, to: RequestState): boolean =>
  allowedTransitions[from].includes(to);

export const assertTransition = (from: RequestState, to: RequestState): void => {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid request transition: ${from} -> ${to}`);
  }
};

export const isTerminalState = (state: RequestState): boolean =>
  state === 'READY' || state === 'REJECTED' || state === 'CANCELLED';
