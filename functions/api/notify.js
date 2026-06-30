export async function onRequestPost(context) {
  const RESEND_API_KEY = context.env.RESEND_API_KEY;
  const FROM_EMAIL = context.env.RESEND_FROM_EMAIL || 'InnoTrans 2026 <noreply@trelleborg.one>';

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { recipients, booking, attachments } = payload;
  // recipients: [{ name, email }, ...]
  // booking: { day, time, space, company, topic, attendees }
  // attachments: [{ filename, content }] — content is base64-encoded

  if (!Array.isArray(recipients) || !recipients.length || !booking) {
    return new Response(JSON.stringify({ error: 'Missing recipients or booking details' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const subject = `New meeting booked — ${booking.day}, ${booking.time}`;
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#1a1a1a;">New meeting booked at InnoTrans 2026</h2>
      <p>A meeting has been booked on the Trelleborg stand. A calendar invite (.ics) is attached — add it to your calendar to block the time.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#666;">Day</td><td style="padding:6px 0;font-weight:bold;">${booking.day}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Time</td><td style="padding:6px 0;font-weight:bold;">${booking.time}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Space</td><td style="padding:6px 0;font-weight:bold;">${booking.space}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Company</td><td style="padding:6px 0;">${booking.company||'—'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Topic</td><td style="padding:6px 0;">${booking.topic||'—'}</td></tr>
        <tr><td style="padding:6px 0;color:#666;">Attendees</td><td style="padding:6px 0;">${booking.attendees||'—'}</td></tr>
      </table>
      <p style="color:#888;font-size:13px;">Hall 9, Stand 300 · Messe Berlin · 22–25 Sep 2026</p>
    </div>
  `;

  const results = [];
  for (const r of recipients) {
    if (!r.email) continue;
    try {
      const emailPayload = {
        from: FROM_EMAIL,
        to: [r.email],
        subject,
        html: htmlBody
      };
      if (Array.isArray(attachments) && attachments.length) {
        emailPayload.attachments = attachments.map(a => ({
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
      const data = await res.json().catch(()=>({}));
      results.push({ email: r.email, ok: res.ok, status: res.status, data });
    } catch (e) {
      results.push({ email: r.email, ok: false, error: e.message });
    }
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
