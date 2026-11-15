'use strict';

const puppeteer = require('puppeteer');

const BLOCKED_RESOURCES = new Set(['image', 'stylesheet', 'font', 'media']);

/**
 * Busca información en tiempo real en la web usando Puppeteer headless y devuelve
 * un resumen consolidado de los primeros 3 a 5 resultados orgánicos.
 * @param {string} query
 * @returns {Promise<string>}
 */
async function searchWeb(query) {
  const cleanQuery = String(query ?? '').trim();
  if (!cleanQuery) {
    return 'No se proporcionaron términos de búsqueda.';
  }

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    );

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (BLOCKED_RESOURCES.has(req.resourceType())) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    let results = await page.evaluate(() => {
      const items = [];
      const nodes = document.querySelectorAll('.result:not(.result--ad)');
      for (const node of nodes) {
        const titleEl = node.querySelector('.result__a');
        const snippetEl = node.querySelector('.result__snippet');
        const title = titleEl?.textContent?.trim() || '';
        const snippet = snippetEl?.textContent?.trim() || '';
        if (title || snippet) {
          items.push({ title, snippet });
        }
        if (items.length >= 5) break;
      }
      return items;
    });

    if (!results.length) {
      const fallbackUrl = `https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}`;
      await page.goto(fallbackUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      results = await page.evaluate(() => {
        const items = [];
        const articles = document.querySelectorAll('article, [data-testid="result"]');
        for (const node of articles) {
          const titleEl = node.querySelector('h2, a[data-testid="result-title-a"]');
          const snippetEl = node.querySelector('[data-result="snippet"], [data-testid="result-snippet"]');
          const title = titleEl?.textContent?.trim() || '';
          const snippet = snippetEl?.textContent?.trim() || '';
          if (title || snippet) {
            items.push({ title, snippet });
          }
          if (items.length >= 5) break;
        }
        return items;
      });
    }

    if (!results.length) {
      return `No se encontraron resultados orgánicos para "${cleanQuery}".`;
    }

    return results
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`)
      .join('\n');
  } catch (err) {
    console.warn('[capri:web] Error en searchWeb:', err.message);
    return `Error al buscar en internet: ${err.message}`;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  searchWeb,
};
