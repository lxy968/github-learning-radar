const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
};

export function sanitizeReadmeExcerpt(value: string, maxLength = 1800) {
  const decoded = decodeHtmlEntities(value.replace(/\r\n?/g, "\n"));
  const text = decoded
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<img\b[^>]*\balt\s*=\s*(["'])(.*?)\1[^>]*>/gi, " $2 ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<img\b([^<]*?)\/(?=\s|<|$)/gi, (_image, attributes: string) => {
      const alt = attributes.match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2] ?? "";
      return ` ${alt} `;
    })
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, " $1 ")
    .replace(/\bhttps?:\/\/[^\s<>"\]]+/gi, " ")
    .replace(/\bwww\.[^\s<>"\]]+/gi, " ")
    .replace(/(?:^|\s)\.\/(?:license|readme)(?:\.[a-z0-9]+)?(?=\s|$)/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/<\/?[a-z][\w-]*\/?/gi, " ")
    .replace(
      /\b(?:align|alt|class|height|href|id|rel|src|style|target|valign|width)\s*=\s*(["'])(.*?)\1/gi,
      " "
    )
    .replace(/^\s{0,3}#{1,6}\s*/gm, " ")
    .replace(/[>*_`~|]+/g, " ")
    .replace(/(^|\s)\/(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.slice(0, Math.max(0, Math.round(maxLength)));
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase();
    if (normalized in namedEntities) return namedEntities[normalized];

    const numericValue = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);

    try {
      return Number.isFinite(numericValue) ? String.fromCodePoint(numericValue) : entity;
    } catch {
      return entity;
    }
  });
}
