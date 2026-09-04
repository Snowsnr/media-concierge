import type { MediaMetadata, ReleaseCandidate, SubtitleCandidate } from '@media-concierge/shared';

export const mockCatalog: MediaMetadata[] = [
  {
    tmdbId: 945961,
    type: 'movie',
    localizedTitle: 'Alien: Romulus',
    originalTitle: 'Alien: Romulus',
    year: 2024,
    overview:
      'Un grupo de jóvenes colonizadores se enfrenta a la forma de vida más aterradora del universo.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/b33nnKl1GSFbao4l3fZDDqsMx0F.jpg',
  },
  {
    tmdbId: 693134,
    type: 'movie',
    localizedTitle: 'Duna: Parte dos',
    originalTitle: 'Dune: Part Two',
    year: 2024,
    overview:
      'Paul Atreides se une a Chani y los Fremen mientras busca vengar la caída de su familia.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/6o5cJjA4srfvU52UKWaqPUuPPgl.jpg',
  },
  {
    tmdbId: 1399,
    type: 'series',
    localizedTitle: 'Juego de tronos',
    originalTitle: 'Game of Thrones',
    year: 2011,
    overview: 'Nueve familias nobles luchan por el control de las tierras de Poniente.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/z9gCSwIObDOD2BEtmUwfasar3xs.jpg',
  },
  {
    tmdbId: 100088,
    type: 'series',
    localizedTitle: 'The Last of Us',
    originalTitle: 'The Last of Us',
    year: 2023,
    overview:
      'Dos sobrevivientes cruzan una Norteamérica devastada y aprenden a depender uno del otro.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg',
  },
];

export const buildMockReleases = (requestId: string): ReleaseCandidate[] => [
  {
    id: 'release-balanced-1080p',
    requestId,
    title: 'Example.2024.1080p.BluRay.DDP5.1.x265-GROUP',
    coverage: 'Película completa',
    quality: 'Bluray-1080p',
    resolution: '1080p',
    source: 'BluRay',
    videoCodec: 'x265',
    audioCodec: 'DDP 5.1',
    sizeBytes: 5_476_000_000,
    indexer: 'Mock Indexer A',
    seeds: 46,
    leechers: 5,
    languages: ['Inglés', 'Español'],
    isRepack: false,
    rejections: [],
    customFormats: ['x265', 'Dual audio'],
    ageHours: 18,
    score: 78,
    scoreReasons: [
      { points: 25, label: 'Resolución 1080p' },
      { points: 15, label: 'Códec x265 eficiente' },
      { points: 20, label: 'Menos de 6 GB' },
      { points: 18, label: 'Seeds anunciados saludables' },
    ],
  },
  {
    id: 'release-large-1080p',
    requestId,
    title: 'Example.2024.1080p.REMUX.AVC.TrueHD.7.1-GROUP',
    coverage: 'Película completa',
    quality: 'Remux-1080p',
    resolution: '1080p',
    source: 'BluRay Remux',
    videoCodec: 'AVC',
    audioCodec: 'TrueHD 7.1',
    sizeBytes: 24_800_000_000,
    indexer: 'Mock Indexer B',
    seeds: 82,
    leechers: 12,
    languages: ['Inglés'],
    isRepack: false,
    rejections: [],
    customFormats: ['Remux'],
    ageHours: 72,
    score: 48,
    scoreReasons: [
      { points: 25, label: 'Resolución 1080p' },
      { points: 28, label: 'Calidad visual sin pérdida' },
      { points: 15, label: 'Seeds anunciados saludables' },
      { points: -20, label: 'Tamaño muy por encima de 6 GB' },
    ],
  },
  {
    id: 'release-rejected-720p',
    requestId,
    title: 'Example.2024.720p.WEBRip.x264-OLD',
    coverage: 'Película completa',
    quality: 'WEBDL-720p',
    resolution: '720p',
    source: 'WEB-DL',
    videoCodec: 'x264',
    audioCodec: 'AAC 2.0',
    sizeBytes: 1_720_000_000,
    indexer: 'Mock Indexer C',
    seeds: 1,
    leechers: 9,
    languages: ['Inglés'],
    isRepack: false,
    rejections: ['Bloqueado anteriormente: descarga estancada'],
    customFormats: [],
    ageHours: 900,
    score: -12,
    scoreReasons: [
      { points: 8, label: 'Tamaño compacto' },
      { points: -10, label: 'Resolución inferior a la preferida' },
      { points: -10, label: 'Pocos seeds anunciados' },
      { points: -20, label: 'Release rechazado anteriormente' },
    ],
  },
];

export const buildMockSeriesReleases = (requestId: string): ReleaseCandidate[] =>
  buildMockReleases(requestId).map((release, index) => ({
    ...release,
    id: index === 0 ? 'season-pack-balanced' : `series-${release.id}`,
    title:
      index === 0
        ? 'Example.S01.COMPLETE.1080p.WEB-DL.DDP5.1.x265-GROUP'
        : index === 1
          ? 'Example.S01E01-E04.1080p.BluRay.x264-GROUP'
          : 'Example.S01E03-E04.720p.WEBRip.x264-OLD',
    coverage:
      index === 0
        ? 'Season pack · S01E01–S01E04'
        : index === 1
          ? 'Paquete multi-episodio · S01E01–S01E04'
          : 'Episodio doble · S01E03–S01E04',
    sizeBytes: index === 0 ? 12_800_000_000 : index === 1 ? 18_400_000_000 : 2_900_000_000,
  }));

export const buildMockSubtitles = (requestId: string): SubtitleCandidate[] => [
  {
    id: 'subtitle-latam',
    requestId,
    language: 'Español (Latinoamérica)',
    provider: 'MockSubtitles',
    score: 96,
    release: '1080p.BluRay.x265-GROUP',
    matches: ['Título', 'Año', 'Resolución', 'Grupo de release'],
    mismatches: [],
    hearingImpaired: false,
    forced: false,
    uploader: 'cinefilo-mx',
  },
  {
    id: 'subtitle-es',
    requestId,
    language: 'Español (España)',
    provider: 'OpenMockSubs',
    score: 81,
    release: '1080p.WEB-DL',
    matches: ['Título', 'Año', 'Resolución'],
    mismatches: ['Fuente distinta'],
    hearingImpaired: false,
    forced: false,
    uploader: 'subtitle-fan',
  },
];
