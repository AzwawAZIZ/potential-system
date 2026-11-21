// Lancer depuis le projet : node tests/mon-master-new.mjs
// Toutes les archives de test sont synthétiques et fabriquées uniquement en mémoire.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = await readFile(resolve(root, 'mon-master.js'), 'utf8');
const domain = await readFile(resolve(root, 'domain.js'), 'utf8');
const seed = await readFile(resolve(root, 'seed.js'), 'utf8');
const bundledOthers = await Promise.all(['storage.js', 'ui.js', 'app.js'].map((name) => readFile(resolve(root, name), 'utf8')));
const strip = (s) => s.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/\bexport (?=(?:const|let|function|class)\b)/g, '');
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const P = 'http://schemas.openxmlformats.org/package/2006/relationships';
const C = 'http://schemas.openxmlformats.org/package/2006/content-types';
const enc = (s) => Buffer.from(s, 'utf8');
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const inline = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
const shared = (ref, index) => `<c r="${ref}" t="s"><v>${index}</v></c>`;
const row = (n, cells) => `<row r="${n}">${cells}</row>`;
const headers = { A: 'Référence', B: 'Statut de la candidature', E: 'Nom de naissance', F: 'Prénom', J: 'Adresse e-mail', V: 'Ville / Commune' };
const header = (overrides = {}, extra = '') => row(1, Object.entries({ ...headers, ...overrides }).map(([c, v]) => inline(c + '1', v)).join('') + extra);
function crc32(buffer) {
  let n = 0xffffffff;
  for (const b of buffer) { n ^= b; for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (0xedb88320 & -(n & 1)); }
  return (n ^ 0xffffffff) >>> 0;
}
function zip(entries, options = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const filename = enc(name), plain = Buffer.isBuffer(content) ? content : enc(content);
    const method = options.method ?? 8, flags = options.flags ?? 0;
    const compressed = method === 0 ? plain : deflateRawSync(plain);
    const crc = crc32(plain), advertised = options.fakeSize?.[name] ?? plain.length;
    const extra = options.extra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(advertised, 22); local.writeUInt16LE(filename.length, 26); local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(advertised, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt16LE(extra.length, 30); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, extra, compressed); centrals.push(central, filename, extra);
    offset += local.length + filename.length + extra.length + compressed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function parts({ rows = header(), dimension = 'A1:DP6', sharedStrings = null, sheetName = 'Candidatures',
  sheetTarget = 'worksheets/sheet1.xml', sheetMode = '', worksheetPrefix = '', worksheetOverride = null,
  workbookHeader = '' } = {}) {
  const relShared = sharedStrings === null ? '' : `<Relationship Id="rId2" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>`;
  const contentShared = sharedStrings === null ? '' : '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>';
  const list = [
    ['[Content_Types].xml', `<Types xmlns="${C}"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${contentShared}</Types>`],
    ['_rels/.rels', `<Relationships xmlns="${P}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${workbookHeader}<workbook xmlns="${NS}" xmlns:r="${R}"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${P}"><Relationship Id="rId1" Type="${R}/worksheet" Target="${esc(sheetTarget)}" ${sheetMode}/>${relShared}</Relationships>`],
    ['xl/worksheets/sheet1.xml', worksheetOverride ?? `${worksheetPrefix}<worksheet xmlns="${NS}"><dimension ref="${dimension}"/><sheetData>${rows}</sheetData></worksheet>`],
  ];
  if (sharedStrings !== null) list.push(['xl/sharedStrings.xml', `<sst xmlns="${NS}">${sharedStrings}</sst>`]);
  return list;
}
const fixture = (opts = {}, z = {}) => zip(parts(opts), z).toString('base64');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
const requests = [], pageErrors = [];
page.on('request', (req) => requests.push(req.url()));
page.on('pageerror', (error) => pageErrors.push(error.message));
let count = 0;
async function test(name, fn) {
  await fn(); count++; console.log('✓ ' + name);
}
async function readFixture(base64) {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (x) => x.charCodeAt(0));
    return window.monMasterTests.lire(new Blob([bytes]));
  }, base64);
}
async function rejectFixture(base64, re) {
  const result = await page.evaluate(async (b64) => {
    try {
      const bytes = Uint8Array.from(atob(b64), (x) => x.charCodeAt(0));
      await window.monMasterTests.lire(new Blob([bytes]));
      return 'AUCUNE ERREUR';
    } catch (e) { return e.message; }
  }, base64);
  assert.match(result, re);
}
try {
  // Comme le bundle HTML : code ES aplati dans une IIFE, sans requête ni module externe.
  await page.setContent('<!doctype html><meta charset="utf-8"><title>Test local</title>');
  await page.addScriptTag({ content: `(()=>{${strip(seed)}\n${strip(domain)}\n${strip(source)}\nwindow.monMasterTests={lire:lireXlsxMonMaster,convertir:convertirMonMasterEnCsv,parseCSV,importRows,seed};})();` });
  assert.ok(await page.evaluate(() => !!window.monMasterTests));

  await test('module ES natif et compilation de l’assemblage complet sans collision', async () => {
    const result = await page.evaluate(async ({ code, bundle }) => {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try {
        const module = await import(url);
        new Function(`'use strict';(()=>{${bundle}\n})();`);
        return { lire: typeof module.lireXlsxMonMaster, convertir: typeof module.convertirMonMasterEnCsv };
      } finally { URL.revokeObjectURL(url); }
    }, { code: source, bundle: [seed, domain, ...bundledOthers, source].map(strip).join('\n') });
    assert.deepEqual(result, { lire: 'function', convertir: 'function' });
  });
  const fictifRows = header({}, inline('W1', 'Cursus') + inline('X1', 'Cursus')) +
    row(2, inline('A2', ' REF-1 ') + shared('B2', 0) + inline('E2', 'Dupond; "Test"') + inline('F2', ' Zoé ') + shared('J2', 1) + inline('V2', 'Amiens; Nord')) +
    row(5, inline('B5', 'Autre statut')) +
    row(6, inline('B6', 'Attente') + inline('E6', 'Martin') + inline('F6', 'Alex') + inline('J6', 'alex@example.invalid') + inline('V6', 'Arras'));
  const fictif = fixture({ rows: fictifRows, sharedStrings: '<si><r><t>En </t></r><r><t>attente</t></r></si><si><t> TEST@EXAMPLE.INVALID </t></si>' });
  await test('deflate, inlineStr, sharedStrings riches, colonnes répétées et lignes physiques', async () => {
    const out = await readFixture(fictif);
    assert.equal(out.nombreLignes, 3); assert.equal(out.identitesAbsentes, 1); assert.equal(out.identitesIncompletes, 1);
    assert.deepEqual(out.lignes.map((x) => x.ligne), [2, 5, 6]);
    assert.deepEqual(out.lignes[0], { ligne: 2, statut: 'En attente', prenom: 'Zoé', nomNaissance: 'Dupond; "Test"', email: 'test@example.invalid', ville: 'Amiens; Nord', reference: 'REF-1' });
    assert.deepEqual(out.lignes.map((x) => x.statut), ['En attente', 'Autre statut', 'Attente']);
    assert.ok(out.anomalies.length);
  });
  await test('CSV fidèle, promotion obligatoire, filtre explicite et absence de mutation', async () => {
    const out = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (x) => x.charCodeAt(0));
      const api = window.monMasterTests, preview = await api.lire(new Blob([bytes]));
      const avant = JSON.stringify(preview);
      let missing; try { api.convertir(preview); } catch (e) { missing = e.message; }
      let invalid; try { api.convertir(preview, { promotion: 'm1' }); } catch (e) { invalid = e.message; }
      const all = api.convertir(preview, { promotion: 'M1' });
      const filtered = api.convertir(preview, { promotion: 'M2', statuts: ['Attente'] });
      const none = api.convertir(preview, { promotion: 'M1', statuts: [] });
      const state = api.seed(), rows = api.parseCSV(all.csv, state);
      return { all, filtered, none, missing, invalid, unchanged: avant === JSON.stringify(preview), rows };
    }, fictif);
    assert.match(out.missing, /promotion/i); assert.match(out.invalid, /M1 ou M2/); assert.equal(out.unchanged, true);
    assert.equal(out.all.nombreLignes, 3); assert.equal(out.all.identitesAbsentes, 1);
    assert.deepEqual(out.all.correspondance, [{ ligneCsv: 2, ligneXlsx: 2 }, { ligneCsv: 3, ligneXlsx: 5 }, { ligneCsv: 4, ligneXlsx: 6 }]);
    assert.ok(out.all.csv.includes('"Dupond; ""Test"" Zoé";test@example.invalid;M1;"Amiens; Nord"'));
    assert.equal(out.rows[0].nom, 'Dupond; "Test" Zoé'); assert.equal(out.rows[0].ville, 'Amiens; Nord');
    assert.equal(out.rows[0].error, ''); assert.match(out.rows[1].error, /Nom manquant/);
    assert.equal(out.filtered.nombreLignes, 1); assert.equal(out.filtered.correspondance[0].ligneXlsx, 6);
    assert.equal(out.none.csv, 'nom;email;promotion;ville');
  });
  await test('identité partielle ne peut pas devenir une création, même avec un prénom ou nom présent', async () => {
    const partial = fixture({ rows: header() + row(2, inline('B2', 'Statut') + inline('E2', 'Seul') + inline('J2', 'seul@example.invalid')) });
    const result = await page.evaluate(async (b64) => {
      const api = window.monMasterTests, bytes = Uint8Array.from(atob(b64), (x) => x.charCodeAt(0));
      const preview = await api.lire(new Blob([bytes])), csv = api.convertir(preview, { promotion: 'M1' }).csv;
      const state = api.seed(); state.session = { user: 'sophie', role: 'stages', lastActivity: Date.now() };
      const rows = api.parseCSV(csv, state), report = api.importRows(state, rows, 'synthetique.csv');
      return { incomplete: preview.identitesIncompletes, error: rows[0].error, report };
    }, partial);
    assert.equal(result.incomplete, 1); assert.match(result.error, /Nom manquant/);
    assert.deepEqual(result.report, { created: 0, updated: 0, rejected: 1 });
  });
  await test('format ZIP stocké accepté', async () => {
    const result = await readFixture(fixture({ rows: header() + row(2, inline('B2', 'sans identité')) }, { method: 0 }));
    assert.equal(result.identitesAbsentes, 1);
  });
  await test('classeur sans aucune ligne : anomalie explicite et CSV sans création', async () => {
    const out = await readFixture(fixture());
    assert.equal(out.nombreLignes, 0); assert.match(out.anomalies.join(' '), /Aucune ligne/);
  });
  await test('nom, position et unicité des six en-têtes requis', async () => {
    await rejectFixture(fixture({ rows: header({ E: 'Prénom' }) }), /en-tête incorrect/i);
    await rejectFixture(fixture({ rows: header({}, inline('W1', 'Prénom')) }), /en-tête requis en double/i);
    await rejectFixture(fixture({ rows: row(2, inline('B2', 'Statut')) }), /en-tête.*ligne 1/i);
    await rejectFixture(fixture({ sheetName: 'Autre' }), /onglet Candidatures absent/i);
  });
  await test('dates, nombres, formules et cellules multilignes rejetés dans les champs utiles', async () => {
    for (const cell of ['<c r="E2" t="d"><v>2026-01-02</v></c>', '<c r="E2"><v>46000</v></c>', '<c r="E2" t="str"><f>NOW()</f><v>Valeur</v></c>', inline('E2', 'une\ndeux')])
      await rejectFixture(fixture({ rows: header() + row(2, cell) }), /non textuel|formule|multiligne/i);
    const out = await readFixture(fixture({ rows: header() + row(2, inline('B2', 'Attente') + '<c r="C2"><f>1+1</f><v>2</v></c>') }));
    assert.equal(out.lignes[0].statut, 'Attente');
  });
  await test('dimensions et limite stricte de 10 000 lignes physiques', async () => {
    await rejectFixture(fixture({ dimension: 'A1:A10002' }), /dimensions|10 000/i);
    await rejectFixture(fixture({ dimension: 'A1:SS1' }), /dimensions|512/i);
    await rejectFixture(fixture({ dimension: 'A1:B1', rows: header() + row(10002, inline('B10002', 'x')) }), /10 000/i);
    const rows = header() + Array.from({ length: 10000 }, (_, i) => row(i + 2, inline('B' + (i + 2), 'statut'))).join('');
    const out = await readFixture(fixture({ rows, dimension: 'A1:V10001' }));
    assert.equal(out.nombreLignes, 10000); assert.equal(out.identitesAbsentes, 10000);
  });
  await test('fichier > 5 Mo rejeté avant lecture', async () => {
    const result = await page.evaluate(async () => {
      try { await window.monMasterTests.lire(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])); return 'AUCUNE ERREUR'; }
      catch (e) { return e.message; }
    });
    assert.match(result, /5 Mo/);
  });
  await test('vrai File accepté, objet factice et XML excessivement complexe refusés', async () => {
    const result = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (x) => x.charCodeAt(0));
      const ok = await window.monMasterTests.lire(new File([bytes], 'synthetique.xlsx'));
      let erreur;
      try { await window.monMasterTests.lire({ size: 0, arrayBuffer: async () => new ArrayBuffer(0) }); }
      catch (e) { erreur = e.message; }
      return { count: ok.nombreLignes, erreur };
    }, fictif);
    assert.equal(result.count, 3); assert.match(result.erreur, /File ou Blob/);
    await rejectFixture(fixture({ worksheetPrefix: '<!--' + '<'.repeat(500001) + '-->' }), /XML trop complexe/i);
  });
  await test('archive malformée, CRC, taille XML, chiffrement, compression et ZIP64 refusés', async () => {
    await rejectFixture(Buffer.from('ceci nest pas un zip').toString('base64'), /ZIP\/XLSX invalide/);
    const broken = Buffer.from(fictif, 'base64'); broken[broken.length - 6] ^= 1;
    await rejectFixture(broken.toString('base64'), /répertoire ZIP|ZIP64/i);
    await rejectFixture(fixture({}, { method: 9 }), /méthode de compression/i);
    await rejectFixture(fixture({}, { flags: 1 }), /chiffré/i);
    await rejectFixture(fixture({}, { extra: Buffer.from([1, 0, 0, 0]) }), /ZIP64/i);
    await rejectFixture(fixture({}, { fakeSize: { 'xl/worksheets/sheet1.xml': 20 * 1024 * 1024 + 1 } }), /20 Mo/i);
    await rejectFixture(fixture({}, { fakeSize: { 'xl/worksheets/sheet1.xml': 10 } }), /taille déclarée|20 Mo/i);
    const corrupt = zip(parts(), { method: 0 });
    const place = corrupt.indexOf(enc('<Types xmlns=')); corrupt[place + 1] ^= 1;
    await rejectFixture(corrupt.toString('base64'), /CRC/i);
  });
  await test('XML malformé, DTD, relation externe et index partagé invalides refusés', async () => {
    await rejectFixture(fixture({ workbookHeader: '<!DOCTYPE x [<!ENTITY xx SYSTEM "https://invalid.example/">]>' }), /DTD|entités/i);
    await rejectFixture(fixture({ worksheetOverride: '<worksheet' }), /XML invalide/i);
    await rejectFixture(fixture({ sheetTarget: 'https://invalid.example/x', sheetMode: 'TargetMode="External"' }), /externe/i);
    await rejectFixture(fixture({ rows: header() + row(2, shared('B2', 99)), sharedStrings: '<si><t>x</t></si>' }), /sharedStrings hors limites/i);
  });
  await test('erreur claire si DecompressionStream deflate-raw est indisponible', async () => {
    const message = await page.evaluate(async (b64) => {
      const previous = window.DecompressionStream;
      try {
        window.DecompressionStream = undefined;
        await window.monMasterTests.lire(new Blob([Uint8Array.from(atob(b64), (x) => x.charCodeAt(0))]));
        return 'AUCUNE ERREUR';
      } catch (e) { return e.message; } finally { window.DecompressionStream = previous; }
    }, fictif);
    assert.match(message, /DecompressionStream deflate-raw/);
  });
  const reel = await readFile(process.env.MON_MASTER_FICHIER_REEL || '/home/ubuntu/upload/fichier-mon-master.xlsx')
    .catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
  if (reel) await test('classeur réel : contrôle anonymisé en mémoire, sans import ni données affichées', async () => {
    const stats = await page.evaluate(async (b64) => {
      const api = window.monMasterTests, bytes = Uint8Array.from(atob(b64), (x) => x.charCodeAt(0));
      const out = await api.lire(new Blob([bytes]));
      const csv = api.convertir(out, { promotion: 'M1' });
      const checked = api.parseCSV(csv.csv, api.seed());
      return { nombreLignes: out.nombreLignes, absentes: out.identitesAbsentes, incompletes: out.identitesIncompletes,
        anomalies: out.anomalies.length, valides: checked.filter((x) => !x.error).length };
    }, reel.toString('base64'));
    assert.ok(stats.nombreLignes > 0); assert.equal(stats.absentes, stats.nombreLignes); assert.equal(stats.incompletes, stats.nombreLignes);
    assert.ok(stats.anomalies > 0); assert.equal(stats.valides, 0);
  });
  else console.log('– Classeur local absent : contrôle anonymisé facultatif ignoré.');
  // L'import ES de test utilise une URL blob: locale, ce n'est pas une requête réseau.
  assert.deepEqual(requests.filter((url) => !url.startsWith('blob:')), []);
  assert.deepEqual(pageErrors, []);
  console.log(`\n${count} tests ciblés réussis ; aucune requête réseau ni erreur JavaScript.`);
} finally { await browser.close(); }
