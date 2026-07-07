const ALLOWED_ORIGINS = new Set([
  'https://book.trelleborg.one',
  'https://trelleborg.one'
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : ALLOWED_ORIGINS.values().next().value;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
    'Vary': 'Origin'
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  const providedSecret = request.headers.get('X-App-Secret') || '';
  if (!env.APP_SECRET || providedSecret !== env.APP_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...headers }
    });
  }

  const RESEND_API_KEY = env.RESEND_API_KEY;
  const FROM_EMAIL = env.RESEND_FROM_EMAIL || 'InnoTrans 2026 <noreply@trelleborg.one>';

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...headers }
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...headers }
    });
  }

  const { recipients, booking, attachments } = payload;

  if (!Array.isArray(recipients) || !recipients.length || !booking) {
    return new Response(JSON.stringify({ error: 'Missing recipients or booking details' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...headers }
    });
  }

  // Cap recipients and attachment size to prevent abuse even by an authorised but compromised client
  if (recipients.length > 10) {
    return new Response(JSON.stringify({ error: 'Too many recipients' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...headers }
    });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validRecipients = recipients.filter(r => r.email && emailPattern.test(r.email));
  if (!validRecipients.length) {
    return new Response(JSON.stringify({ error: 'No valid recipient emails' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...headers }
    });
  }

  const escapeHtml = (str) => String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const subject = `New meeting booked, ${escapeHtml(booking.day)}, ${escapeHtml(booking.time)}`;
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#1a1a1a;">New meeting booked at InnoTrans 2026</h2>
      <p>A meeting has been booked on the Trelleborg stand. A calendar invite (.ics) is attached, add it to your calendar to block the time.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#666;">Day</td><td style="padding:6px 0;font-weight:bold;">${escapeHtml(booking.day)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Time</td><td style="padding:6px 0;font-weight:bold;">${escapeHtml(booking.time)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Space</td><td style="padding:6px 0;font-weight:bold;">${escapeHtml(booking.space)}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Company</td><td style="padding:6px 0;">${escapeHtml(booking.company) || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Topic</td><td style="padding:6px 0;">${escapeHtml(booking.topic) || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Attendees</td><td style="padding:6px 0;">${escapeHtml(booking.attendees) || '—'}</td></tr>
      </table>
      <p style="color:#888;font-size:13px;">Hall 9, Stand 300, Messe Berlin, 22 to 25 Sep 2026</p>
    </div>
  `;

  const results = [];
  for (const r of validRecipients) {
    try {
      const emailPayload = {
        from: FROM_EMAIL,
        to: [r.email],
        subject,
        html: htmlBody
      };
      if (Array.isArray(attachments) && attachments.length) {
        emailPayload.attachments = attachments.slice(0, 3).map(a => ({
          filename: a.filename || 'meeting.ics',
          content: a.content
        }));
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify(emailPayload)
      });
      const data = await res.json().catch(() => ({}));
      results.push({ email: r.email, ok: res.ok, status: res.status, data });
    } catch (e) {
      results.push({ email: r.email, ok: false, error: e.message });
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
