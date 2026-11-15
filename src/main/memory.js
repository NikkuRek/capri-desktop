'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const Database = require('better-sqlite3');

class MemoryManager {
  constructor() {
    const userDataDir = app.getPath('userData');
    fs.mkdirSync(userDataDir, { recursive: true });

    this.dbPath = path.join(userDataDir, 'capri_memory.sqlite');
    console.log(`[capri:memory] Base de datos LTM inicializada en: ${this.dbPath}`);

    this.db = new Database(this.dbPath);
    this.initDB();

    this.insertStmt = this.db.prepare(
      'INSERT INTO memories (concept, fact) VALUES (?, ?)'
    );
    this.searchStmt = this.db.prepare(
      'SELECT concept, fact FROM memories WHERE memories MATCH ? ORDER BY rank LIMIT 5'
    );
  }

  initDB() {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(
        concept,
        fact,
        tokenize='porter'
      );
    `);
  }

  saveFact(concept, fact) {
    try {
      const cleanConcept = String(concept ?? '').trim();
      const cleanFact = String(fact ?? '').trim();
      if (!cleanConcept || !cleanFact) {
        console.warn('[capri:memory] saveFact omitido: concept o fact vacío.');
        return false;
      }

      this.insertStmt.run(cleanConcept, cleanFact);
      console.log(`[capri:memory] Hecho guardado -> [${cleanConcept}]: ${cleanFact}`);
      return true;
    } catch (err) {
      console.error('[capri:memory] Error al guardar hecho en SQLite:', err.message);
      return false;
    }
  }

  recallContext(userPrompt) {
    try {
      const cleaned = String(userPrompt ?? '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .trim();

      if (!cleaned) return '';

      const terms = cleaned
        .split(/\s+/)
        .filter((word) => word.length > 3 && word.toUpperCase() !== 'NEAR');

      if (!terms.length) return '';

      const ftsQuery = terms.join(' OR ');
      const rows = this.searchStmt.all(ftsQuery);

      if (!rows || rows.length === 0) return '';

      const lines = rows.map((row) => `- ${row.concept}: ${row.fact}`);
      return `Información almacenada previamente sobre el usuario:\n${lines.join('\n')}`;
    } catch (err) {
      console.error('[capri:memory] Error al buscar contexto en SQLite:', err.message);
      return '';
    }
  }
}

module.exports = new MemoryManager();
