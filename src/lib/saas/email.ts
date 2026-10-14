import "server-only";
import type { EmailConfig } from "./config";

export type MailPurpose = "verify-email" | "reset-password" | "invitation";
export type Mail = { to: string; purpose: MailPurpose; url: string; expiresAt?: Date };
export type Mailer = (mail: Mail) => Promise<void>;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const TEMPLATES: Record<MailPurpose, { subject: string; intro: string; action: string; note: string }> = {
  "verify-email": {
    subject: "Verify your SEO Health Monitor email",
    intro: "Confirm this email address to finish creating your SEO Health Monitor beta account.",
    action: "Verify email",
    note: "This link expires in 1 hour. If you did not register, ignore this email.",
  },
  "reset-password": {
    subject: "Reset your SEO Health Monitor password",
    intro: "Someone asked to reset the password for this account. Signing in with the new password will sign out your other sessions.",
    action: "Choose a new password",
    note: "This link expires in 30 minutes and can be used once. If you did not ask for it, ignore this email.",
  },
  invitation: {
    subject: "Your SEO Health Monitor beta invitation",
    intro: "You have been invited to the private SEO Health Monitor beta.",
    action: "Create your account",
    note: "This invitation is personal to this email address and can be used once.",
  },
};

export function renderMail(mail: Mail) {
  const t = TEMPLATES[mail.purpose];
  const expiry = mail.expiresAt ? ` It expires on ${mail.expiresAt.toUTCString()}.` : "";
  const text = `${t.intro}\n\n${t.action}: ${mail.url}\n\n${t.note}${expiry}\n\nSEO Health Monitor`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.5;color:#1f2937">
<p>${escape(t.intro)}</p>
<p><a href="${escape(mail.url)}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#0f766e;color:#fff;text-decoration:none">${escape(t.action)}</a></p>
<p style="font-size:13px;color:#6b7280">${escape(t.note + expiry)}<br>If the button does not work, paste this address into your browser:<br>${escape(mail.url)}</p>
</div>`;
  return { subject: t.subject, text, html };
}

function allowed(allowlist: string[], to: string) {
  if (!allowlist.length) return true;
  const address = to.toLowerCase();
  return allowlist.some((entry) => (entry.startsWith("@") ? address.endsWith(entry) : address === entry));
}

/** Delivery errors never include addresses, tokens or provider response bodies. */
export function createMailer(config: EmailConfig, fetchImpl: typeof fetch = fetch): Mailer {
  return async (mail) => {
    // Staging guard: synthetic recipients only, so a misconfigured staging cannot email real people.
    if (!allowed(config.allowlist, mail.to)) {
      console.warn(`[beta-mail] suppressed ${mail.purpose} email: recipient not in EMAIL_RECIPIENT_ALLOWLIST`);
      return;
    }
    if (config.transport === "log") {
      // Development only (refused in production by readBetaConfig).
      console.info(`[beta-mail] ${mail.purpose} for ${mail.to}: ${mail.url}`);
      return;
    }
    const { subject, text, html } = renderMail(mail);
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [mail.to], subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Email delivery failed (${response.status}).`);
  };
}
