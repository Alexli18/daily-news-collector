#!/usr/bin/env node
'use strict';

/**
 * Fetches and parses one RSS/Atom feed, prints a JSON array of items to stdout.
 * Usage:  node helpers/fetch-rss.js <url>
 * Exit 0 on success, exit 1 on failure (error printed to stderr).
 */

const Parser = require('rss-parser');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node helpers/fetch-rss.js <url>');
  process.exit(1);
}

const parser = new Parser({
  timeout: 20000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsCollector/1.0; +https://github.com)' },
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'creator'],
    ],
  },
});

function stripHtml(html) {
  return (html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const feed = await parser.parseURL(url);
  const items = (feed.items || []).map(item => ({
    title:          stripHtml(item.title || ''),
    url:            (item.link || item.guid || '').trim(),
    publishedAt:    item.isoDate || item.pubDate || '',
    excerpt:        stripHtml(item.contentSnippet || item.description || item.summary || '').slice(0, 500),
    contentSnippet: stripHtml(item.contentEncoded || item.content || item.description || '').slice(0, 500),
    guid:           (item.guid || item.id || '').trim(),
  }));
  process.stdout.write(JSON.stringify(items) + '\n');
}

main().catch(err => {
  process.stderr.write(`[fetch-rss ERROR] ${url}\n${err.message}\n`);
  process.exit(1);
});
