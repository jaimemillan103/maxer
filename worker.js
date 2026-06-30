// MAXER AI Worker — Cloudflare Workers
// Despliegue: https://dash.cloudflare.com → Workers → Create Worker → pegar este código
// Añadir secreto: Settings → Variables → ANTHROPIC_API_KEY = sk-ant-...
// La URL del Worker resultante va en MAXER → Ajustes → URL del Worker

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

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
          messages: messages.slice(-10),
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error('Anthropic error:', err);
        return new Response(
          JSON.stringify({ content: 'Error del asistente. Inténtalo de nuevo.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const data = await response.json();
      const content = data.content?.[0]?.text || 'Sin respuesta.';

      return new Response(JSON.stringify({ content }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      console.error('Worker error:', e);
      return new Response(
        JSON.stringify({ content: 'Error interno del Worker.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  },
};
