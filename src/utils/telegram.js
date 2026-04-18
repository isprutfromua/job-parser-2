function escapeTitle(title) {
  return title.replace(/\s+/g, " ").trim();
}

const SOURCE_META = {
  robota: { emoji: "🟢", label: "Robota" },
  work: { emoji: "🔵", label: "Work.ua" },
  djinni: { emoji: "🟣", label: "Djinni" },
  dou_family: { emoji: "🟠", label: "DOU Family" },
};

function sourceHeader(source) {
  const meta = SOURCE_META[source] || { emoji: "⚪", label: source };
  return `${meta.emoji} ${meta.label}`;
}

function buildNotificationGroups(runSummaries) {
  const grouped = new Map();

  for (const item of runSummaries) {
    const jobs = item.newJobs || [];
    if (!jobs.length) {
      continue;
    }

    if (!grouped.has(item.source)) {
      grouped.set(item.source, []);
    }

    const lines = grouped.get(item.source);
    lines.push(`🔎 ${item.queryKey} - ${jobs.length} new jobs`);
    for (const job of jobs) {
      lines.push(`✨ ${escapeTitle(job.title).replace(/\$/g, "")}`);
      lines.push(`🔗 ${job.canonicalUrl}\n`);
    }
    lines.push("=============================\n");
  }

  const groups = [];

  for (const [source, sourceLines] of grouped.entries()) {
    if (sourceLines.length && sourceLines[sourceLines.length - 1] === "") {
      sourceLines.pop();
    }

    groups.push({
      source,
      lines: [`${sourceHeader(source)}`, "", ...sourceLines],
    });
  }

  return groups;
}

function chunkLines(lines, maxLength = 3900) {
  if (!lines.length) {
    return [];
  }

  const chunks = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLength) {
      if (current) {
        chunks.push(current);
      }
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

async function sendTelegramMessages({ botToken, chatId, messages }) {
  if (!messages.length) {
    return;
  }

  for (const text of messages) {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram API request failed (${response.status}): ${body}`);
    }
  }
}

module.exports = {
  buildNotificationGroups,
  chunkLines,
  sendTelegramMessages,
};
