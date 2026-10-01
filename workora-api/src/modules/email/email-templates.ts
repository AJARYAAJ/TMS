/** Email rendering: one layout, HTML (table-based, inline styles for mail clients) plus plain text. */

export interface NotificationEmail {
  /** Organization name shown above the heading. */
  orgName: string;
  heading: string;
  body?: string;
  actorName?: string | null;
  task?: { key: string; title: string } | null;
  cta: { label: string; url: string };
  /** Why the recipient got this email, e.g. "a task was assigned to you". */
  reason: string;
  unsubscribeUrl?: string | null;
  preferencesUrl: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escAttr = (url: string) => esc(/^https?:\/\//i.test(url) ? url : '#');

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";

export function renderNotificationEmail(m: NotificationEmail) {
  const initial = esc((m.actorName ?? '').match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? 'W');
  const body = m.body?.trim()
    ? `<tr><td style="padding:0 32px 8px"><div style="border-left:3px solid #d8ff3d;background:#f8f6f1;border-radius:0 12px 12px 0;padding:14px 16px;font:15px/1.55 ${FONT};color:#2b2a27">${esc(m.body.trim()).replace(/\n/g, '<br>')}</div></td></tr>`
    : '';
  const task = m.task
    ? `<tr><td style="padding:0 32px 18px"><span style="display:inline-block;font:700 12px ${MONO};background:#121212;color:#d8ff3d;border-radius:7px;padding:3px 8px">${esc(m.task.key)}</span><span style="font:600 15px ${FONT};color:#121212;padding-left:8px">${esc(m.task.title)}</span></td></tr>`
    : '';
  const unsubscribe = m.unsubscribeUrl ? ` · <a href="${escAttr(m.unsubscribeUrl)}" style="color:#4a4843">Unsubscribe from these emails</a>` : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(m.heading)}</title></head>
<body style="margin:0;padding:0;background:#f2efe8">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc((m.body ?? m.heading).slice(0, 140))}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2efe8;padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
      <tr><td style="padding:0 4px 14px">
        <table role="presentation" cellspacing="0" cellpadding="0"><tr>
          <td style="background:#121212;border-radius:10px;width:30px;height:30px;text-align:center;font:800 16px ${FONT};color:#d8ff3d">w</td>
          <td style="padding-left:10px;font:700 15px ${FONT};color:#121212;letter-spacing:-0.01em">Workora</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#ffffff;border-radius:22px;box-shadow:0 12px 32px rgba(18,18,18,.08)">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr><td style="padding:28px 32px 6px;font:700 11px ${FONT};letter-spacing:.12em;text-transform:uppercase;color:#8c897f">${esc(m.orgName)}</td></tr>
          <tr><td style="padding:0 32px 18px">
            <table role="presentation" cellspacing="0" cellpadding="0"><tr>
              <td valign="top" style="padding-right:12px"><div style="width:34px;height:34px;border-radius:50%;background:#5b45ff;color:#fff;font:700 15px/34px ${FONT};text-align:center">${initial}</div></td>
              <td style="font:700 21px/1.3 ${FONT};color:#121212;letter-spacing:-0.015em">${esc(m.heading)}</td>
            </tr></table>
          </td></tr>
          ${task}
          ${body}
          <tr><td style="padding:14px 32px 30px">
            <a href="${escAttr(m.cta.url)}" style="display:inline-block;background:#d8ff3d;color:#121212;font:700 14px ${FONT};text-decoration:none;border-radius:999px;padding:12px 22px">${esc(m.cta.label)} &rarr;</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 8px;font:12px/1.6 ${FONT};color:#8c897f">
        You're receiving this because ${esc(m.reason)}.<br>
        <a href="${escAttr(m.preferencesUrl)}" style="color:#4a4843">Email preferences</a>${unsubscribe}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = [
    `${m.orgName} · Workora`,
    '',
    m.heading,
    m.task ? `${m.task.key} ${m.task.title}` : null,
    m.body?.trim() ? `\n${m.body.trim()}\n` : null,
    `${m.cta.label}: ${m.cta.url}`,
    '',
    '--',
    `You're receiving this because ${m.reason}.`,
    `Email preferences: ${m.preferencesUrl}`,
    m.unsubscribeUrl ? `Unsubscribe: ${m.unsubscribeUrl}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { html, text };
}
