/**
 * Email sender via Resend (HTTP API - works from any host, sends to any recipient).
 */

async function sendEmail({ to, subject, html, toName }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.error('[mailer] RESEND_API_KEY not set');
    throw new Error('Email service not configured');
  }

  const senderEmail = process.env.RESEND_SENDER_EMAIL || 'onboarding@resend.dev';
  const senderName = process.env.RESEND_SENDER_NAME || 'Continental Federal Bank';

  const payload = {
    from: `${senderName} <${senderEmail}>`,
    to: [to],
    subject,
    html,
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[mailer] Resend error:', res.status, errText);
    throw new Error(`Resend error: ${res.status}`);
  }

  return res.json();
}

async function sendOtpEmail(to, code, fullName) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #f4f6fa; padding: 30px;">
      <div style="background: #0f2b5b; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #fff; margin: 0; font-size: 20px; letter-spacing: 1px;">CONTINENTAL FEDERAL</h1>
        <p style="color: #c9a227; margin: 4px 0 0; font-size: 11px; letter-spacing: 3px;">BANK &amp; TRUST</p>
      </div>
      <div style="background: #fff; padding: 30px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #0f2b5b; font-size: 18px; margin-top: 0;">Verification Code</h2>
        <p style="color: #444; font-size: 14px; line-height: 1.6;">Hello ${fullName || 'Customer'},</p>
        <p style="color: #444; font-size: 14px; line-height: 1.6;">
          Use the code below to complete your sign-in. It expires in 5 minutes.
        </p>
        <div style="background: #f4f6fa; border: 1px dashed #c9a227; padding: 20px; text-align: center; margin: 24px 0; border-radius: 8px;">
          <p style="font-size: 11px; letter-spacing: 3px; color: #666; margin: 0 0 8px;">YOUR CODE</p>
          <p style="font-size: 36px; letter-spacing: 12px; font-family: monospace; color: #0f2b5b; margin: 0; font-weight: bold;">${code}</p>
        </div>
        <p style="color: #666; font-size: 13px;">
          If you did not attempt to sign in, contact us at 1-800-CFB-BANK.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="color: #999; font-size: 11px; text-align: center; margin: 0;">
          Continental Federal Bank &amp; Trust &middot; Member FDIC &middot; Equal Housing Lender
        </p>
      </div>
    </div>
  `;

  return sendEmail({ to, subject: 'Your Continental Federal verification code', html });
}

module.exports = { sendEmail, sendOtpEmail };