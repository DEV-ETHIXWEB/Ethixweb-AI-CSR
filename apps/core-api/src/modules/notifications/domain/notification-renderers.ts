import type { NotificationPayload } from "./notification-payload";

const SMS_HARD_LIMIT = 1600;

/** docs/07 §3's consolidated template, rendered per channel. Plain-text variant — used for SMS (length-aware) and as the base for every other renderer. */
function renderPlainText(payload: NotificationPayload): string {
  const lines = [
    `🔧 New Lead — ${payload.priority.toUpperCase()}`,
    "",
    `Customer: ${payload.customerName}`,
    `Phone: ${payload.customerPhone}`,
    `Address: ${payload.address}`,
    `Problem: ${payload.problemSummary}`,
    `Priority: ${payload.priority}`,
    `Type: ${payload.leadType}`,
  ];
  if (payload.transcriptLink) {
    lines.push("", `Call Transcript: ${payload.transcriptLink}`);
  }
  lines.push("", "Reply CLAIM to take this lead.");
  return lines.join("\n");
}

/** SMS/1600-char aware (docs/07 §3) — truncates the problem summary first (the one genuinely variable-length field) rather than dropping structured fields the technician needs to act. */
export function renderSms(payload: NotificationPayload): string {
  const full = renderPlainText(payload);
  if (full.length <= SMS_HARD_LIMIT) {
    return full;
  }
  const overflow = full.length - SMS_HARD_LIMIT;
  const truncatedSummary = payload.problemSummary.slice(
    0,
    Math.max(0, payload.problemSummary.length - overflow - 1),
  );
  return renderPlainText({ ...payload, problemSummary: `${truncatedSummary}…` });
}

export interface EmailContent {
  subject: string;
  html: string;
}

export function renderEmail(payload: NotificationPayload): EmailContent {
  const rows = [
    ["Customer", payload.customerName],
    ["Phone", payload.customerPhone],
    ["Address", payload.address],
    ["Problem", payload.problemSummary],
    ["Priority", payload.priority],
    ["Type", payload.leadType],
  ];
  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td><strong>${escapeHtml(label ?? "")}</strong></td><td>${escapeHtml(value ?? "")}</td></tr>`,
    )
    .join("");
  const transcriptRow = payload.transcriptLink
    ? `<p><a href="${escapeHtml(payload.transcriptLink)}">Call Transcript</a></p>`
    : "";
  return {
    subject: `New Lead — ${payload.priority.toUpperCase()}`,
    html: `<table>${tableRows}</table>${transcriptRow}<p>Reply CLAIM to take this lead.</p>`,
  };
}

export interface WebhookBlockMessage {
  text: string;
}

/** Slack/Teams incoming-webhook payload shape — both accept a simple `{ text }` body for a plain-text block message; richer block-kit formatting is a future enhancement, not required for the "one consolidated message" requirement. */
export function renderChatMessage(payload: NotificationPayload): WebhookBlockMessage {
  return { text: renderPlainText(payload) };
}

export function renderGenericWebhook(payload: NotificationPayload): NotificationPayload {
  return payload;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
