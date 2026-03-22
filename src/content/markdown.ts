/**
 * Light markdown renderer for overlay responses.
 * Supports: **bold**, *italic*, `inline code`, - bullets, newlines.
 * Sanitizes HTML first to prevent injection from AI responses.
 */
export function renderMarkdown(text: string): string {
  // 1. Escape HTML entities first (prevents injection)
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Inline code (process first to avoid inner matches)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 3. Bold **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 4. Italic *text* (but not inside bold markers)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 5. Bullet lists: consecutive lines starting with "- "
  // Split into lines, group consecutive bullets, wrap in <ul>
  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;

  for (const line of lines) {
    const bulletMatch = line.match(/^- (.+)/);
    if (bulletMatch) {
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      result.push(`<li>${bulletMatch[1]}</li>`);
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(line);
    }
  }
  if (inList) {
    result.push('</ul>');
  }

  html = result.join('\n');

  // 6. Newlines to <br> (but not inside list blocks)
  html = html.replace(/\n/g, '<br>');

  // Clean up <br> around list tags
  html = html.replace(/<br><ul>/g, '<ul>');
  html = html.replace(/<\/ul><br>/g, '</ul>');
  html = html.replace(/<br><li>/g, '<li>');
  html = html.replace(/<\/li><br>/g, '</li>');

  return html;
}
