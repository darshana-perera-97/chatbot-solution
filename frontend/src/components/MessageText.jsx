import { Fragment } from "react";
import { splitMessageLines } from "../chatSessionMessages";

/** Match http(s) and www. URLs; trailing punctuation is stripped from the href. */
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)/gi;

function splitUrlMatch(raw) {
  const trimmed = String(raw).replace(/[.,;:!?)\]}'"]+$/g, "");
  const trailing = String(raw).slice(trimmed.length);
  const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return { href, display: trimmed, trailing };
}

function linkifyLine(line, linkClassName) {
  if (!line) return line;
  const parts = [];
  let lastIndex = 0;
  let match;
  const re = new RegExp(URL_RE.source, "gi");
  while ((match = re.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const { href, display, trailing } = splitUrlMatch(match[0]);
    parts.push(
      <a
        key={`${match.index}-${display}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {display}
      </a>
    );
    if (trailing) parts.push(trailing);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  return parts.length ? parts : line;
}

/**
 * Renders chat message text with preserved line breaks and clickable links.
 */
export function MessageText({
  text,
  className = "break-words whitespace-pre-wrap leading-relaxed",
  linkClassName = "underline underline-offset-2 break-all hover:opacity-90",
}) {
  const lines = splitMessageLines(text);
  return (
    <p className={className}>
      {lines.map((line, lineIdx) => (
        <Fragment key={lineIdx}>
          {lineIdx > 0 ? <br /> : null}
          {linkifyLine(line, linkClassName)}
        </Fragment>
      ))}
    </p>
  );
}
