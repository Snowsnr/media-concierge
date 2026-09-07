import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type {
  AppNotification,
  FamilyRequest,
  MediaMetadata,
  NotificationConfig,
  SeriesScope,
} from '@media-concierge/shared';
import { Button, EmptyState, StatusPill } from '@media-concierge/ui';
import { api, type FamilyProfile } from './api';

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
          <Route path="/titulo/:mediaType/:tmdbId" element={<MediaDetail name={name} />} />
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
  const [profile, setProfile] = useState<FamilyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .currentProfile()
      .then(setProfile)
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return (
      <main className="welcome">
        <div className="welcome__content">Preparando tu sesión segura…</div>
      </main>
    );
  if (!profile)
    return (
      <Welcome
        remote={api.remoteEnabled}
        hasInvite={Boolean(api.inviteToken())}
        onRegister={async (displayName, username, password) =>
          setProfile(await api.register(displayName, username, password, api.inviteToken()))
        }
        onLogin={async (username, password) => setProfile(await api.login(username, password))}
      />
    );
  if (!profile.username)
    return (
      <AccountUpgrade
        displayName={profile.displayName}
        onUpgrade={async (username, password) =>
          setProfile(await api.upgradeAccount(username, password))
        }
      />
    );
  return (
    <Shell
      name={profile.displayName}
      onExit={async () => {
        await api.exit();
        setProfile(null);
      }}
    />
  );
}

function Welcome({
  onRegister,
  onLogin,
  remote,
  hasInvite,
}: {
  onRegister: (displayName: string, username: string, password: string) => Promise<void>;
  onLogin: (username: string, password: string) => Promise<void>;
  remote: boolean;
  hasInvite: boolean;
}) {
  const [displayName, setDisplayName] = useState('Ana');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const registering = remote && hasInvite;
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
        <p>
          {registering
            ? 'Crea tu acceso familiar. La invitación sólo se necesita esta primera vez.'
            : 'Inicia sesión para pedir películas y seguirlas hasta Jellyfin.'}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!username.trim() || password.length < 10) return;
            if (registering && password !== confirmation) {
              setError('Las contraseñas no coinciden.');
              return;
            }
            setBusy(true);
            setError('');
            const action = registering
              ? onRegister(displayName.trim(), username, password)
              : onLogin(username, password);
            void action
              .catch((reason: Error) => setError(reason.message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="welcome__fields">
            {registering && (
              <label>
                Nombre visible
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  required
                />
              </label>
            )}
            <label>
              Usuario
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
                autoCapitalize="none"
                autoComplete="username"
                placeholder="ana"
                required
              />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={10}
                maxLength={72}
                autoComplete={registering ? 'new-password' : 'current-password'}
                required
              />
            </label>
            {registering && (
              <label>
                Repite la contraseña
                <input
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  minLength={10}
                  maxLength={72}
                  autoComplete="new-password"
                  required
                />
              </label>
            )}
            <Button type="submit" disabled={busy}>
              {busy
                ? 'Validando…'
                : registering
                  ? 'Crear mi cuenta →'
                  : remote
                    ? 'Iniciar sesión →'
                    : 'Entrar al demo →'}
            </Button>
          </div>
        </form>
        {error && <p className="error-banner">{error}</p>}
        <small>
          {registering
            ? 'Después podrás usar estas credenciales en la web app y otros dispositivos.'
            : '¿Eres nuevo? Pide al administrador un enlace de invitación.'}
        </small>
      </div>
    </main>
  );
}

