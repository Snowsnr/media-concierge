import { send, vapidPublicKey, type PushError } from 'jsr:@daaku/webpush@0.2.0';
import { adminClient } from './supabase.ts';

type Base64Options = { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean };
type Uint8ArrayWithBase64 = Uint8ArrayConstructor & {
  fromBase64?: (value: string, options?: Base64Options) => Uint8Array;
};
type Base64CapableArray = Uint8Array & {
  toBase64?: (options?: Base64Options) => string;
};

const bytes = Uint8Array as Uint8ArrayWithBase64;
if (!bytes.fromBase64) {
  bytes.fromBase64 = (value, options) => {
    const normalized =
      options?.alphabet === 'base64url' ? value.replaceAll('-', '+').replaceAll('_', '/') : value;
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  };
}
if (!(Uint8Array.prototype as Base64CapableArray).toBase64) {
  (Uint8Array.prototype as Base64CapableArray).toBase64 = function (options) {
    let encoded = btoa(String.fromCharCode(...this));
    if (options?.alphabet === 'base64url') {
      encoded = encoded.replaceAll('+', '-').replaceAll('/', '_');
    }
    return options?.omitPadding ? encoded.replace(/=+$/, '') : encoded;
  };
}

export type NotificationAudience = 'family' | 'admin';
export type NotificationKind =
  'NEW_REQUEST' | 'APPROVED' | 'NEEDS_INFO' | 'READY' | 'REJECTED' | 'FAILED' | 'TEST';

export interface NotificationInput {
  audience: NotificationAudience;
  recipientUserId?: string | null;
  requestId?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  targetUrl: string;
  dedupeKey: string;
}

type DeliveryRow = {
  id: string;
  attempts: number;
  notification_events:
    | { id: string; title: string; body: string; target_url: string; kind: NotificationKind }
    | Array<{
        id: string;
        title: string;
        body: string;
        target_url: string;
        kind: NotificationKind;
      }>;
  push_subscriptions:
    | { id: string; endpoint: string; p256dh: string; auth_secret: string }
    | Array<{ id: string; endpoint: string; p256dh: string; auth_secret: string }>;
};

const privateVapidKey = () => {
  const value = Deno.env.get('VAPID_PRIVATE_JWK');
  if (!value) throw new Error('VAPID_PRIVATE_JWK is not configured.');
  return value;
};

export const getVapidPublicKey = () => vapidPublicKey(privateVapidKey());

const background = (task: Promise<unknown>) => {
  const runtime = (
    globalThis as unknown as { EdgeRuntime?: { waitUntil(value: Promise<unknown>): void } }
  ).EdgeRuntime;
  if (runtime) runtime.waitUntil(task);
  else void task.catch(() => undefined);
};

const eventValue = (row: DeliveryRow) =>
  Array.isArray(row.notification_events) ? row.notification_events[0] : row.notification_events;
const subscriptionValue = (row: DeliveryRow) =>
  Array.isArray(row.push_subscriptions) ? row.push_subscriptions[0] : row.push_subscriptions;

const shortError = (error: unknown) =>
  (error instanceof Error ? error.message : 'Push delivery failed').slice(0, 300);

