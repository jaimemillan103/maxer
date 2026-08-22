// MAXER Worker — IA (chat) + Push notifications reales
// ─────────────────────────────────────────────────────────────
// Recursos que hay que configurar en el dashboard de Cloudflare:
//   • Variables/Secrets:
//       ANTHROPIC_API_KEY  (Secret)  — clave de Anthropic para el chat IA
//       VAPID_PUBLIC_KEY   (Text)    — clave VAPID pública (la misma que va en app.js)
//       VAPID_PRIVATE_KEY  (Secret)  — clave VAPID privada
//       VAPID_SUBJECT      (Text)    — p.ej. mailto:jaimemillan103@gmail.com
//   • KV namespace vinculado con el nombre de binding:  MAXER_PUSH
//   • Cron Trigger:  */15 * * * *   (cada 15 min)
// ─────────────────────────────────────────────────────────────

export default {
  // ───────── Peticiones HTTP (chat IA + alta/baja de push) ─────────
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    const jsonRes = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    // ── Alta de suscripción push ──
    if (url.pathname === '/subscribe') {
      try {
        const { id, subscription, morning, evening, tzOffset } = await request.json();
        if (!id || !subscription) return jsonRes({ error: 'faltan datos' }, 400);
        const [rh1, rm1] = String(morning || '10:00').split(':').map(Number);
        const [rh2, rm2] = String(evening || '20:00').split(':').map(Number);
        const prev = JSON.parse((await env.MAXER_PUSH.get(id)) || '{}');
        await env.MAXER_PUSH.put(id, JSON.stringify({
          subscription,
          rh1: rh1 || 10, rm1: rm1 || 0, rh2: rh2 || 20, rm2: rm2 || 0,
          tzOffset: tzOffset || 0,
          doneDate: prev.doneDate || null, lastSent1: null, lastSent2: null,
        }));
        return jsonRes({ ok: true });
      } catch (e) {
        return jsonRes({ error: String(e) }, 400);
      }
    }

    // ── El cliente marca "hoy ya hecho" (para no molestar con recordatorios) ──
    if (url.pathname === '/active') {
      try {
        const { id } = await request.json();
        const raw = await env.MAXER_PUSH.get(id);
        if (raw) {
          const rec = JSON.parse(raw);
          const local = new Date(Date.now() - (rec.tzOffset || 0) * 60000);
          rec.doneDate = local.toISOString().slice(0, 10);
          await env.MAXER_PUSH.put(id, JSON.stringify(rec));
        }
        return jsonRes({ ok: true });
      } catch (e) {
        return jsonRes({ error: String(e) }, 400);
      }
    }

    // ── Baja de suscripción push ──
    if (url.pathname === '/unsubscribe') {
      try {
        const { id } = await request.json();
        if (id) await env.MAXER_PUSH.delete(id);
        return jsonRes({ ok: true });
      } catch (e) {
        return jsonRes({ error: String(e) }, 400);
      }
    }

    // ── Envío de prueba inmediato (para verificar sin esperar al cron) ──
    if (url.pathname === '/test') {
      try {
        const { id } = await request.json();
        const raw = await env.MAXER_PUSH.get(id);
        if (!raw) return jsonRes({ error: 'no hay suscripción para ese id' }, 404);
        const rec = JSON.parse(raw);
        const status = await sendWebPush(rec.subscription,
          JSON.stringify({ title: 'MAXER', body: '✅ Notificación de prueba. ¡Funciona!', url: '/' }),
          env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT || 'mailto:test@example.com');
        return jsonRes({ ok: true, status });
      } catch (e) {
        return jsonRes({ error: String(e) }, 500);
      }
    }

    // ── Diagnóstico (para depurar la config) ──
    if (url.pathname === '/debug') {
      const pub = env.VAPID_PUBLIC_KEY || '';
      const priv = env.VAPID_PRIVATE_KEY || '';
      let pubBytes = -1, pubErr = null;
      try { pubBytes = b64urlToBytes(pub).length; } catch (e) { pubErr = String(e); }
      let kvBound = false, subsCount = -1, subKeys = [];
      try { const l = await env.MAXER_PUSH.list(); kvBound = true; subsCount = l.keys.length; subKeys = l.keys.map(k => k.name); }
      catch (e) { kvBound = false; }
      return jsonRes({
        pubLen: pub.length, pubBytes, pubErr,
        privLen: priv.length,
        subject: env.VAPID_SUBJECT || null,
        hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
        kvBound, subsCount, subKeys,
      });
    }

    // ── Chat IA (comportamiento original en la raíz) ──
    return handleAI(request, env, cors);
  },

  // ───────── Cron: recorre las suscripciones y envía a su hora ─────────
  async scheduled(event, env, ctx) {
    const now = Date.now();
    const WIN = 10; // ventana en minutos (el cron corre cada 5)
    const list = await env.MAXER_PUSH.list();
    for (const k of list.keys) {
      try {
        const raw = await env.MAXER_PUSH.get(k.name);
        if (!raw) continue;
        const rec = JSON.parse(raw);
        const local = new Date(now - (rec.tzOffset || 0) * 60000);
        const nmod = local.getUTCHours() * 60 + local.getUTCMinutes();
        const localDate = local.toISOString().slice(0, 10);
        if (rec.doneDate === localDate) continue; // ya hizo su día → no molestar

        const send = async (body) => {
          const st = await sendWebPush(rec.subscription, JSON.stringify({ title: 'MAXER', body, url: '/' }),
            env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT || 'mailto:test@example.com');
          if (st === 404 || st === 410) { await env.MAXER_PUSH.delete(k.name); return false; }
          return true;
        };

        // Aviso de mañana
        const m1 = (rec.rh1 ?? rec.rh ?? 10) * 60 + (rec.rm1 ?? rec.rm ?? 0);
        if (nmod - m1 >= 0 && nmod - m1 < WIN && rec.lastSent1 !== localDate) {
          if (await send('☀️ Buenos días. Aún no has hecho tu día — ¿empezamos? 💪')) {
            rec.lastSent1 = localDate; await env.MAXER_PUSH.put(k.name, JSON.stringify(rec));
          }
          continue;
        }
        // Aviso de tarde (última llamada)
        const m2 = (rec.rh2 ?? 20) * 60 + (rec.rm2 ?? 0);
        if (nmod - m2 >= 0 && nmod - m2 < WIN && rec.lastSent2 !== localDate) {
          if (await send('⏳ Última llamada: haz aunque sea el mínimo y mantén la racha 🔥')) {
            rec.lastSent2 = localDate; await env.MAXER_PUSH.put(k.name, JSON.stringify(rec));
          }
        }
      } catch (e) {
        console.error('cron push error', k.name, e);
      }
    }
  },
};

