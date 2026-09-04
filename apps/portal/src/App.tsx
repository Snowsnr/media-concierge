import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type { FamilyRequest, MediaMetadata, SeriesScope } from '@media-concierge/shared';
import { Button, EmptyState, StatusPill } from '@media-concierge/ui';
import { api } from './api';

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );

function Shell({ name, onExit }: { name: string; onExit: () => Promise<void> }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/buscar" className="brand" aria-label="Media Concierge">
          <span className="brand__mark">▶</span>
          <span>Media Concierge</span>
        </Link>
        <button className="profile-chip" onClick={() => void onExit()} title="Cerrar sesión">
          <span>{name.slice(0, 1).toUpperCase()}</span>
          {name}
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/buscar" element={<SearchPage name={name} />} />
          <Route path="/titulo/:tmdbId" element={<MediaDetail name={name} />} />
          <Route path="/solicitudes" element={<RequestsPage name={name} />} />
          <Route path="/solicitudes/:id" element={<RequestDetail name={name} />} />
          <Route path="/notificaciones" element={<NotificationsPage />} />
          <Route path="*" element={<Navigate to="/buscar" replace />} />
        </Routes>
      </main>
      <nav className="bottom-nav" aria-label="Navegación principal">
        <NavLink to="/buscar">
          ⌕<span>Buscar</span>
        </NavLink>
        <NavLink to="/solicitudes">
          ☰<span>Mis pedidos</span>
        </NavLink>
        <NavLink to="/notificaciones">
          ♢<span>Avisos</span>
        </NavLink>
      </nav>
    </div>
  );
}

export function App() {
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .currentProfile()
      .then(setName)
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return (
      <main className="welcome">
        <div className="welcome__content">Preparando tu sesión segura…</div>
      </main>
    );
  if (!name)
    return (
      <Welcome
        remote={api.remoteEnabled}
        hasInvite={Boolean(api.inviteToken())}
        onContinue={async (value) => setName(await api.enter(value, api.inviteToken()))}
      />
    );
  return (
    <Shell
      name={name}
      onExit={async () => {
        await api.exit();
        setName('');
      }}
    />
  );
}

function Welcome({
  onContinue,
  remote,
  hasInvite,
}: {
  onContinue: (name: string) => Promise<void>;
  remote: boolean;
  hasInvite: boolean;
}) {
  const [name, setName] = useState('Ana');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="welcome">
      <div className="welcome__glow" />
      <div className="welcome__content">
        <span className="eyebrow">Tu próxima noche de cine</span>
        <h1>
          Pide. Relájate.
          <br />
          <em>Nosotros seguimos la función.</em>
        </h1>
        <p>Busca una peli o serie y sigue su camino hasta que esté lista en Jellyfin.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            setError('');
            void onContinue(name.trim())
              .catch((reason: Error) => setError(reason.message))
              .finally(() => setBusy(false));
          }}
        >
          <label htmlFor="name">¿Cómo te llamas?</label>
          <div className="welcome__form-row">
            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Validando…' : remote ? 'Canjear invitación →' : 'Entrar al demo →'}
            </Button>
          </div>
        </form>
        {error && <p className="error-banner">{error}</p>}
        <small>
          {remote
            ? hasInvite
              ? 'Invitación detectada · se eliminará del navegador después de canjearla.'
              : 'Necesitas abrir tu enlace de invitación personal.'
            : 'Acceso simulado · configura Supabase para activar invitaciones reales.'}
        </small>
      </div>
    </main>
  );
}

