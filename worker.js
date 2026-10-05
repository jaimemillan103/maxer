// MAXER Worker — IA (chat) + Push notifications reales
// ─────────────────────────────────────────────────────────────
// Recursos que hay que configurar en el dashboard de Cloudflare:
//   • Variables/Secrets:
//       ANTHROPIC_API_KEY  (Secret)  — clave de Anthropic para el chat IA
//       VAPID_PUBLIC_KEY   (Text)    — clave VAPID pública (la misma que va en app.js)
//       VAPID_PRIVATE_KEY  (Secret)  — clave VAPID privada
//       VAPID_SUBJECT      (Text)    — p.ej. mailto:jaimemillan103@gmail.com
//   • KV namespace vinculado con el nombre de binding:  MAXER_PUSH
//   • Cron Trigger:  */15 * * * *   (cada 15 min; la ventana WIN de abajo es de 15 para no perder ninguna hora)
// Seguridad (oct 2026): cada petición lleva el ID token de Firebase del usuario (campo idToken del cuerpo); el Worker
// lo verifica con las claves públicas de Google y solo actúa sobre la suscripción de ESE usuario. Sin /debug.
// ─────────────────────────────────────────────────────────────

export default {
  // ───────── Peticiones HTTP (chat IA + alta/baja de push) ─────────
  async fetch(request, env) {
    // CORS solo para la propia app (Cloudflare Pages / dominio de Maxer / pruebas en local)
    const origin = request.headers.get('Origin') || '';
    let host = ''; try { host = new URL(origin).hostname; } catch (e) {}
    const permitido = /\.pages\.dev$/.test(host) || /maxer/i.test(host) || host === 'localhost';
    const cors = {
      'Access-Control-Allow-Origin': permitido ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

    const url = new URL(request.url);
    const jsonRes = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    let body = {};
    try { const txt = await request.text(); if (txt.length > 200000) return jsonRes({ error: 'demasiado grande' }, 413); body = txt ? JSON.parse(txt) : {}; }
    catch (e) { return jsonRes({ error: 'JSON no válido' }, 400); }
    const uid = await verificarToken(body.idToken);
    if (!uid) return jsonRes({ error: 'Inicia sesión en Maxer para usar esto.' }, 401);
    const miId = 'u_' + uid;   // la suscripción de cada usuario es la de su cuenta, no la que diga el cuerpo

    // ── Alta de suscripción push ──
    if (url.pathname === '/subscribe') {
      try {
        const { subscription, morning, evening, tzOffset, timeZone } = body; const id = miId;
        if (!subscription || !subscription.endpoint) return jsonRes({ error: 'faltan datos' }, 400);
        const [rh1, rm1] = String(morning || '10:00').split(':').map(Number);
        const [rh2, rm2] = String(evening || '20:00').split(':').map(Number);
        const prev = JSON.parse((await env.MAXER_PUSH.get(id)) || '{}');
        await env.MAXER_PUSH.put(id, JSON.stringify({
          subscription,
          rh1: rh1 || 10, rm1: rm1 || 0, rh2: rh2 || 20, rm2: rm2 || 0,
          tzOffset: tzOffset || 0, timeZone: typeof timeZone === 'string' ? timeZone.slice(0, 60) : null,
          snapshot: prev.snapshot || null, lastSent1: null, lastSent2: null,
        }));
        return jsonRes({ ok: true });
      } catch (e) {
        return jsonRes({ error: String(e) }, 400);
      }
    }

    // ── El cliente sincroniza qué mínimos faltan hoy (para los avisos) ──
    if (url.pathname === '/status' || url.pathname === '/active') {
      try {
        const { date, pending, active } = body; const id = miId;
        const raw = await env.MAXER_PUSH.get(id);
        if (raw) {
          const rec = JSON.parse(raw);
          rec.snapshot = { date: date || null, pending: (pending || []).slice(0, 20).map(String), active: (active || []).slice(0, 20).map(String) };
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
        await env.MAXER_PUSH.delete(miId);
        return jsonRes({ ok: true });
      } catch (e) {
        return jsonRes({ error: String(e) }, 400);
      }
    }

    // ── Envío de prueba inmediato (para verificar sin esperar al cron) ──
    if (url.pathname === '/test') {
      try {
        const raw = await env.MAXER_PUSH.get(miId);
        if (!raw) return jsonRes({ error: 'no hay suscripción para este usuario' }, 404);
        const rec = JSON.parse(raw);
        const status = await sendWebPush(rec.subscription,
          JSON.stringify({ title: 'MAXER', body: '✅ Notificación de prueba. ¡Funciona!', url: '/' }),
          env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT || 'mailto:test@example.com');
        return jsonRes({ ok: true, status });
      } catch (e) {
        return jsonRes({ error: String(e) }, 500);
      }
    }

    // ── Chat IA (comportamiento original en la raíz) ──
    return handleAI(body, env, cors);
  },

  // ───────── Cron: recorre las suscripciones y envía a su hora ─────────
  async scheduled(event, env, ctx) {
    const now = Date.now();
    const WIN = 15; // ventana en minutos = intervalo del cron (*/15): así ninguna hora se queda sin aviso
    const list = await env.MAXER_PUSH.list();
    for (const k of list.keys) {
      try {
        const raw = await env.MAXER_PUSH.get(k.name);
        if (!raw) continue;
        const rec = JSON.parse(raw);
        const { nmod, localDate } = horaLocal(now, rec);   // con la zona horaria real: el cambio de hora ya no adelanta los avisos

        // ¿Qué mínimos faltan hoy? Usa el snapshot del cliente; si es de otro día, asume todos los activos.
        const snap = rec.snapshot || {};
        const pending = (snap.date === localDate) ? (snap.pending || []) : (snap.active || []);
        if (!pending.length) continue; // nada pendiente → no molestar
        const listStr = pending.slice(0, 4).join(', ') + (pending.length > 4 ? ` y ${pending.length - 4} más` : '');

        const send = async (body) => {
          const st = await sendWebPush(rec.subscription, JSON.stringify({ title: 'MAXER', body, url: '/' }),
            env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT || 'mailto:test@example.com');
          if (st === 404 || st === 410) { await env.MAXER_PUSH.delete(k.name); return false; }
          return true;
        };

        // Aviso de mañana
        const m1 = (rec.rh1 ?? rec.rh ?? 10) * 60 + (rec.rm1 ?? rec.rm ?? 0);
        if (nmod - m1 >= 0 && nmod - m1 < WIN && rec.lastSent1 !== localDate) {
          if (await send(`☀️ Buenos días. Te faltan por marcar: ${listStr}`)) {
            rec.lastSent1 = localDate; await env.MAXER_PUSH.put(k.name, JSON.stringify(rec));
          }
          continue;
        }
        // Aviso de tarde (última llamada)
        const m2 = (rec.rh2 ?? 20) * 60 + (rec.rm2 ?? 0);
        if (nmod - m2 >= 0 && nmod - m2 < WIN && rec.lastSent2 !== localDate) {
          if (await send(`⏳ Última llamada. Aún te faltan: ${listStr} 🔥`)) {
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
async function handleAI(body, env, cors) {
  try {
    const context = String(body.context || '').slice(0, 8000);
    const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-20)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }));
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

// ═══════════════ Hora local del usuario ═══════════════
function horaLocal(now, rec) {
  if (rec.timeZone) {
    try {
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: rec.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      const p = Object.fromEntries(f.formatToParts(new Date(now)).map(x => [x.type, x.value]));
      return { nmod: (Number(p.hour) % 24) * 60 + Number(p.minute), localDate: `${p.year}-${p.month}-${p.day}` };
    } catch (e) {}
  }
  const local = new Date(now - (rec.tzOffset || 0) * 60000);
  return { nmod: local.getUTCHours() * 60 + local.getUTCMinutes(), localDate: local.toISOString().slice(0, 10) };
}

// ═══════════════ Verificación del ID token de Firebase (sin librerías) ═══════════════
const PROYECTO = 'focus-to-do-millan';
let jwkCache = { claves: null, hasta: 0 };
async function clavesGoogle() {
  if (jwkCache.claves && Date.now() < jwkCache.hasta) return jwkCache.claves;
  const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const j = await r.json();
  const edad = Number((r.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwkCache = { claves: j.keys || [], hasta: Date.now() + edad * 1000 };
  return jwkCache.claves;
}
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function verificarToken(token) {
  try {
    if (typeof token !== 'string' || token.split('.').length !== 3) return null;
    const [h, p, firma] = token.split('.');
    const cab = JSON.parse(new TextDecoder().decode(b64u(h))), dat = JSON.parse(new TextDecoder().decode(b64u(p)));
    const ahora = Math.floor(Date.now() / 1000);
    if (cab.alg !== 'RS256' || dat.aud !== PROYECTO || dat.iss !== 'https://securetoken.google.com/' + PROYECTO || !dat.sub || dat.exp < ahora || dat.iat > ahora + 300) return null;
    const jwk = (await clavesGoogle()).find(k => k.kid === cab.kid); if (!jwk) return null;
    const clave = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', clave, b64u(firma), new TextEncoder().encode(h + '.' + p));
    return ok ? dat.sub : null;
  } catch (e) { return null; }
}
