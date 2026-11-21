const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// Zero-width, bidi-override / isolate and BOM characters (hidden text, text reordering, filter evasion).
const INVISIBLE_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
// Only real HTML event-handler attributes (onclick=, onerror=...), never ordinary words such as "one = 1".
const EVENT_HANDLER_ATTRIBUTE = /\bon(?:abort|animation\w*|auxclick|blur|cancel|change|click|close|contextmenu|copy|cut|dblclick|drag\w*|drop|error|focus\w*|hashchange|input|invalid|key\w+|load\w*|message|mouse\w+|paste|pointer\w+|popstate|reset|resize|scroll|select\w*|submit|toggle|touch\w+|transition\w*|unload|wheel)\s*=/gi;

function stripOnce(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(EVENT_HANDLER_ATTRIBUTE, '');
}

/** React Native Text does not render HTML. This also strips common executable markup
 * before user content is persisted or shown in a future web client. Stripping repeats until the
 * text is stable, so nested payloads such as "javajavascript:script:" cannot re-assemble. */
export function sanitizeUserText(value: string, maxLength = 300): string {
  let current = value.replace(INVISIBLE_CHARACTERS, '').replace(CONTROL_CHARACTERS, '');
  for (let pass = 0; pass < 10; pass++) {
    const next = stripOnce(current).replace(INVISIBLE_CHARACTERS, '').replace(CONTROL_CHARACTERS, '');
    if (next === current) break;
    current = next;
  }
  return current.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Display names go through the same stripping as any user text, limited to 32 characters. */
export function sanitizeUsername(value: string, maxLength = 32): string {
  return sanitizeUserText(value, maxLength);
}