// ═══════════════ Chat IA ═══════════════
async function handleAI(request, env, cors) {
  try {
    const { context, messages } = await request.json();
    const systemPrompt = `Eres el asistente personal de fitness de MAXER, una app de entrenamiento, rehabilitación y hábitos.
Hablas en español. Eres conciso, práctico y motivador. Nunca escribas más de 250 palabras por respuesta.
Cuando des recomendaciones de entrenamiento incluye series y repeticiones concretas.
Para nutrición usa la fórmula de Mifflin-St Jeor con los datos del usuario.

Información actual del usuario:
${context || 'No hay datos disponibles.'}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages: (messages || []).slice(-10),
      }),
    });
    if (!response.ok) {
      console.error('Anthropic error:', await response.text());
      return new Response(JSON.stringify({ content: 'Error del asistente. Inténtalo de nuevo.' }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const data = await response.json();
    const content = data.content?.[0]?.text || 'Sin respuesta.';
    return new Response(JSON.stringify({ content }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Worker AI error:', e);
    return new Response(JSON.stringify({ content: 'Error interno del Worker.' }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}

// ═══════════════ Web Push (VAPID + cifrado aes128gcm) ═══════════════
function b64urlToBytes(s) {
  s = String(s).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'); // quita espacios/saltos pegados
  const pad = s.length % 4; if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(bytes) {
  const b = new Uint8Array(bytes); let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concatBytes(...arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}
async function vapidJWT(endpoint, subject, vapidPub, vapidPriv) {
  const aud = new URL(endpoint).origin;
  const enc = o => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' +
    enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject });
  const pub = b64urlToBytes(vapidPub); // 65 bytes: 0x04 | X(32) | Y(32)
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: String(vapidPriv).replace(/\s+/g, ''),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + bytesToB64url(new Uint8Array(sig)); // ES256 ya es r||s crudo
}
async function encryptPayload(subscription, payload) {
  const uaPubBytes = b64urlToBytes(subscription.keys.p256dh);   // 65 bytes
  const authSecret = b64urlToBytes(subscription.keys.auth);     // 16 bytes
  const plaintext = new TextEncoder().encode(payload);

  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPub = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey)); // 65 bytes
  const uaPub = await crypto.subtle.importKey('raw', uaPubBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPub }, serverKeys.privateKey, 256));

  // RFC 8291: ikm = HKDF(auth, shared, "WebPush: info\0" | uaPub | serverPub, 32)
  const ikmInfo = concatBytes(new TextEncoder().encode('WebPush: info\0'), uaPubBytes, serverPub);
  const ikm = await hkdf(authSecret, shared, ikmInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const padded = concatBytes(plaintext, new Uint8Array([2])); // delimitador 0x02 (último registro)
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded));

  // cabecera aes128gcm: salt(16) | rs(4 BE) | idlen(1) | keyid(serverPub) | ciphertext
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false);
  return concatBytes(salt, rs, new Uint8Array([serverPub.length]), serverPub, ciphertext);
}
async function sendWebPush(subscription, payload, vapidPub, vapidPriv, subject) {
  const body = await encryptPayload(subscription, payload);
  const jwt = await vapidJWT(subscription.endpoint, subject, vapidPub, vapidPriv);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'normal',
      'Authorization': `vapid t=${jwt}, k=${vapidPub}`,
    },
    body,
  });
  return res.status; // 201 = enviado; 404/410 = suscripción caducada
}
