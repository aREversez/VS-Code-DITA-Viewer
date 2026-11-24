// Escaping JSON text for an inline <script> in a webview page.
// Every `<` becomes \u003c, not just `</script>`: a string holding `<!--` followed
// by `<script` puts the HTML parser in the script-data double-escaped state,
// where the real closing tag no longer closes the script and the markup after it
// is swallowed. \u003c is the same character to JSON.parse and to a JS string
// literal, and JSON.stringify only emits `<` inside strings, so this is safe on
// any JSON text.
export function escapeJson(text: string): string {
  return text.replace(/</g, '\\u003c');
}
