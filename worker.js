// MAXER AI Worker — Cloudflare Workers
// Despliegue: https://dash.cloudflare.com → Workers → Create Worker → pegar este código
// Secretos (Worker → Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY = sk-ant-...     (tu clave de Anthropic — Secret)
//   APP_TOKEN         = <contraseña larga al azar>   (Secret; DEBE coincidir con MAXER → Ajustes → Token)
//   ALLOWED_ORIGINS   = https://tu-app.pages.dev     (opcional; orígenes permitidos separados por comas)
// La URL del Worker y el mismo APP_TOKEN van en MAXER → Ajustes → Asistente IA.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Sin allowlist configurada → refleja el origen (compatibilidad). Con allowlist → solo los permitidos.
  const allowOrigin = allowed.length === 0 ? (origin || '*') : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

    // El Worker no atiende a nadie sin token configurado: cierra el proxy abierto a tu cuenta de pago.
    if (!env.APP_TOKEN) {
      return json({ content: 'Worker mal configurado: falta el secreto APP_TOKEN.' }, 500, cors);
    }
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== env.APP_TOKEN) {
      return json({ content: 'No autorizado. Revisa el Token en Ajustes.' }, 401, cors);
    }

    try {
      const { context, messages } = await request.json();
      if (!Array.isArray(messages) || messages.length === 0) {
        return json({ content: 'Petición inválida.' }, 400, cors);
      }

      const systemPrompt = `Eres el asistente personal de fitness de MAXER, una app de entrenamiento, rehabilitación y hábitos.
Hablas en español. Eres conciso, práctico y motivador. Nunca escribas más de 250 palabras por respuesta.
Cuando des recomendaciones de entrenamiento incluye series y repeticiones concretas.
Para nutrición usa la fórmula de Mifflin-St Jeor con los datos del usuario.

Información actual del usuario:
${context || 'No hay datos disponibles.'}`;

      const response = await fetch(ANTHROPIC_URL, {
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
          messages: messages.slice(-10),
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error('Anthropic error:', err);
        return json({ content: 'Error del asistente. Inténtalo de nuevo.' }, 200, cors);
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || 'Sin respuesta.';

      return json({ content }, 200, cors);
    } catch (e) {
      console.error('Worker error:', e);
      return json({ content: 'Error interno del Worker.' }, 200, cors);
    }
  },
};