const deliverOne = async (deliveryId: string) => {
  const admin = adminClient();
  const now = new Date();
  const staleClaim = new Date(now.getTime() - 120_000).toISOString();
  const { data: pending } = await admin
    .from('push_deliveries')
    .select('attempts')
    .eq('id', deliveryId)
    .is('delivered_at', null)
    .is('abandoned_at', null)
    .lte('next_attempt_at', now.toISOString())
    .or(`claimed_at.is.null,claimed_at.lt.${staleClaim}`)
    .maybeSingle();
  if (!pending) return { delivered: false, skipped: true };

  const attempts = Number(pending.attempts) + 1;
  const { data: claimed } = await admin
    .from('push_deliveries')
    .update({ claimed_at: now.toISOString(), attempts })
    .eq('id', deliveryId)
    .eq('attempts', pending.attempts)
    .is('delivered_at', null)
    .is('abandoned_at', null)
    .select(
      'id, attempts, notification_events!inner(id, title, body, target_url, kind), push_subscriptions!inner(id, endpoint, p256dh, auth_secret)',
    )
    .maybeSingle();
  if (!claimed) return { delivered: false, skipped: true };

  const row = claimed as unknown as DeliveryRow;
  const event = eventValue(row);
  const subscription = subscriptionValue(row);
  if (!event || !subscription) return { delivered: false, skipped: true };

  try {
    await send(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
      },
      JSON.stringify({
        title: event.title,
        body: event.body,
        url: event.target_url,
        tag: event.id,
      }),
      {
        vapid: privateVapidKey(),
        subscriber: Deno.env.get('VAPID_SUBJECT') ?? 'https://pedidos.diegohomelab.fyi',
        ttl: 86_400,
        urgency: event.kind === 'READY' || event.kind === 'NEW_REQUEST' ? 'high' : 'normal',
      },
    );
    await admin
      .from('push_deliveries')
      .update({ delivered_at: new Date().toISOString(), claimed_at: null, last_error: null })
      .eq('id', deliveryId);
    return { delivered: true, skipped: false };
  } catch (error) {
    const pushError = error as Partial<PushError>;
    if (pushError.permanent || pushError.statusCode === 404 || pushError.statusCode === 410) {
      await admin.from('push_subscriptions').delete().eq('id', subscription.id);
      return { delivered: false, skipped: false };
    }
    if (attempts >= 5) {
      await admin
        .from('push_deliveries')
        .update({
          abandoned_at: new Date().toISOString(),
          claimed_at: null,
          last_error: shortError(error),
        })
        .eq('id', deliveryId);
    } else {
      const retryAt = new Date(Date.now() + 30_000 * 2 ** (attempts - 1)).toISOString();
      await admin
        .from('push_deliveries')
        .update({ claimed_at: null, next_attempt_at: retryAt, last_error: shortError(error) })
        .eq('id', deliveryId);
    }
    return { delivered: false, skipped: false };
  }
};

export const deliverNotification = async (notificationId: string) => {
  const { data } = await adminClient()
    .from('push_deliveries')
    .select('id')
    .eq('notification_id', notificationId)
    .is('delivered_at', null)
    .is('abandoned_at', null);
  const results = await Promise.all((data ?? []).map((item) => deliverOne(String(item.id))));
  return {
    delivered: results.filter((item) => item.delivered).length,
    attempted: results.filter((item) => !item.skipped).length,
  };
};

export const deliverPendingNotifications = async () => {
  const now = new Date().toISOString();
  const { data } = await adminClient()
    .from('push_deliveries')
    .select('notification_id')
    .is('delivered_at', null)
    .is('abandoned_at', null)
    .lte('next_attempt_at', now)
    .order('created_at')
    .limit(50);
  const ids = [...new Set((data ?? []).map((item) => String(item.notification_id)))];
  const results = await Promise.all(ids.map(deliverNotification));
  return results.reduce(
    (total, result) => ({
      delivered: total.delivered + result.delivered,
      attempted: total.attempted + result.attempted,
    }),
    { delivered: 0, attempted: 0 },
  );
};

export const schedulePendingDelivery = () => background(deliverPendingNotifications());

export const enqueueNotification = async (input: NotificationInput) => {
  const admin = adminClient();
  const row = {
    audience: input.audience,
    recipient_user_id: input.recipientUserId ?? null,
    request_id: input.requestId ?? null,
    kind: input.kind,
    title: input.title.slice(0, 120),
    body: input.body.slice(0, 300),
    target_url: input.targetUrl,
    dedupe_key: input.dedupeKey,
  };
  const { data: inserted, error } = await admin
    .from('notification_events')
    .upsert(row, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();
  if (error) throw error;

  const event =
    inserted ??
    (
      await admin
        .from('notification_events')
        .select('id')
        .eq('dedupe_key', input.dedupeKey)
        .single()
    ).data;
  if (!event) throw new Error('Notification event could not be created.');

  let subscriptions = admin.from('push_subscriptions').select('id').eq('audience', input.audience);
  if (input.audience === 'family') {
    subscriptions = subscriptions.eq('user_id', input.recipientUserId ?? '');
  }
  const { data: targets, error: targetError } = await subscriptions;
  if (targetError) throw targetError;
  if (targets?.length) {
    const { error: deliveryError } = await admin.from('push_deliveries').upsert(
      targets.map((target) => ({
        notification_id: event.id,
        subscription_id: target.id,
      })),
      { onConflict: 'notification_id,subscription_id', ignoreDuplicates: true },
    );
    if (deliveryError) throw deliveryError;
    background(deliverNotification(String(event.id)));
  }
  return String(event.id);
};
