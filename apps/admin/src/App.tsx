import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type {
  FamilyAccountSummary,
  HealthCheck,
  InvitationSummary,
  AppNotification,
  ArrConfiguration,
  MediaRequest,
  NotificationConfig,
  ReleaseCandidate,
  RequestState,
  SubtitleCandidate,
} from '@media-concierge/shared';
import { Button, EmptyState, StatusPill } from '@media-concierge/ui';
import { api } from './api';

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
const size = (bytes: number) => `${(bytes / 1_000_000_000).toFixed(1)} GB`;
const pendingStates: RequestState[] = ['REQUESTED', 'SYNCED_TO_HOMELAB', 'NEEDS_CLARIFICATION'];

export function App() {
  const navigate = useNavigate();
  const reset = async () => {
    if (
      !window.confirm(
        '¿Restablecer los datos simulados? Se eliminarán únicamente solicitudes del demo local.',
      )
    )
      return;
    await api.reset();
    navigate('/');
    window.location.reload();
  };
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Link to="/" className="admin-brand">
          <span>▶</span>
          <div>
            Media Concierge<small>Panel privado · Homelab</small>
          </div>
        </Link>
        <nav>
          <NavLink to="/">
            ▦ <span>Bandeja</span>
          </NavLink>
          <NavLink to="/salud">
            ⌁ <span>Integraciones</span>
          </NavLink>
          <NavLink to="/criterios">
            ⌘ <span>Criterios</span>
          </NavLink>
          <NavLink to="/invitaciones">
            ◇ <span>Invitaciones</span>
          </NavLink>
          <NavLink to="/avisos">
            ♢ <span>Avisos</span>
          </NavLink>
        </nav>
        <div className="privacy-card">
          <span>◉</span>
          <div>
            <strong>Modo seguro</strong>
            <small>ARR aún simulado</small>
          </div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="online-dot" /> Concierge privado
          </div>
          <Button variant="ghost" onClick={reset}>
            Restablecer demo
          </Button>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Inbox />} />
            <Route path="/solicitudes/:id" element={<RequestWorkspace />} />
            <Route path="/salud" element={<HealthPage />} />
            <Route path="/criterios" element={<CriteriaPage />} />
            <Route path="/invitaciones" element={<InvitationsPage />} />
            <Route path="/avisos" element={<AdminNotificationsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Inbox() {
  const [items, setItems] = useState<MediaRequest[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'ready'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .listRequests()
      .then(setItems)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          filter === 'all' ||
          (filter === 'pending' && pendingStates.includes(item.state)) ||
          (filter === 'ready' && item.state === 'READY') ||
          (filter === 'active' &&
            !pendingStates.includes(item.state) &&
            item.state !== 'READY' &&
            item.state !== 'REJECTED'),
      ),
    [items, filter],
  );
  return (
    <div className="admin-page">
      <div className="admin-heading">
        <div>
          <span className="kicker">Centro de operaciones</span>
          <h1>Bandeja de solicitudes</h1>
          <p>Revisa cada pedido y conserva la decisión final.</p>
        </div>
        <div className="metric">
          <strong>{items.filter((item) => pendingStates.includes(item.state)).length}</strong>
          <span>por revisar</span>
        </div>
      </div>
      <div className="filter-tabs">
        {(['all', 'pending', 'active', 'ready'] as const).map((value) => (
          <button
            className={filter === value ? 'active' : ''}
            onClick={() => setFilter(value)}
            key={value}
          >
            {value === 'all'
              ? 'Todas'
              : value === 'pending'
                ? 'Pendientes'
                : value === 'active'
                  ? 'En proceso'
                  : 'Listas'}
          </button>
        ))}
      </div>
      {error && <p className="error-box">{error}</p>}
      {loading ? (
        <p>Cargando bandeja…</p>
      ) : visible.length === 0 ? (
        <EmptyState icon="✓" title="Todo al día" copy="No hay solicitudes en esta vista." />
      ) : (
        <div className="inbox-table">
          <div className="table-head">
            <span>Contenido</span>
            <span>Solicitante</span>
            <span>Estado</span>
            <span>Actualizado</span>
            <span />
          </div>
          {visible.map((item) => (
            <Link className="inbox-row" to={`/solicitudes/${item.id}`} key={item.id}>
              <div className="media-cell">
                <img src={item.media.posterUrl} alt="" />
                <div>
                  <strong>{item.media.localizedTitle}</strong>
                  <span>
                    {item.media.type === 'movie' ? 'Película' : 'Serie'} · {item.media.year}
                  </span>
                </div>
              </div>
              <span>{item.requesterName}</span>
              <StatusPill status={item.publicStatus} />
              <span>{formatDate(item.updatedAt)}</span>
              <span className="row-arrow">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestWorkspace() {
  const { id } = useParams();
  const [item, setItem] = useState<MediaRequest | null>(null);
  const [releases, setReleases] = useState<ReleaseCandidate[]>([]);
  const [subtitleOptions, setSubtitleOptions] = useState<SubtitleCandidate[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [radarrLive, setRadarrLive] = useState(false);
  const load = useCallback(async () => {
    if (!id) return;
    const result = await api.getRequest(id);
    setItem(result);
    if (result.state === 'SELECTING_RELEASE') setReleases(await api.releases(id));
    if (result.state === 'SUBTITLES_REQUIRED') setSubtitleOptions(await api.subtitles(id));
  }, [id]);
  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, [load]);
  useEffect(() => {
    api
      .radarrConfiguration()
      .then((configuration) => setRadarrLive(configuration.mode === 'radarr'))
      .catch(() => setRadarrLive(false));
  }, []);
  useEffect(() => {
    if (
      !id ||
      !radarrLive ||
      busy ||
      item?.media.type !== 'movie' ||
      !['QUEUED', 'DOWNLOADING', 'IMPORTING'].includes(item.state)
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      void api
        .refreshRadarr(id)
        .then(() => load())
        .catch((reason: Error) => setError(reason.message));
    }, 8_000);
    return () => window.clearInterval(interval);
  }, [busy, id, item?.media.type, item?.state, load, radarrLive]);
  const act = async (task: () => Promise<MediaRequest>) => {
    setBusy(true);
    setError('');
    try {
      setItem(await task());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'La acción falló.');
    } finally {
      setBusy(false);
    }
  };
  if (!item || !id)
    return (
      <div className="admin-page">
        <p>Cargando solicitud…</p>
      </div>
    );
  return (
    <div className="workspace-page">
      <div className="workspace-header">
        <div>
          <Link to="/" className="back">
            ← Bandeja
          </Link>
          <div className="title-row">
            <img src={item.media.posterUrl} alt="" />
            <div>
              <span className="kicker">
                {item.media.type === 'movie' ? 'Película' : 'Serie'} · {item.media.year}
              </span>
              <h1>{item.media.localizedTitle}</h1>
              <p>
                Solicitado por <strong>{item.requesterName}</strong> · {formatDate(item.createdAt)}
              </p>
            </div>
          </div>
        </div>
        <StatusPill status={item.publicStatus} />
      </div>
      <StageRail state={item.state} />
      <div className="workspace-grid">
        <section className="workflow-card">
          {error && <p className="error-box">{error}</p>}
          {[
            'DOWNLOADING',
            'PAUSED',
            'STALLED',
            'IMPORTING',
            'SUBTITLES_REQUIRED',
            'VERIFYING_JELLYFIN',
          ].includes(item.state) &&
            !(radarrLive && item.media.type === 'movie') && (
              <ScenarioLab item={item} busy={busy} act={act} />
            )}
          <Workflow
            item={item}
            releases={releases}
            subtitles={subtitleOptions}
            note={note}
            setNote={setNote}
            busy={busy}
            act={act}
            radarrLive={radarrLive}
          />
        </section>
        <aside className="context-column">
          <section className="context-card">
            <h3>Solicitud</h3>
            {item.note ? <blockquote>“{item.note}”</blockquote> : <p>Sin nota adicional.</p>}
            {item.scope && (
              <p>
                <strong>Alcance:</strong>{' '}
                {item.scope.kind === 'aired'
                  ? 'Todo lo emitido'
                  : item.scope.kind === 'season'
                    ? `Temporada ${item.scope.seasonNumber}`
                    : `T${item.scope.seasonNumber} E${item.scope.episodeNumber}`}
              </p>
            )}
          </section>
          <History item={item} />
        </aside>
      </div>
    </div>
  );
}

function Workflow({
  item,
  releases,
  subtitles,
  note,
  setNote,
  busy,
  act,
  radarrLive,
}: {
  item: MediaRequest;
  releases: ReleaseCandidate[];
  subtitles: SubtitleCandidate[];
  note: string;
  setNote: (value: string) => void;
  busy: boolean;
  act: (task: () => Promise<MediaRequest>) => Promise<void>;
  radarrLive: boolean;
}) {
  if (pendingStates.includes(item.state))
    return (
      <div>
        <span className="step-label">Paso 1 · Decisión</span>
        <h2>Revisar solicitud</h2>
        <p className="workflow-copy">
          Aprobar no elige ni descarga un lanzamiento. Solo prepara la búsqueda{' '}
          {radarrLive && item.media.type === 'movie' ? 'interactiva de Radarr' : 'mock'} para que tú
          compares.
        </p>
        <textarea
          className="admin-note"
          placeholder="Nota para el historial o pregunta para el familiar…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="decision-row">
          <Button disabled={busy} onClick={() => act(() => api.decide(item.id, 'approve', note))}>
            Aprobar y buscar releases
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => act(() => api.decide(item.id, 'clarify', note))}
          >
            Pedir aclaración
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm('¿Rechazar esta solicitud?'))
                void act(() => api.decide(item.id, 'reject', note));
            }}
          >
            Rechazar
          </Button>
        </div>
      </div>
    );
  if (item.state === 'REJECTED')
    return (
      <Finished
        icon="×"
        title="Solicitud rechazada"
        copy="La decisión quedó registrada y el estado público fue actualizado."
      />
    );
  if (item.state === 'CANCELLED')
    return (
      <Finished
        icon="×"
        title="Flujo cancelado"
        copy="La cancelación coordinada y sus opciones quedaron registradas en el historial."
      />
    );
  if (item.state === 'SELECTING_RELEASE')
    return (
      <div>
        <span className="step-label">Paso 2 · Selección manual</span>
        <h2>Compara los lanzamientos</h2>
        <p className="workflow-copy">
          La puntuación orienta; no oculta resultados ni decide por ti.
        </p>
        <div className="release-list">
          {releases.map((release) => (
            <ReleaseCard
              key={release.id}
              release={release}
              disabled={busy}
              onSelect={() => act(() => api.selectRelease(item.id, release.id))}
            />
          ))}
        </div>
      </div>
    );
  if (item.state === 'DOWNLOADING' || item.state === 'QUEUED')
    return (
      <div>
        <span className="step-label">
          Paso 3 ·{' '}
          {radarrLive && item.media.type === 'movie' ? 'Cola de Radarr' : 'Seguimiento mock'}
        </span>
        <h2>{item.state === 'QUEUED' ? 'En cola' : 'Descargando'}</h2>
        <div className="download-panel">
          <div className="download-title">
            <strong>{item.media.localizedTitle}</strong>
            <span>{item.progress}%</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${item.progress}%` }} />
          </div>
          {radarrLive && item.media.type === 'movie' ? (
            <p className="workflow-copy">
              Progreso reportado por la cola de Radarr. Seeds, peers, velocidad y ETA reales se
              conectarán directamente a qBittorrent en la fase 5.
            </p>
          ) : (
            <div className="download-stats">
              <div>
                <span>Velocidad</span>
                <strong>18.4 MB/s</strong>
              </div>
              <div>
                <span>Seeds reales</span>
                <strong>12</strong>
              </div>
              <div>
                <span>Peers reales</span>
                <strong>4</strong>
              </div>
              <div>
                <span>ETA</span>
                <strong>
                  {item.progress
                    ? `${Math.ceil((100 - item.progress) / 25) * 2} min`
                    : 'Calculando'}
                </strong>
              </div>
            </div>
          )}
          <div className="control-row">
            <Button
              disabled={busy}
              onClick={() =>
                act(() =>
                  radarrLive && item.media.type === 'movie'
                    ? api.refreshRadarr(item.id)
                    : api.advance(item.id),
                )
              }
            >
              {radarrLive && item.media.type === 'movie'
                ? 'Actualizar desde Radarr'
                : item.progress < 75
                  ? 'Simular +25%'
                  : 'Completar e importar'}
            </Button>
            {!(radarrLive && item.media.type === 'movie') && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => act(() => api.controlDownload(item.id, 'pause'))}
                >
                  Pausar
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => act(() => api.controlDownload(item.id, 'reannounce'))}
                >
                  Forzar reannounce
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  if (item.state === 'PAUSED' || item.state === 'STALLED' || item.state === 'FAILED')
    return <DownloadRecovery item={item} busy={busy} act={act} />;
  if (item.state === 'IMPORTING')
    return (
      <div>
        <span className="step-label">Paso 3 · Importación</span>
        <h2>Esperando a Radarr/Sonarr</h2>
        <p className="workflow-copy">
          La descarga terminó, pero el mock mantiene la importación pendiente para probar una demora
          realista. No usamos un sleep fijo.
        </p>
        <div className="verification-box warning-box">
          <span>◷</span>
          <div>
            <strong>Importación todavía en proceso</strong>
            <p>Puedes volver a consultar sin mover ningún archivo directamente.</p>
          </div>
        </div>
        <Button disabled={busy} onClick={() => act(() => api.retryImport(item.id))}>
          Reintentar comprobación
        </Button>
      </div>
    );
  if (item.state === 'SUBTITLES_REQUIRED')
    return (
      <div>
        <span className="step-label">Paso 4 · Subtítulos</span>
        <h2>Elige un subtítulo</h2>
        <p className="workflow-copy">
          Modo manual total: cada resultado explica coincidencias y diferencias.
        </p>
        {item.media.type === 'series' ? (
          <SeriesSubtitleMatrix item={item} subtitles={subtitles} busy={busy} act={act} />
        ) : subtitles.length ? (
          <SubtitleList
            subtitles={subtitles}
            busy={busy}
            onSelect={(candidateId) => act(() => api.selectSubtitle(item.id, candidateId))}
          />
        ) : (
          <NoSubtitles item={item} busy={busy} act={act} />
        )}
      </div>
    );
  if (item.state === 'VERIFYING_JELLYFIN')
    return (
      <div>
        <span className="step-label">Paso 5 · Verificación final</span>
        <h2>Confirmar en Jellyfin</h2>
        <p className="workflow-copy">
          El mock simula una consulta de disponibilidad. No reinicia ni detiene Jellyfin.
        </p>
        <div className="verification-box">
          <span>◉</span>
          <div>
            <strong>Archivo y subtítulo listos</strong>
            <p>Esperando confirmación lógica del servidor multimedia.</p>
          </div>
        </div>
        <Button disabled={busy} onClick={() => act(() => api.verify(item.id))}>
          Verificar disponibilidad
        </Button>
      </div>
    );
  if (item.state === 'READY')
    return (
      <Finished
        icon="✓"
        title="Disponible en Jellyfin"
        copy="La verificación terminó. El familiar ya puede recibir el aviso final."
      />
    );
  return (
    <div>
      <span className="step-label">Estado técnico</span>
      <h2>{item.state.replaceAll('_', ' ')}</h2>
      <p>
        Este estado está contemplado por la máquina y se desarrollará con más controles en fases
        posteriores.
      </p>
    </div>
  );
}

function ScenarioLab({
  item,
  busy,
  act,
}: {
  item: MediaRequest;
  busy: boolean;
  act: (task: () => Promise<MediaRequest>) => Promise<void>;
}) {
  const options =
    item.state === 'DOWNLOADING'
      ? [
          ['none', 'Flujo normal'],
          ['stalled', 'Descarga estancada'],
          ['download-error', 'Archivos faltantes'],
          ['import-delay', 'Importación demorada'],
        ]
      : item.state === 'SUBTITLES_REQUIRED'
        ? [
            ['none', 'Resultados disponibles'],
            ['no-subtitles', 'Sin subtítulos'],
          ]
        : item.state === 'VERIFYING_JELLYFIN'
          ? [
              ['none', 'Disponible'],
              ['jellyfin-delay', 'Biblioteca demorada'],
            ]
          : [['none', 'Recuperación normal']];
  return (
    <div className="scenario-lab">
      <div>
        <strong>Laboratorio de fallos</strong>
        <span>Prueba recuperaciones sin tocar servicios reales.</span>
      </div>
      <select
        aria-label="Escenario simulado"
        value={item.mockScenario}
        disabled={busy}
        onChange={(event) =>
          void act(() =>
            api.setScenario(item.id, event.target.value as MediaRequest['mockScenario']),
          )
        }
      >
        {options.map(([value, label]) => (
          <option value={value} key={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function DownloadRecovery({
  item,
  busy,
  act,
}: {
  item: MediaRequest;
  busy: boolean;
  act: (task: () => Promise<MediaRequest>) => Promise<void>;
}) {
  const title =
    item.state === 'PAUSED'
      ? 'Descarga pausada'
      : item.state === 'STALLED'
        ? 'Descarga estancada'
        : 'La descarga falló';
  return (
    <div>
      <span className="step-label">Paso 3 · Intervención manual</span>
      <h2>{title}</h2>
      <p className="workflow-copy">
        Elige cómo recuperarla. Volver al selector simula primero la retirada coordinada desde
        Radarr/Sonarr.
      </p>
      <div className="recovery-actions">
        {item.state !== 'FAILED' && (
          <Button disabled={busy} onClick={() => act(() => api.controlDownload(item.id, 'resume'))}>
            Reanudar
          </Button>
        )}
        {item.state !== 'FAILED' && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => act(() => api.controlDownload(item.id, 'reannounce'))}
          >
            Forzar reannounce
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                '¿Retirar coordinadamente este release, añadirlo a la blocklist y volver al selector?',
              )
            )
              void act(() => api.controlDownload(item.id, 'retry-release'));
          }}
        >
          Bloquear release y volver a buscar
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (window.confirm('¿Cancelar conservando los datos parciales?'))
              void act(() => api.controlDownload(item.id, 'cancel'));
          }}
        >
          Cancelar y conservar datos
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Esta acción simula borrar datos parciales y añadir el release a la blocklist. ¿Continuar?',
              )
            )
              void act(() =>
                api.controlDownload(item.id, 'cancel', { deleteData: true, blocklist: true }),
              );
          }}
        >
          Cancelar, borrar y bloquear
        </Button>
      </div>
    </div>
  );
}

function SubtitleList({
  subtitles,
  busy,
  onSelect,
}: {
  subtitles: SubtitleCandidate[];
  busy: boolean;
  onSelect: (candidateId: string) => void;
}) {
  return (
    <div className="subtitle-list">
      {subtitles.map((subtitle) => (
        <div className="subtitle-card" key={subtitle.id}>
          <div>
            <span className="score-badge">{subtitle.score}</span>
            <h3>{subtitle.language}</h3>
            <p>
              {subtitle.provider} · {subtitle.uploader}
            </p>
          </div>
          <div className="match-list">
            <span>✓ {subtitle.matches.join(' · ')}</span>
            {subtitle.mismatches.map((mismatch) => (
              <span className="mismatch" key={mismatch}>
                △ {mismatch}
              </span>
            ))}
          </div>
          <Button disabled={busy} onClick={() => onSelect(subtitle.id)}>
            Seleccionar
          </Button>
        </div>
      ))}
    </div>
  );
}

function NoSubtitles({
  item,
  busy,
  act,
}: {
  item: MediaRequest;
  busy: boolean;
  act: (task: () => Promise<MediaRequest>) => Promise<void>;
}) {
  return (
    <div className="no-results">
      <span>CC</span>
      <h3>No se encontraron subtítulos</h3>
      <p>Este fallo es temporal y puede reintentarse sin perder la solicitud.</p>
      <Button disabled={busy} onClick={() => act(() => api.setScenario(item.id, 'none'))}>
        Reintentar búsqueda
      </Button>
    </div>
  );
}

function SeriesSubtitleMatrix({
  item,
  subtitles,
  busy,
  act,
}: {
  item: MediaRequest;
  subtitles: SubtitleCandidate[];
  busy: boolean;
  act: (task: () => Promise<MediaRequest>) => Promise<void>;
}) {
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(
    () =>
      item.episodes.find((episode) => episode.aired && episode.state === 'SUBTITLES_REQUIRED')?.id,
  );
  useEffect(() => {
    const current = item.episodes.find((episode) => episode.id === selectedEpisodeId);
    if (!current || current.state !== 'SUBTITLES_REQUIRED') {
      setSelectedEpisodeId(
        item.episodes.find((episode) => episode.aired && episode.state === 'SUBTITLES_REQUIRED')
          ?.id,
      );
    }
  }, [item.episodes, selectedEpisodeId]);
  const selectedEpisode = item.episodes.find((episode) => episode.id === selectedEpisodeId);
  return (
    <div className="episode-workspace">
      <div className="episode-matrix">
        {item.episodes.map((episode) => (
          <button
            className={selectedEpisodeId === episode.id ? 'selected' : ''}
            disabled={
              !episode.aired || ['READY', 'READY_WITHOUT_SUBTITLES'].includes(episode.state)
            }
            onClick={() => setSelectedEpisodeId(episode.id)}
            key={episode.id}
          >
            <strong>
              S{String(episode.seasonNumber).padStart(2, '0')}E
              {String(episode.episodeNumber).padStart(2, '0')}
            </strong>
            <span>{episodeLabel(episode.state)}</span>
          </button>
        ))}
      </div>
      {selectedEpisode && subtitles.length > 0 && (
        <>
          <h3 className="episode-title">
            S{String(selectedEpisode.seasonNumber).padStart(2, '0')}E
            {String(selectedEpisode.episodeNumber).padStart(2, '0')} · {selectedEpisode.title}
          </h3>
          <SubtitleList
            subtitles={subtitles}
            busy={busy}
            onSelect={(candidateId) =>
              act(() => api.selectSubtitle(item.id, candidateId, selectedEpisode.id))
            }
          />
          <Button
            className="without-subtitles"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              act(() => api.episodeAction(item.id, selectedEpisode.id, 'ready-without-subtitles'))
            }
          >
            Marcar episodio listo sin subtítulos
          </Button>
        </>
      )}
      {selectedEpisode && subtitles.length === 0 && (
        <div className="no-results">
          <span>CC</span>
          <h3>Sin resultados para este episodio</h3>
          <div className="control-row">
            <Button
              disabled={busy}
              onClick={() =>
                act(() => api.episodeAction(item.id, selectedEpisode.id, 'retry-subtitles'))
              }
            >
              Reintentar
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                act(() => api.episodeAction(item.id, selectedEpisode.id, 'ready-without-subtitles'))
              }
            >
              Continuar sin subtítulos
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function episodeLabel(state: MediaRequest['episodes'][number]['state']) {
  const labels: Record<typeof state, string> = {
    UNAIRED: 'No emitido',
    QUEUED: 'En cola',
    DOWNLOADING: 'Descargando',
    PAUSED: 'Pausado',
    IMPORTED: 'Importado',
    SUBTITLES_REQUIRED: 'Falta subtítulo',
    READY: 'Listo',
    READY_WITHOUT_SUBTITLES: 'Listo sin subtítulo',
    FAILED: 'Error',
  };
  return labels[state];
}

function ReleaseCard({
  release,
  disabled,
  onSelect,
}: {
  release: ReleaseCandidate;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={`release-card ${release.rejections.length ? 'release-card--warning' : ''}`}>
      <div className="score-column">
        <strong>{release.score}</strong>
        <span>puntos</span>
      </div>
      <div className="release-main">
        <h3>{release.title}</h3>
        <div className="release-tags">
          <span>{release.coverage}</span>
          <span>{release.quality}</span>
          <span>{release.videoCodec}</span>
          <span>{release.audioCodec}</span>
          <span>{size(release.sizeBytes)}</span>
          <span>
            ↑ {release.seeds} · ↓ {release.leechers}
          </span>
        </div>
        <details>
          <summary>¿Por qué esta puntuación?</summary>
          <div className="score-reasons">
            {release.scoreReasons.map((reason) => (
              <span className={reason.points < 0 ? 'negative' : ''} key={reason.label}>
                <strong>
                  {reason.points > 0 ? '+' : ''}
                  {reason.points}
                </strong>{' '}
                {reason.label}
              </span>
            ))}
          </div>
        </details>
        {release.rejections.map((rejection) => (
          <p className="warning" key={rejection}>
            ⚠ {rejection}
          </p>
        ))}
      </div>
      <Button
        variant={release.rejections.length ? 'secondary' : 'primary'}
        disabled={disabled}
        onClick={onSelect}
      >
        Elegir
      </Button>
    </article>
  );
}

function Finished({ icon, title, copy }: { icon: string; title: string; copy: string }) {
  return (
    <div className="finished">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{copy}</p>
    </div>
  );
}

function StageRail({ state }: { state: RequestState }) {
  const steps = ['Solicitud', 'Release', 'Descarga', 'Subtítulos', 'Jellyfin'];
  const stateStep: Partial<Record<RequestState, number>> = {
    REQUESTED: 0,
    SYNCED_TO_HOMELAB: 0,
    NEEDS_CLARIFICATION: 0,
    APPROVED: 0,
    ADDING_TO_ARR: 1,
    SELECTING_RELEASE: 1,
    QUEUED: 2,
    DOWNLOADING: 2,
    PAUSED: 2,
    STALLED: 2,
    FAILED: 2,
    IMPORTING: 2,
    WAITING_FOR_BAZARR: 3,
    SUBTITLES_REQUIRED: 3,
    VERIFYING_JELLYFIN: 4,
    READY: 5,
    CANCELLED: 0,
    REJECTED: 0,
  };
  const current = stateStep[state] ?? 0;
  return (
    <div className="stage-rail">
      {steps.map((step, index) => (
        <div className={index < current ? 'done' : index === current ? 'current' : ''} key={step}>
          <span>{index < current ? '✓' : index + 1}</span>
          <strong>{step}</strong>
        </div>
      ))}
    </div>
  );
}

function History({ item }: { item: MediaRequest }) {
  return (
    <section className="context-card">
      <h3>Historial</h3>
      <div className="mini-timeline">
        {[...item.history].reverse().map((entry) => (
          <div key={entry.id}>
            <span />
            <p>
              <strong>{entry.note}</strong>
              <small>
                {entry.actor} · {formatDate(entry.createdAt)}
              </small>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HealthPage() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [radarrConfig, setRadarrConfig] = useState<ArrConfiguration | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api.health(), api.radarrConfiguration()])
      .then(([nextChecks, configuration]) => {
        setChecks(nextChecks);
        setRadarrConfig(configuration);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);
  return (
    <div className="admin-page">
      <div className="admin-heading">
        <div>
          <span className="kicker">Observabilidad</span>
          <h1>Salud de integraciones</h1>
          <p>Comprueba conexiones reales y simuladas sin revelar credenciales.</p>
        </div>
      </div>
      {error && <p className="error-box">{error}</p>}
      <div className="health-grid">
        {checks.map((check) => (
          <div className="health-card" key={check.name}>
            <span className="mock-dot" />
            <div>
              <strong>{check.name}</strong>
              <p>{check.message}</p>
            </div>
            <code>{check.status.toUpperCase()}</code>
          </div>
        ))}
      </div>
      {radarrConfig && (
        <section className="radarr-config-card">
          <div className="radarr-config-heading">
            <div>
              <span className="kicker">Fase 4 · Películas</span>
              <h2>
                {radarrConfig.mode === 'radarr' ? 'Configuración de Radarr' : 'Radarr simulado'}
              </h2>
            </div>
            <code>{radarrConfig.configured ? 'LISTO' : 'SIN ESCRITURA'}</code>
          </div>
          {radarrConfig.issues.length > 0 && (
            <ul>
              {radarrConfig.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {radarrConfig.mode === 'radarr' && (
            <>
              <div className="radarr-config-grid">
                <div>
                  <span>Versión</span>
                  <strong>{radarrConfig.version ?? 'No indicada'}</strong>
                </div>
                <div>
                  <span>Perfil seleccionado</span>
                  <strong>
                    {radarrConfig.qualityProfiles.find(
                      (profile) => profile.id === radarrConfig.selectedQualityProfileId,
                    )?.name ?? 'Pendiente'}
                  </strong>
                </div>
                <div>
                  <span>Carpeta raíz</span>
                  <strong>{radarrConfig.selectedRootFolderPath ?? 'Pendiente'}</strong>
                </div>
              </div>
              <div className="radarr-options">
                <div>
                  <h3>Perfiles disponibles</h3>
                  {radarrConfig.qualityProfiles.map((profile) => (
                    <code key={profile.id}>
                      {profile.id} · {profile.name}
                    </code>
                  ))}
                </div>
                <div>
                  <h3>Carpetas disponibles</h3>
                  {radarrConfig.rootFolders.map((root) => (
                    <code key={root.id}>
                      {root.path} · {root.accessible ? 'accesible' : 'no accesible'}
                    </code>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function InvitationsPage() {
  const [items, setItems] = useState<InvitationSummary[]>([]);
  const [accounts, setAccounts] = useState<FamilyAccountSummary[]>([]);
  const [label, setLabel] = useState('Familia');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [createdUrl, setCreatedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [resetUserId, setResetUserId] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [accountMessage, setAccountMessage] = useState('');
  const load = useCallback(async () => {
    const [invitations, familyAccounts] = await Promise.all([
      api.invitations(),
      api.familyAccounts(),
    ]);
    setItems(invitations);
    setAccounts(familyAccounts);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async () => {
    setBusy(true);
    setMessage('');
    try {
      const invitation = await api.createInvitation(label, expiresInDays);
      setCreatedUrl(invitation.inviteUrl);
      setItems((current) => [invitation, ...current]);
      setMessage('Invitación creada. El enlace secreto solo se muestra ahora.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear la invitación.');
    } finally {
      setBusy(false);
    }
  };
  const savePassword = async (userId: string) => {
    setAccountMessage('');
    try {
      await api.resetFamilyPassword(userId, resetPassword);
      setResetPassword('');
      setResetUserId('');
      setAccountMessage('Contraseña restablecida. Compártela por un canal privado.');
    } catch (error) {
      setAccountMessage(
        error instanceof Error ? error.message : 'No se pudo restablecer la contraseña.',
      );
    }
  };
  return (
    <div className="admin-page">
      <div className="admin-heading">
        <div>
          <span className="kicker">Acceso familiar</span>
          <h1>Invitaciones</h1>
          <p>Enlaces individuales, de un solo uso, revocables y con expiración.</p>
        </div>
      </div>
      <div className="invitation-layout">
        <section className="invite-form-card">
          <h2>Nueva invitación</h2>
          <label>
            Identificador familiar
            <input
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label>
            Expira en
            <select
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(Number(event.target.value))}
            >
              <option value={1}>1 día</option>
              <option value={7}>7 días</option>
              <option value={14}>14 días</option>
              <option value={30}>30 días</option>
            </select>
          </label>
          <Button disabled={busy || !label.trim()} onClick={() => void create()}>
            {busy ? 'Creando…' : 'Crear enlace seguro'}
          </Button>
          {message && <p className="invite-message">{message}</p>}
          {createdUrl && (
            <div className="secret-link">
              <strong>Enlace de un solo uso</strong>
              <code>{createdUrl}</code>
              <Button
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(createdUrl)}
              >
                Copiar enlace
              </Button>
            </div>
          )}
        </section>
        <section className="invite-list-card">
          <h2>Accesos creados</h2>
          {items.length === 0 ? (
            <p className="muted-copy">
              No hay invitaciones remotas. En modo mock puedes probar la creación.
            </p>
          ) : (
            <div className="invite-list">
              {items.map((item) => {
                const status = item.revokedAt
                  ? 'Revocada'
                  : item.redeemedAt
                    ? 'Canjeada'
                    : new Date(item.expiresAt) < new Date()
                      ? 'Expirada'
                      : 'Pendiente';
                return (
                  <div key={item.id}>
                    <span className={`invite-status invite-status--${status.toLowerCase()}`} />
                    <div>
                      <strong>{item.label}</strong>
                      <small>
                        {status} · vence {formatDate(item.expiresAt)}
                      </small>
                    </div>
                    {!item.revokedAt && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (!window.confirm(`¿Revocar el acceso “${item.label}”?`)) return;
                          void api.revokeInvitation(item.id).then(() => load());
                        }}
                      >
                        Revocar
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <section className="account-list-card">
          <h2>Cuentas familiares</h2>
          <p className="muted-copy">
            Cada familiar inicia sesión con su usuario. Desde aquí puedes asignar una contraseña
            temporal si la olvida.
          </p>
          {accountMessage && <p className="invite-message">{accountMessage}</p>}
          {accounts.length === 0 ? (
            <p className="muted-copy">Las cuentas aparecerán después de completar el registro.</p>
          ) : (
            <div className="account-list">
              {accounts.map((account) => (
                <div className="account-row" key={account.userId}>
                  <div>
                    <strong>{account.displayName}</strong>
                    <small>
                      {account.username
                        ? `@${account.username}`
                        : 'Acceso anónimo pendiente de migrar'}
                      {account.revokedAt ? ' · Revocada' : ''}
                    </small>
                  </div>
                  {account.username && !account.revokedAt && resetUserId !== account.userId && (
                    <Button variant="ghost" onClick={() => setResetUserId(account.userId)}>
                      Restablecer contraseña
                    </Button>
                  )}
                  {resetUserId === account.userId && (
                    <div className="password-reset-row">
                      <input
                        aria-label={`Nueva contraseña para ${account.displayName}`}
                        type="password"
                        minLength={10}
                        maxLength={72}
                        autoComplete="new-password"
                        placeholder="Mínimo 10 caracteres"
                        value={resetPassword}
                        onChange={(event) => setResetPassword(event.target.value)}
                      />
                      <Button
                        disabled={resetPassword.length < 10}
                        onClick={() => void savePassword(account.userId)}
                      >
                        Guardar
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setResetUserId('');
                          setResetPassword('');
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function AdminNotificationsPage() {
  const [config, setConfig] = useState<NotificationConfig>({ enabled: false, publicKey: '' });
  const [items, setItems] = useState<AppNotification[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const supported =
    'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

  const refresh = async () => setItems(await api.notifications());

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [nextConfig, notifications] = await Promise.all([
          api.notificationConfig(),
          api.notifications(),
        ]);
        const existing = supported
          ? await (await navigator.serviceWorker.ready).pushManager.getSubscription()
          : null;
        if (existing && nextConfig.enabled && Notification.permission === 'granted') {
          await api.subscribeNotifications(existing.toJSON());
        }
        if (active) {
          setConfig(nextConfig);
          setItems(notifications);
          setSubscribed(Boolean(existing));
        }
      } catch (reason) {
        if (active)
          setMessage(reason instanceof Error ? reason.message : 'No pudimos cargar los avisos.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => void refresh().catch(() => undefined), 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const applicationServerKey = (value: string) => {
    const padded = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  };

  const enable = async () => {
    if (!supported) {
      setMessage('Este navegador no admite notificaciones push.');
      return;
    }
    if (!config.enabled || !config.publicKey) {
      setMessage('Falta terminar la configuración privada de notificaciones.');
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage('El navegador no concedió permiso. Los avisos seguirán guardados aquí.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(config.publicKey),
        }));
      await api.subscribeNotifications(subscription.toJSON());
      setSubscribed(true);
      setMessage('Avisos privados activados en este dispositivo.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'No pudimos activar los avisos.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const subscription = await (
        await navigator.serviceWorker.ready
      ).pushManager.getSubscription();
      if (subscription) {
        await api.unsubscribeNotifications(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setMessage('Avisos push desactivados en este dispositivo.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'No pudimos desactivar los avisos.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await api.testNotification();
      await refresh();
      setMessage('Prueba enviada.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'No pudimos enviar la prueba.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-heading">
        <div>
          <span className="kicker">Centro de avisos</span>
          <h1>Notificaciones privadas</h1>
          <p>Recibe un aviso cuando llegue una nueva solicitud familiar.</p>
        </div>
      </div>
      <section className="admin-notification-settings">
        <div>
          <strong>{subscribed ? 'Este dispositivo está activo' : 'Activa este dispositivo'}</strong>
          <p className="muted-copy">
            Los avisos del panel viajan por Supabase sin exponer tu homelab.
          </p>
        </div>
        <div className="admin-notification-actions">
          {subscribed ? (
            <>
              <Button disabled={busy} onClick={test}>
                Enviar prueba
              </Button>
              <Button variant="ghost" disabled={busy} onClick={disable}>
                Desactivar
              </Button>
            </>
          ) : (
            <Button disabled={busy || loading} onClick={enable}>
              Activar notificaciones
            </Button>
          )}
        </div>
        {message && <p className="invite-message">{message}</p>}
      </section>
      <section className="admin-notification-list">
        <h2>Historial</h2>
        {!loading && items.length === 0 && <p className="muted-copy">Todavía no hay avisos.</p>}
        {items.map((item) => (
          <Link
            className={
              item.readAt
                ? 'admin-notification-row'
                : 'admin-notification-row admin-notification-row--unread'
            }
            key={item.id}
            to={item.targetUrl}
            onClick={() => {
              if (!item.readAt) {
                void api.markNotificationRead(item.id);
                setItems((current) =>
                  current.map((candidate) =>
                    candidate.id === item.id
                      ? { ...candidate, readAt: new Date().toISOString() }
                      : candidate,
                  ),
                );
              }
            }}
          >
            <span />
            <div>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
              <small>{formatDate(item.createdAt)}</small>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

function CriteriaPage() {
  return (
    <div className="admin-page">
      <div className="admin-heading">
        <div>
          <span className="kicker">Preferencias explicables</span>
          <h1>Criterios de puntuación</h1>
          <p>Vista inicial de configuración; los cambios llegarán en una fase posterior.</p>
        </div>
      </div>
      <div className="criteria-card">
        <div>
          <strong>Resolución preferida</strong>
          <span>1080p</span>
        </div>
        <div>
          <strong>Códec eficiente</strong>
          <span>x265 · +15</span>
        </div>
        <div>
          <strong>Límite orientativo de película</strong>
          <span>6 GB · +20</span>
        </div>
        <div>
          <strong>Seeds saludables</strong>
          <span>+18</span>
        </div>
        <div>
          <strong>Release bloqueado</strong>
          <span>−20</span>
        </div>
        <p>Ningún criterio oculta opciones. La decisión final siempre permanece manual.</p>
      </div>
    </div>
  );
}
