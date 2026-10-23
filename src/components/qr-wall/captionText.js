export function splitCaption(caption = '') {
  return String(caption)
    .split(/(\s+)/u)
    .filter(Boolean)
    .map(text => ({
      text,
      isHashtag: text.length > 1 && text.startsWith('#'),
    }));
}
