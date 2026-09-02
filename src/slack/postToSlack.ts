import type { Incident } from "@prisma/client";

const SEVERITY_EMOJI: Record<string, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
  LOW: "🟢",
  UNKNOWN: "⚪",
};

export async function postToSlack(incident: Incident): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("SLACK_WEBHOOK_URL not set - skipping Slack notification");
    return;
  }

  const baseUrl = process.env.PUBLIC_BASE_URL;
  const dashboardLink = baseUrl ? `${baseUrl}/incidents/${incident.id}` : undefined;
  const emoji = SEVERITY_EMOJI[incident.severity] ?? SEVERITY_EMOJI.UNKNOWN;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${incident.severity} — ${incident.title}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Source:*\n${incident.source}` },
        { type: "mrkdwn", text: `*Category:*\n${incident.category}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Summary:*\n${incident.summary}` },
    },
    ...(incident.recommendedAction
      ? [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Recommended action:*\n${incident.recommendedAction}` },
          },
        ]
      : []),
    ...(dashboardLink
      ? [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: `<${dashboardLink}|View in dashboard>` }],
          },
        ]
      : []),
  ];

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
}
