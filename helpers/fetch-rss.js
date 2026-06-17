#!/usr/bin/env node
'use strict';

/**
 * Fetches and parses one RSS/Atom feed, prints a JSON array of items to stdout.
 * Usage:  node helpers/fetch-rss.js <url>
 * Exit 0 on success, exit 1 on failure (error printed to stderr).
 *
 * Google News RSS (news.google.com) is supported: titles are cleaned by
 * stripping the " - Source Name" suffix Google appends, and the item URL
 * is the Google redirect link (stable per article, resolves to the real page).
 */

const Parser = require('rss-parser');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node helpers/fetch-rss.js <url>');
  process.exit(1);
}

const isGoogleNews = url.includes('news.google.com');

const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          'application/rss+xml, application/xml, text/xml, */*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  },
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['dc:creator',      'creator'],
      ['source',          'gnSource'],   // Google News: <source url="...">Publication</source>
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

// Google News appends " - Publication Name" to every title.
function cleanGoogleTitle(title, gnSource) {
  const src = (gnSource || '').trim();
  if (src && title.endsWith(' - ' + src)) {
    return title.slice(0, -(src.length + 3)).trim();
  }
  // Fallback: strip last " - X" segment when it looks like a publication tag
  // (≤80 chars with no internal dashes that would suggest it's part of the headline)
  return title.replace(/ - [^-]{1,80}$/, '').trim();
}

async function main() {
  const feed = await parser.parseURL(url);
  const items = (feed.items || []).map(item => {
    const rawTitle = stripHtml(item.title || '');
    const title    = isGoogleNews ? cleanGoogleTitle(rawTitle, item.gnSource) : rawTitle;

    return {
      title,
      url:            (item.link || item.guid || '').trim(),
      publishedAt:    item.isoDate || item.pubDate || '',
      excerpt:        stripHtml(item.contentSnippet || item.description || item.summary || '').slice(0, 500),
      contentSnippet: stripHtml(item.contentEncoded || item.content || item.description || '').slice(0, 500),
      guid:           (item.guid || item.id || '').trim(),
    };
  });
  process.stdout.write(JSON.stringify(items) + '\n');
}

main().catch(err => {
  process.stderr.write(`[fetch-rss ERROR] ${url}\n${err.message}\n`);
  process.exit(1);
});
