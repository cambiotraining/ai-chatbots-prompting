import MarkdownIt from './markdown-it.mjs';

const markdown = new MarkdownIt({ html: false, linkify: false }).disable('image');
const renderLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderLink ? renderLink(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options);
};

export function renderMarkdown(value) {
  const text = String(value ?? '');
  // Some models wrap the entire answer in a Markdown code fence.
  const wrapped = text.trim().match(/^(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n\1$/i);
  return markdown.render(wrapped ? wrapped[2] : text);
}