function SearchPage({ name }: { name: string }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MediaMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      api
        .search(query)
        .then(setItems)
        .catch((reason: Error) => setError(reason.message))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="page page--wide">
      <section className="hero">
        <span className="eyebrow">Hola, {name} ✦</span>
        <h1>¿Qué quieres ver?</h1>
        <p>Busca en español o inglés. Nosotros encontramos el título correcto.</p>
        <label className="search-box">
          <span>⌕</span>
          <input
            autoFocus
            placeholder="Duna, Alien, The Last of Us…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </section>
      <section className="catalog-section">
        <div className="section-heading">
          <h2>{query ? 'Resultados' : 'En cartelera del demo'}</h2>
          <span>{items.length} títulos</span>
        </div>
        {error && <p className="error-banner">{error}</p>}
        {loading ? (
          <div className="loading-grid">Buscando títulos…</div>
        ) : (
          <div className="poster-grid">
            {items.map((item) => (
              <Link className="poster-card" to={`/titulo/${item.tmdbId}`} key={item.tmdbId}>
                <div className="poster-card__image">
                  <img
                    src={item.posterUrl}
                    alt={`Póster de ${item.localizedTitle}`}
                    loading="lazy"
                  />
                  <span>{item.type === 'movie' ? 'PELÍCULA' : 'SERIE'}</span>
                </div>
                <h3>{item.localizedTitle}</h3>
                <p>
                  {item.originalTitle !== item.localizedTitle ? `${item.originalTitle} · ` : ''}
                  {item.year}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MediaDetail({ name }: { name: string }) {
  const { tmdbId } = useParams();
  const navigate = useNavigate();
  const [media, setMedia] = useState<MediaMetadata | null>(null);
  const [note, setNote] = useState('');
  const [scopeKind, setScopeKind] = useState<'season' | 'episode' | 'aired'>('aired');
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .search('')
      .then((items) => setMedia(items.find((item) => item.tmdbId === Number(tmdbId)) ?? null));
  }, [tmdbId]);

  if (!media)
    return (
      <div className="page">
        <p>Cargando título…</p>
      </div>
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    let scope: SeriesScope | null = null;
    if (media.type === 'series') {
      scope =
        scopeKind === 'aired'
          ? { kind: 'aired' }
          : scopeKind === 'season'
            ? { kind: 'season', seasonNumber: season }
            : { kind: 'episode', seasonNumber: season, episodeNumber: episode };
    }
    try {
      const created = await api.createRequest({
        media,
        requesterName: name,
        note,
        scope,
        idempotencyKey: crypto.randomUUID(),
      });
      navigate(`/solicitudes/${created.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="detail-page">
      <div className="detail-backdrop" style={{ backgroundImage: `url(${media.posterUrl})` }} />
      <div className="detail-content">
        <Link className="back-link" to="/buscar">
          ← Volver
        </Link>
        <div className="detail-layout">
          <img className="detail-poster" src={media.posterUrl} alt="" />
          <div className="detail-copy">
            <span className="eyebrow">
              {media.type === 'movie' ? 'Película' : 'Serie'} · {media.year}
            </span>
            <h1>{media.localizedTitle}</h1>
            {media.originalTitle !== media.localizedTitle && <h2>{media.originalTitle}</h2>}
            <p>{media.overview}</p>
            <form className="request-form" onSubmit={submit}>
              {media.type === 'series' && (
                <fieldset>
                  <legend>¿Qué quieres pedir?</legend>
                  <div className="choice-row">
                    <label>
                      <input
                        type="radio"
                        checked={scopeKind === 'aired'}
                        onChange={() => setScopeKind('aired')}
                      />{' '}
                      Todo lo emitido
                    </label>
                    <label>
                      <input
                        type="radio"
                        checked={scopeKind === 'season'}
                        onChange={() => setScopeKind('season')}
                      />{' '}
                      Temporada
                    </label>
                    <label>
                      <input
                        type="radio"
                        checked={scopeKind === 'episode'}
                        onChange={() => setScopeKind('episode')}
                      />{' '}
                      Episodio
                    </label>
                  </div>
                  {scopeKind !== 'aired' && (
                    <div className="number-row">
                      <label>
                        Temporada{' '}
                        <input
                          type="number"
                          min="0"
                          value={season}
                          onChange={(event) => setSeason(Number(event.target.value))}
                        />
                      </label>
                      {scopeKind === 'episode' && (
                        <label>
                          Episodio{' '}
                          <input
                            type="number"
                            min="1"
                            value={episode}
                            onChange={(event) => setEpisode(Number(event.target.value))}
                          />
                        </label>
                      )}
                    </div>
                  )}
                </fieldset>
              )}
              <label>
                Nota opcional
                <textarea
                  placeholder="Por ejemplo: para el viernes…"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                />
              </label>
              {error && <p className="error-banner">{error}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Enviando…' : 'Pedir este título'}
              </Button>
              <small>
                Enviar una solicitud no inicia una descarga. El administrador siempre la revisa.
              </small>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function RequestsPage({ name }: { name: string }) {
  const [items, setItems] = useState<FamilyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const refresh = () =>
      api
        .listRequests(name)
        .then(setItems)
        .finally(() => setLoading(false));
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [name]);
  return (
    <div className="page">
      <div className="page-heading">
        <span className="eyebrow">Tu historial</span>
        <h1>Mis pedidos</h1>
        <p>Todo claro, sin tecnicismos. Como debe ser.</p>
      </div>
      {loading ? (
        <p>Cargando…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🎞"
          title="Todavía no hay pedidos"
          copy="Busca una película o serie y aparecerá aquí."
        />
      ) : (
        <div className="request-list">
          {items.map((item) => (
            <Link to={`/solicitudes/${item.id}`} className="request-row" key={item.id}>
              <img src={item.media.posterUrl} alt="" />
              <div>
                <h2>{item.media.localizedTitle}</h2>
                <p>
                  {item.media.year} · Pedido {formatDate(item.createdAt)}
                </p>
              </div>
              <StatusPill status={item.publicStatus} />
              <span className="chevron">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestDetail({ name }: { name: string }) {
  const { id } = useParams();
  const [item, setItem] = useState<FamilyRequest | null>(null);
  useEffect(() => {
    if (!id) return;
    const refresh = () => api.getRequest(id, name).then(setItem);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [id, name]);
  if (!item)
    return (
      <div className="page">
        <p>Cargando pedido…</p>
      </div>
    );
  return (
    <div className="page">
      <Link className="back-link" to="/solicitudes">
        ← Mis pedidos
      </Link>
      <div className="request-detail-card">
        <img src={item.media.posterUrl} alt="" />
        <div>
          <StatusPill status={item.publicStatus} />
          <h1>{item.media.localizedTitle}</h1>
          <p>
            {item.media.originalTitle} · {item.media.year}
          </p>
          {item.note && <blockquote>“{item.note}”</blockquote>}
        </div>
      </div>
      {item.publicEpisodes.length > 0 && (
        <section className="family-episodes">
          <div className="section-heading">
            <h2>Episodios</h2>
            <span>
              {
                item.publicEpisodes.filter((episode) =>
                  ['READY', 'READY_WITHOUT_SUBTITLES'].includes(episode.status),
                ).length
              }{' '}
              listos
            </span>
          </div>
          <div className="family-episode-grid">
            {item.publicEpisodes.map((episode) => (
              <div
                className={`family-episode family-episode--${episode.status.toLowerCase()}`}
                key={episode.id}
              >
                <strong>
                  S{String(episode.seasonNumber).padStart(2, '0')}E
                  {String(episode.episodeNumber).padStart(2, '0')}
                </strong>
                <span>{familyEpisodeLabel(episode.status, episode.progress)}</span>
                {episode.status === 'PREPARING' && episode.progress > 0 && (
                  <div className="mini-progress">
                    <span style={{ width: `${episode.progress}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="timeline-section">
        <h2>Así va tu pedido</h2>
        <div className="timeline">
          {[...item.history].reverse().map((entry, index) => (
            <div className="timeline-item" key={entry.id}>
              <span
                className={index === 0 ? 'timeline-dot timeline-dot--active' : 'timeline-dot'}
              />{' '}
              <div>
                <strong>{entry.note}</strong>
                <p>{formatDate(entry.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function familyEpisodeLabel(
  state: FamilyRequest['publicEpisodes'][number]['status'],
  progress: number,
) {
  const labels: Record<typeof state, string> = {
    UPCOMING: 'Aún no emitido',
    PREPARING: progress > 0 ? `Preparando · ${progress}%` : 'En preparación',
    READY: 'Disponible',
    READY_WITHOUT_SUBTITLES: 'Disponible sin subtítulos',
    ATTENTION: 'Necesita atención',
  };
  return labels[state];
}

function NotificationsPage() {
  const [message, setMessage] = useState('');
  const enable = async () => {
    if (!('Notification' in window)) {
      setMessage('Este navegador no admite notificaciones.');
      return;
    }
    const permission = await Notification.requestPermission();
    setMessage(
      permission === 'granted'
        ? 'Listo. En producción recibirás solo avisos importantes.'
        : 'No pasa nada: tus estados siempre estarán en Mis pedidos.',
    );
  };
  return (
    <div className="page notification-page">
      <div className="notification-illustration">
        ✦<span>🍿</span>✦
      </div>
      <span className="eyebrow">Sin spam, promise</span>
      <h1>Entérate cuando esté lista</h1>
      <p>
        Te avisaremos cuando tu solicitud sea aprobada, necesite información o ya esté disponible.
      </p>
      <Button onClick={enable}>Activar notificaciones</Button>
      {message && <p className="notice">{message}</p>}
      <small>En iPhone, primero añade esta app a tu pantalla de inicio.</small>
    </div>
  );
}
