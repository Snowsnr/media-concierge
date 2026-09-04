import { z } from 'zod';
import { requestStates } from './types.js';

export const mediaMetadataSchema = z.object({
  tmdbId: z.number().int().positive(),
  type: z.enum(['movie', 'series']),
  localizedTitle: z.string().trim().min(1).max(200),
  originalTitle: z.string().trim().min(1).max(200),
  year: z.number().int().min(1888).max(2200),
  overview: z.string().trim().max(2000),
  posterUrl: z.string().url(),
});

export const seriesScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('season'), seasonNumber: z.number().int().min(0).max(200) }),
  z.object({
    kind: z.literal('episode'),
    seasonNumber: z.number().int().min(0).max(200),
    episodeNumber: z.number().int().min(1).max(1000),
  }),
  z.object({ kind: z.literal('aired') }),
]);

export const createRequestSchema = z
  .object({
    media: mediaMetadataSchema,
    requesterName: z.string().trim().min(2).max(80),
    note: z.string().trim().max(500).optional().default(''),
    scope: seriesScopeSchema.nullable().optional().default(null),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (value.media.type === 'series' && value.scope === null) {
      context.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'Elige el alcance de la serie.',
      });
    }
    if (value.media.type === 'movie' && value.scope !== null) {
      context.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'Una película no usa alcance.',
      });
    }
  });

export const transitionRequestSchema = z.object({
  toState: z.enum(requestStates),
  actor: z.enum(['family', 'admin', 'system']),
  note: z.string().trim().min(1).max(500),
});

export const adminDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'clarify']),
  note: z.string().trim().max(500).optional().default(''),
});

export const identifierSchema = z.object({ id: z.string().uuid() });

export const mockScenarioSchema = z.object({
  scenario: z.enum([
    'none',
    'stalled',
    'download-error',
    'import-delay',
    'no-subtitles',
    'jellyfin-delay',
  ]),
});

export const downloadControlSchema = z.object({
  action: z.enum(['pause', 'resume', 'reannounce', 'retry-release', 'cancel']),
  deleteData: z.boolean().optional().default(false),
  blocklist: z.boolean().optional().default(false),
});

export const subtitleSelectionSchema = z.object({
  candidateId: z.string().min(1).max(200),
  episodeId: z.string().uuid().optional(),
});

export const episodeActionSchema = z.object({
  action: z.enum(['ready-without-subtitles', 'retry-subtitles']),
});

export const createInvitationSchema = z.object({
  label: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});