function AccountUpgrade({
  displayName,
  onUpgrade,
}: {
  displayName: string;
  onUpgrade: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="welcome">
      <div className="welcome__glow" />
      <div className="welcome__content">
        <span className="eyebrow">Hola, {displayName}</span>
        <h1>
          Conserva tus pedidos.
          <br />
          <em>Crea tu acceso permanente.</em>
        </h1>
        <p>Elige las credenciales que usarás en la web app y en cualquier otro dispositivo.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (password !== confirmation) {
              setError('Las contraseñas no coinciden.');
              return;
            }
            setBusy(true);
            setError('');
            void onUpgrade(username, password)
              .catch((reason: Error) => setError(reason.message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="welcome__fields">
            <label>
              Usuario
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
                autoCapitalize="none"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={10}
                maxLength={72}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Repite la contraseña
              <input
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={10}
                maxLength={72}
                autoComplete="new-password"
                required
              />
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? 'Guardando…' : 'Crear acceso permanente →'}
            </Button>
          </div>
        </form>
        {error && <p className="error-banner">{error}</p>}
        <small>Tu historial y solicitudes actuales se conservarán.</small>
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
              <Link
                className="poster-card"
                to={`/titulo/${item.type}/${item.tmdbId}`}
                key={`${item.type}:${item.tmdbId}`}
              >
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
  const { mediaType, tmdbId } = useParams();
  const navigate = useNavigate();
  const [media, setMedia] = useState<MediaMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [note, setNote] = useState('');
  const [scopeKind, setScopeKind] = useState<'season' | 'episode' | 'aired'>('aired');
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    const type = mediaType === 'movie' || mediaType === 'series' ? mediaType : null;
    if (!type || !tmdbId) {
      setLoading(false);
      setLoadError('El enlace de este título no es válido.');
      return () => {
        active = false;
      };
    }
    api
      .getMedia(Number(tmdbId), type)
      .then((item) => {
        if (active) setMedia(item);
      })
      .catch((reason: Error) => {
        if (active) setLoadError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mediaType, tmdbId, retry]);

  if (loading)
    return (
      <div className="page">
        <p>Cargando título…</p>
      </div>
    );

  if (loadError || !media)
    return (
      <div className="page">
        <div className="error-banner detail-load-error">
          <span>{loadError || 'No encontramos ese título.'}</span>
          <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>
            Reintentar
          </Button>
          <Link to="/buscar">← Volver a buscar</Link>
        </div>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!id) return;
    const refresh = () =>
      api
        .getRequest(id, name)
        .then((request) => {
          setItem(request);
          setError('');
        })
        .catch((reason: Error) => setError(reason.message))
        .finally(() => setLoading(false));
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [id, name]);
  if (loading)
    return (
      <div className="page">
        <p>Cargando pedido…</p>
      </div>
    );
  if (error || !item)
    return (
      <div className="page">
        <Link className="back-link" to="/solicitudes">
          ← Mis pedidos
        </Link>
        <EmptyState
          icon="!"
          title="No pudimos cargar el pedido"
          copy={error || 'La solicitud no está disponible.'}
        />
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
  const [config, setConfig] = useState<NotificationConfig>({ enabled: false, publicKey: '' });
  const [items, setItems] = useState<AppNotification[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const supported =
    'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  const refresh = async () => {
    const notifications = await api.notifications();
    setItems(notifications);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const nextConfig = await api.notificationConfig();
        const existing = supported
          ? await (await navigator.serviceWorker.ready).pushManager.getSubscription()
          : null;
        if (existing && nextConfig.enabled && Notification.permission === 'granted') {
          await api.subscribeNotifications(existing.toJSON());
        }
        const notifications = await api.notifications();
        if (active) {
          setConfig(nextConfig);
          setSubscribed(Boolean(existing));
          setItems(notifications);
          void (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.();
        }
      } catch (reason) {
        if (active)
          setMessage(reason instanceof Error ? reason.message : 'No pudimos cargar tus avisos.');
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
      setMessage('Este navegador no admite notificaciones.');
      return;
    }
    if (ios && !standalone) {
      setMessage('En iPhone, primero usa Compartir → Añadir a pantalla de inicio y abre esa app.');
      return;
    }
    if (!config.enabled || !config.publicKey) {
      setMessage('Los avisos push todavía no están disponibles. Tus avisos dentro de la app sí.');
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage('No pasa nada: tus avisos siempre estarán guardados aquí.');
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
      setMessage('Listo. Recibirás solo avisos importantes.');
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
      setMessage('Avisos push desactivados. El historial seguirá disponible aquí.');
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
      setMessage('Prueba enviada. Puede tardar unos segundos.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'No pudimos enviar la prueba.');
    } finally {
      setBusy(false);
    }
  };

  const openNotification = async (item: AppNotification) => {
    if (!item.readAt) {
      await api.markNotificationRead(item.id).catch(() => undefined);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, readAt: new Date().toISOString() } : candidate,
        ),
      );
    }
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
      <div className="notification-actions">
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
      {message && <p className="notice">{message}</p>}
      <small>En iPhone, primero añade esta app a tu pantalla de inicio.</small>
      <section className="notification-list" aria-live="polite">
        <div className="notification-list__heading">
          <h2>Tus avisos</h2>
          {items.some((item) => !item.readAt) && <span>Hay novedades</span>}
        </div>
        {!loading && items.length === 0 && (
          <p className="notification-empty">Todavía no hay avisos.</p>
        )}
        {items.map((item) => (
          <Link
            className={
              item.readAt ? 'notification-item' : 'notification-item notification-item--unread'
            }
            key={item.id}
            to={item.targetUrl}
            onClick={() => void openNotification(item)}
          >
            <span className="notification-item__dot" />
            <div>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
              <time>{formatDate(item.createdAt)}</time>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
