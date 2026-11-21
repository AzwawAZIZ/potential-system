/*
 * Import Mon Master, sans dépendance ni réseau.
 *
 * lireXlsxMonMaster(Blob|File) -> Promise<{
 *   lignes: [{ ligne, statut, prenom, nomNaissance, email, ville, reference }],
 *   nombreLignes, identitesAbsentes, identitesIncompletes, anomalies
 * }>. Les lignes sont les lignes physiques non vides après l'en-tête, quel que
 * soit leur statut. Une identité absente n'a ni prénom, ni nom, ni e-mail ;
 * elle est incomplète dès qu'au moins l'un de ces trois champs manque.
 *
 * convertirMonMasterEnCsv(aperçu, { promotion, statuts? }) -> {
 *   csv, correspondance: [{ ligneCsv, ligneXlsx }], nombreLignes,
 *   identitesAbsentes, identitesIncompletes
 * }. promotion doit être explicitement M1 ou M2 ; statuts, s'il est fourni,
 * est un tableau de valeurs exactes, sans interprétation d'admission. Par
 * défaut aucun statut n'est filtré. Une identité incomplète produit un nom
 * vide, pour que le parseur métier la rejette même si un seul nom est présent.
 * Aucun import, aucune validation métier ni confirmation ne sont effectués :
 * le parent doit appeler parseCSV, présenter son aperçu, puis obtenir une
 * confirmation et appeler importRows. La correspondance permet de retrouver
 * le numéro physique XLSX à partir de la ligne CSV dans cet aperçu.
 *
 * Limites intentionnelles : ZIP classique stocké ou deflate, XML UTF-8,
 * cellules textuelles ou vides dans les colonnes utiles. Pas de formules dans
 * ces colonnes (même avec une valeur en cache), dates/nombres, cellules
 * multilignes, ZIP64, chiffrement, DTD ou entités externes. Un navigateur avec
 * DOMParser et DecompressionStream('deflate-raw') est requis pour le deflate.
 * Le code interne est isolé pour éviter les collisions lors de l'assemblage.
 */
const monMasterXlsxInterne = (() => {
  const MAX_FICHIER = 5 * 1024 * 1024;
  const MAX_XML = 20 * 1024 * 1024;
  const MAX_LIGNES = 10000;
  const MAX_COLONNES = 512;
  const MAX_BALISES_XML = 500000;
  const MAX_ENTREES = 2048;
  const COLONNES = [
    [1, 'Référence', 'reference'],
    [2, 'Statut de la candidature', 'statut'],
    [5, 'Nom de naissance', 'nomNaissance'],
    [6, 'Prénom', 'prenom'],
    [10, 'Adresse e-mail', 'email'],
    [22, 'Ville / Commune', 'ville'],
  ];
  const NS_TABLE = new Set([
    'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'http://purl.oclc.org/ooxml/spreadsheetml/main',
  ]);
  const NS_REL_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const NS_CONTENT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const NS_REL_OFFICE = [
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'http://purl.oclc.org/ooxml/officeDocument/relationships',
  ];
  const erreur = (message) => { throw new Error('Mon Master : ' + message); };
  const normaliser = (s) => s.normalize('NFC').trim();
  const normaliserEntete = (s) => normaliser(s).replace(/\s+/gu, ' ').toLocaleLowerCase('fr');
  const enfants = (element, localName, ns = element.namespaceURI) =>
    Array.from(element.children).filter((e) => e.localName === localName && e.namespaceURI === ns);
  const uniqueEnfant = (element, nom, obligatoire = false) => {
    const result = enfants(element, nom);
    if (result.length > 1 || (obligatoire && result.length !== 1))
      erreur('structure XML invalide : élément ' + nom + '.');
    return result[0];
  };
  const lireU16 = (v, p) => v.getUint16(p, true);
  const lireU32 = (v, p) => v.getUint32(p, true);
  const utf8 = (data, contexte) => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
    catch { erreur('encodage UTF-8 invalide dans ' + contexte + '.'); }
  };
  const nomsEgaux = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // CRC-32 des parties lues : détecte les erreurs et incohérences d'archive.
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (const b of bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  function verifierExtra(bytes, offset, length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fin = offset + length;
    for (let p = offset; p < fin;) {
      if (p + 4 > fin) erreur('champ supplémentaire ZIP mal formé.');
      const id = lireU16(view, p), taille = lireU16(view, p + 2);
      if (p + 4 + taille > fin) erreur('champ supplémentaire ZIP tronqué.');
      if (id === 1) erreur('ZIP64 non pris en charge.');
      p += 4 + taille;
    }
  }
  function nomArchive(raw, flags) {
    // Les noms de parties OOXML sont ASCII ou UTF-8 ; CP437 n'est pas interprété.
    if (!(flags & 0x800) && raw.some((b) => b > 127))
      erreur('nom ZIP non ASCII sans indicateur UTF-8 non pris en charge.');
    const nom = utf8(raw, 'un nom ZIP');
    if (!nom || nom.startsWith('/') || nom.includes('\\') || /[\x00-\x1f\x7f?#%]/.test(nom) ||
        nom.split('/').some((p, i, arr) => p === '.' || p === '..' || (!p && i !== arr.length - 1)))
      erreur('nom de partie ZIP invalide.');
    return nom;
  }
  function archive(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = bytes.length;
    if (n < 22 || lireU32(v, 0) !== 0x04034b50) erreur('fichier ZIP/XLSX invalide.');
    let fin = -1;
    for (let p = n - 22; p >= Math.max(0, n - 65557); p--) {
      if (lireU32(v, p) === 0x06054b50 && p + 22 + lireU16(v, p + 20) === n) { fin = p; break; }
    }
    if (fin < 0) erreur('fin de répertoire ZIP absente ou invalide.');
    const disque = lireU16(v, fin + 4), disqueDir = lireU16(v, fin + 6);
    const nbDisque = lireU16(v, fin + 8), nb = lireU16(v, fin + 10);
    const tailleDir = lireU32(v, fin + 12), debutDir = lireU32(v, fin + 16);
    if (disque || disqueDir || nbDisque !== nb) erreur('ZIP multidisque non pris en charge.');
    if (nb === 0xffff || tailleDir === 0xffffffff || debutDir === 0xffffffff ||
        (fin >= 20 && lireU32(v, fin - 20) === 0x07064b50)) erreur('ZIP64 non pris en charge.');
    if (!nb || nb > MAX_ENTREES || debutDir + tailleDir !== fin)
      erreur('répertoire ZIP invalide ou trop grand.');
    const entries = new Map(), plages = [];
    let totalXML = 0, p = debutDir;
    for (let i = 0; i < nb; i++) {
      if (p + 46 > fin || lireU32(v, p) !== 0x02014b50) erreur('entrée du répertoire ZIP invalide.');
      const flags = lireU16(v, p + 8), method = lireU16(v, p + 10);
      const crc = lireU32(v, p + 16), compressed = lireU32(v, p + 20), uncompressed = lireU32(v, p + 24);
      const nomLen = lireU16(v, p + 28), extraLen = lireU16(v, p + 30), commentaireLen = lireU16(v, p + 32);
      const disk = lireU16(v, p + 34), local = lireU32(v, p + 42);
      const suivant = p + 46 + nomLen + extraLen + commentaireLen;
      if (suivant > fin) erreur('répertoire ZIP tronqué.');
      if (flags & 0x41) erreur('ZIP chiffré non pris en charge.');
      if (flags & ~0x080e) erreur('options ZIP non prises en charge.');
      if (method !== 0 && method !== 8) erreur('méthode de compression ZIP non prise en charge.');
      if (method === 0 && ((flags & 6) || compressed !== uncompressed)) erreur('entrée ZIP stockée invalide.');
      if (disk || compressed === 0xffffffff || uncompressed === 0xffffffff || local === 0xffffffff)
        erreur('ZIP64 ou multidisque non pris en charge.');
      verifierExtra(bytes, p + 46 + nomLen, extraLen);
      const rawName = bytes.subarray(p + 46, p + 46 + nomLen);
      const nom = nomArchive(rawName, flags);
      if (entries.has(nom)) erreur('partie ZIP en double.');
      if (/\.(xml|rels)$/i.test(nom)) {
        totalXML += uncompressed;
        if (totalXML > MAX_XML) erreur('XML décompressé : limite de 20 Mo dépassée.');
      }
      if (local + 30 > debutDir || lireU32(v, local) !== 0x04034b50)
        erreur('en-tête local ZIP invalide.');
      const lf = lireU16(v, local + 6), lm = lireU16(v, local + 8);
      const lc = lireU32(v, local + 14), lcomp = lireU32(v, local + 18), luncomp = lireU32(v, local + 22);
      const ln = lireU16(v, local + 26), le = lireU16(v, local + 28), data = local + 30 + ln + le;
      if (data > debutDir || data + compressed > debutDir || lf !== flags || lm !== method ||
          !nomsEgaux(rawName, bytes.subarray(local + 30, local + 30 + ln)))
        erreur('incohérence entre les en-têtes ZIP.');
      verifierExtra(bytes, local + 30 + ln, le);
      if (!(flags & 8) && (lc !== crc || lcomp !== compressed || luncomp !== uncompressed))
        erreur('tailles ou CRC ZIP incohérents.');
      if ((flags & 8) && ((lc && lc !== crc) || (lcomp && lcomp !== compressed) || (luncomp && luncomp !== uncompressed)))
        erreur('descripteur ZIP incohérent.');
      let end = data + compressed;
      if (flags & 8) {
        if (end + 12 > debutDir) erreur('descripteur ZIP tronqué.');
        if (lireU32(v, end) === 0x08074b50) end += 4;
        if (end + 12 > debutDir || lireU32(v, end) !== crc || lireU32(v, end + 4) !== compressed || lireU32(v, end + 8) !== uncompressed)
          erreur('descripteur ZIP invalide.');
        end += 12;
      }
      plages.push([local, end]);
      entries.set(nom, { nom, method, crc, compressed, uncompressed, data });
      p = suivant;
    }
    if (p !== fin) erreur('taille du répertoire ZIP incohérente.');
    plages.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < plages.length; i++)
      if (plages[i][0] < plages[i - 1][1]) erreur('entrées ZIP chevauchantes.');
    return entries;
  }
  async function decomprimer(bytes, entry, budget) {
    if (!entry) erreur('une partie XLSX obligatoire est absente.');
    if (entry.uncompressed > MAX_XML || budget.total + entry.uncompressed > MAX_XML)
      erreur('XML décompressé : limite de 20 Mo dépassée.');
    const compressed = bytes.subarray(entry.data, entry.data + entry.compressed);
    let resultat;
    if (entry.method === 0) resultat = compressed;
    else {
      if (typeof DecompressionStream !== 'function')
        erreur('ce navigateur ne prend pas en charge DecompressionStream deflate-raw.');
      let flux;
      try { flux = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
      catch { erreur('ce navigateur ne prend pas en charge DecompressionStream deflate-raw.'); }
      const lecteur = flux.getReader(), morceaux = [];
      let total = 0;
      try {
        while (true) {
          const { value, done } = await lecteur.read();
          if (done) break;
          total += value.byteLength;
          if (total > entry.uncompressed || total > MAX_XML || budget.total + total > MAX_XML) {
            await lecteur.cancel().catch(() => {});
            erreur('décompression ZIP : taille déclarée ou limite de 20 Mo dépassée.');
          }
          morceaux.push(value);
        }
      } catch (e) {
        if (String(e?.message || '').startsWith('Mon Master :')) throw e;
        erreur('données deflate ZIP invalides ou tronquées.');
      } finally { lecteur.releaseLock(); }
      resultat = new Uint8Array(total);
      let position = 0;
      for (const morceau of morceaux) { resultat.set(morceau, position); position += morceau.length; }
    }
    if (resultat.length !== entry.uncompressed || crc32(resultat) !== entry.crc)
      erreur('taille ou CRC incorrect après décompression ZIP.');
    budget.total += resultat.length;
    return resultat;
  }
  function documentXML(bytes, contexte) {
    if (typeof DOMParser !== 'function') erreur('DOMParser est indisponible dans ce navigateur.');
    const texte = utf8(bytes, contexte);
    // Plafond conservateur avant construction du DOM : inclut balises de fin,
    // commentaires et éventuels « < » dans les CDATA ; il peut donc refuser
    // certains XML complexes mais empêche un nombre excessif de nœuds DOM.
    let balises = 0;
    for (let i = 0; i < texte.length; i++)
      if (texte.charCodeAt(i) === 60 && ++balises > MAX_BALISES_XML)
        erreur('XML trop complexe : limite de 500 000 balises dépassée.');
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(texte)) erreur('DTD et entités XML non prises en charge.');
    const declaration = /^\uFEFF?\s*<\?xml\s+[^?]*encoding\s*=\s*(['"])(.*?)\1/i.exec(texte);
    if (declaration && !/^utf-?8$/i.test(declaration[2])) erreur('seul le XML UTF-8 est pris en charge.');
    const doc = new DOMParser().parseFromString(texte, 'application/xml');
    if (!doc.documentElement || doc.getElementsByTagName('parsererror').length || doc.doctype)
      erreur('XML invalide dans ' + contexte + '.');
    return doc.documentElement;
  }
  function racine(element, nom, ns) {
    if (element.localName !== nom || (ns instanceof Set ? !ns.has(element.namespaceURI) : element.namespaceURI !== ns))
      erreur('structure XLSX invalide : ' + nom + ' attendu.');
  }
  function cheminCible(base, target) {
    if (!target || /[\\?#%\x00-\x20\x7f]/.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//'))
      erreur('cible de relation XLSX invalide ou externe.');
    const segments = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const part of target.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!segments.length) erreur('cible XLSX hors archive.'); segments.pop(); }
      else segments.push(part);
    }
    if (!segments.length) erreur('cible de relation XLSX vide.');
    return segments.join('/');
  }
  function relations(root) {
    racine(root, 'Relationships', NS_REL_PKG);
    const map = new Map();
    for (const r of enfants(root, 'Relationship')) {
      const id = r.getAttribute('Id'), type = r.getAttribute('Type'), target = r.getAttribute('Target');
      if (!id || !type || !target || map.has(id)) erreur('relations XLSX invalides ou en double.');
      map.set(id, { type, target, external: (r.getAttribute('TargetMode') || '').toLowerCase() === 'external', mode: r.getAttribute('TargetMode') });
    }
    return map;
  }
  function cibleRelation(r, base, type) {
    if (!r || !NS_REL_OFFICE.some((ns) => r.type === ns + '/' + type))
      erreur('relation XLSX ' + type + ' absente ou incorrecte.');
    if (r.external || (r.mode && r.mode.toLowerCase() !== 'internal')) erreur('relation XLSX externe interdite.');
    return cheminCible(base, r.target);
  }
  function coordonnee(ref) {
    const m = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(ref || '');
    if (!m) erreur('référence de cellule XLSX invalide.');
    let col = 0;
    for (const c of m[1]) col = col * 26 + c.charCodeAt(0) - 64;
    const row = Number(m[2]);
    if (!Number.isSafeInteger(row) || row > MAX_LIGNES + 1 || col > MAX_COLONNES)
      erreur('dimensions XLSX dépassées : 10 000 lignes de données et 512 colonnes maximum.');
    return { col, row };
  }
  function texteRiche(element) {
    let texte = '';
    for (const child of Array.from(element.children)) {
      if (child.namespaceURI !== element.namespaceURI) continue;
      if (child.localName === 't') texte += child.textContent;
      if (child.localName === 'r') {
        const t = uniqueEnfant(child, 't');
        if (t) texte += t.textContent;
      }
    }
    return texte;
  }
  function valeurCellule(cellule, shared, ligne, col, modeEntete = false) {
    if (uniqueEnfant(cellule, 'f')) erreur('formule interdite dans une colonne utile ou l’en-tête (ligne ' + ligne + ', colonne ' + col + ').');
    const type = cellule.getAttribute('t') || 'n';
    const v = uniqueEnfant(cellule, 'v'), inline = uniqueEnfant(cellule, 'is');
    let texte = '';
    if (type === 'inlineStr') {
      if (v || !inline) erreur('cellule inlineStr invalide ligne ' + ligne + '.');
      texte = texteRiche(inline);
    } else if (type === 's') {
      if (!v || inline || !/^(0|[1-9]\d*)$/.test(v.textContent)) erreur('index sharedStrings invalide ligne ' + ligne + '.');
      const idx = Number(v.textContent);
      if (!Number.isSafeInteger(idx) || idx >= shared.length) erreur('index sharedStrings hors limites ligne ' + ligne + '.');
      texte = shared[idx];
    } else if (type === 'str') {
      if (inline) erreur('cellule texte invalide ligne ' + ligne + '.');
      texte = v ? v.textContent : '';
    } else if (type === 'n' && !v && !inline) texte = '';
    else if (modeEntete && type === 'n' && v && !inline) texte = v.textContent;
    else erreur('type de cellule non textuel (date, nombre ou booléen) ligne ' + ligne + ', colonne ' + col + '.');
    if (/[\r\n]/.test(texte)) erreur('cellule multiligne non prise en charge ligne ' + ligne + ', colonne ' + col + '.');
    return normaliser(texte);
  }
  async function lire(file) {
    let taille;
    try { taille = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(file); }
    catch { erreur('choisissez un fichier local File ou Blob valide.'); }
    if (taille > MAX_FICHIER) erreur('fichier supérieur à 5 Mo.');
    let buffer;
    try { buffer = await Blob.prototype.arrayBuffer.call(file); } catch { erreur('impossible de lire le fichier local.'); }
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== taille || buffer.byteLength > MAX_FICHIER)
      erreur('taille du fichier incohérente ou supérieure à 5 Mo.');
    const bytes = new Uint8Array(buffer), entries = archive(bytes), budget = { total: 0 }, cache = new Map();
    const xml = async (nom) => {
      if (!cache.has(nom)) cache.set(nom, documentXML(await decomprimer(bytes, entries.get(nom), budget), nom));
      return cache.get(nom);
    };
    const types = await xml('[Content_Types].xml');
    racine(types, 'Types', NS_CONTENT);
    const overrides = new Map();
    for (const item of enfants(types, 'Override')) {
      const part = item.getAttribute('PartName'), type = item.getAttribute('ContentType');
      if (!part || !type || overrides.has(part)) erreur('types de contenu XLSX invalides ou en double.');
      overrides.set(part, type);
    }
    const verifierType = (part, type) => {
      if (overrides.get('/' + part) !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.' + type + '+xml')
        erreur('type de contenu XLSX incorrect pour une partie obligatoire.');
    };
    const rootRels = relations(await xml('_rels/.rels'));
    const rootCandidates = Array.from(rootRels.values()).filter((r) => NS_REL_OFFICE.some((ns) => r.type === ns + '/officeDocument'));
    if (rootCandidates.length !== 1) erreur('classeur XLSX absent ou ambigu.');
    const workbookPath = cibleRelation(rootCandidates[0], '', 'officeDocument');
    verifierType(workbookPath, 'sheet.main');
    const workbook = await xml(workbookPath);
    racine(workbook, 'workbook', NS_TABLE);
    const sheets = uniqueEnfant(workbook, 'sheets', true);
    const candidats = enfants(sheets, 'sheet').filter((s) => s.getAttribute('name') === 'Candidatures');
    if (candidats.length !== 1) erreur('onglet Candidatures absent ou ambigu.');
    let relId = '';
    for (const ns of NS_REL_OFFICE) relId ||= candidats[0].getAttributeNS(ns, 'id') || '';
    if (!relId) erreur('relation de l’onglet Candidatures absente.');
    const slash = workbookPath.lastIndexOf('/');
    const workbookRelsPath = (slash < 0 ? '' : workbookPath.slice(0, slash + 1)) + '_rels/' + workbookPath.slice(slash + 1) + '.rels';
    const rels = relations(await xml(workbookRelsPath));
    const sheetPath = cibleRelation(rels.get(relId), workbookPath, 'worksheet');
    verifierType(sheetPath, 'worksheet');
    const sharedRels = Array.from(rels.values()).filter((r) => NS_REL_OFFICE.some((ns) => r.type === ns + '/sharedStrings'));
    if (sharedRels.length > 1) erreur('plusieurs tables sharedStrings ambiguës.');
    let shared = [];
    if (sharedRels.length) {
      const sharedPath = cibleRelation(sharedRels[0], workbookPath, 'sharedStrings');
      verifierType(sharedPath, 'sharedStrings');
      const sst = await xml(sharedPath);
      racine(sst, 'sst', NS_TABLE);
      shared = enfants(sst, 'si').map(texteRiche);
    }
    const feuille = await xml(sheetPath);
    racine(feuille, 'worksheet', NS_TABLE);
    const dimension = uniqueEnfant(feuille, 'dimension');
    if (dimension) {
      const morceaux = (dimension.getAttribute('ref') || '').split(':');
      if (morceaux.length > 2 || morceaux.some((x) => !x)) erreur('dimension XLSX invalide.');
      const debut = coordonnee(morceaux[0]), fin = coordonnee(morceaux[morceaux.length - 1]);
      if (debut.col > fin.col || debut.row > fin.row) erreur('dimension XLSX inversée.');
    }
    const data = uniqueEnfant(feuille, 'sheetData', true);
    let previous = 0, header = null;
    const lignes = [];
    for (const row of enfants(data, 'row')) {
      const str = row.getAttribute('r');
      if (!/^[1-9]\d*$/.test(str || '')) erreur('numéro de ligne XLSX absent ou invalide.');
      const numero = Number(str);
      if (!Number.isSafeInteger(numero) || numero > MAX_LIGNES + 1)
        erreur('limite XLSX de 10 000 lignes de données dépassée.');
      if (numero <= previous) erreur('lignes XLSX dupliquées ou désordonnées.');
      previous = numero;
      let derniereColonne = 0, nonVide = false;
      const valeurs = new Map();
      for (const cellule of enfants(row, 'c')) {
        const pos = coordonnee(cellule.getAttribute('r'));
        if (pos.row !== numero || pos.col <= derniereColonne) erreur('cellules XLSX dupliquées, désordonnées ou hors ligne.');
        derniereColonne = pos.col;
        if (enfants(cellule, 'v').length || enfants(cellule, 'is').length || enfants(cellule, 'f').length) nonVide = true;
        if (numero === 1 || COLONNES.some(([col]) => col === pos.col))
          valeurs.set(pos.col, valeurCellule(cellule, shared, numero, pos.col, numero === 1));
      }
      if (numero === 1) { header = valeurs; continue; }
      if (!nonVide) continue;
      const ligne = { ligne: numero, statut: '', prenom: '', nomNaissance: '', email: '', ville: '', reference: '' };
      for (const [col, , cle] of COLONNES) ligne[cle] = valeurs.get(col) || '';
      ligne.email = ligne.email.toLowerCase();
      lignes.push(ligne);
      if (lignes.length > MAX_LIGNES) erreur('limite XLSX de 10 000 lignes de données dépassée.');
    }
    if (!header) erreur('en-tête obligatoire en ligne 1 absent.');
    for (const [col, attendu] of COLONNES) {
      if (normaliserEntete(header.get(col) || '') !== normaliserEntete(attendu))
        erreur('en-tête incorrect en colonne ' + col + ' : « ' + attendu + ' » attendu en ligne 1.');
      const copies = Array.from(header.values()).filter((v) => normaliserEntete(v) === normaliserEntete(attendu)).length;
      if (copies !== 1) erreur('en-tête requis en double : « ' + attendu + ' ».');
    }
    const identitesAbsentes = lignes.filter((x) => !x.prenom && !x.nomNaissance && !x.email).length;
    const identitesIncompletes = lignes.filter((x) => !x.prenom || !x.nomNaissance || !x.email).length;
    const anomalies = [];
    if (!lignes.length) anomalies.push('Aucune ligne de données.');
    if (identitesAbsentes) anomalies.push(identitesAbsentes + ' ligne(s) sans prénom, nom de naissance ni e-mail.');
    if (identitesIncompletes) anomalies.push(identitesIncompletes + ' identité(s) incomplète(s) : aucune création pour ces lignes.');
    return { lignes, nombreLignes: lignes.length, identitesAbsentes, identitesIncompletes, anomalies };
  }
  function convertir(apercu, options = {}) {
    if (!apercu || !Array.isArray(apercu.lignes) || apercu.lignes.length > MAX_LIGNES)
      erreur('aperçu XLSX invalide ou supérieur à 10 000 lignes.');
    if (!options || !['M1', 'M2'].includes(options.promotion))
      erreur('promotion explicitement requise : M1 ou M2.');
    if (options.statuts !== undefined && (!Array.isArray(options.statuts) || options.statuts.some((s) => typeof s !== 'string')))
      erreur('filtre de statuts : fournir un tableau de chaînes exactes.');
    const selection = options.statuts === undefined ? null : new Set(options.statuts);
    const result = ['nom;email;promotion;ville'], correspondance = [];
    let absentes = 0, incompletes = 0, previous = 1;
    const safe = (v, no) => {
      if (typeof v !== 'string') erreur('champ textuel invalide à la ligne ' + no + '.');
      if (/[\r\n]/.test(v)) erreur('cellule multiligne non prise en charge à la ligne ' + no + '.');
      return normaliser(v);
    };
    const csvChamp = (v) => /[;",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    for (const row of apercu.lignes) {
      if (!row || !Number.isSafeInteger(row.ligne) || row.ligne <= previous || row.ligne > MAX_LIGNES + 1)
        erreur('numéro de ligne XLSX invalide ou désordonné dans l’aperçu.');
      previous = row.ligne;
      const statut = safe(row.statut, row.ligne), prenom = safe(row.prenom, row.ligne);
      const nomNaissance = safe(row.nomNaissance, row.ligne), email = safe(row.email, row.ligne).toLowerCase();
      const ville = safe(row.ville, row.ligne);
      safe(row.reference, row.ligne);
      if (selection && !selection.has(statut)) continue;
      const absent = !prenom && !nomNaissance && !email;
      const incomplet = !prenom || !nomNaissance || !email;
      absentes += Number(absent); incompletes += Number(incomplet);
      const nom = incomplet ? '' : nomNaissance + ' ' + prenom;
      result.push([nom, email, options.promotion, ville].map(csvChamp).join(';'));
      correspondance.push({ ligneCsv: result.length, ligneXlsx: row.ligne });
    }
    return { csv: result.join('\n'), correspondance, nombreLignes: correspondance.length,
      identitesAbsentes: absentes, identitesIncompletes: incompletes };
  }
  return { lire, convertir };
})();

export const lireXlsxMonMaster = monMasterXlsxInterne.lire;
export const convertirMonMasterEnCsv = monMasterXlsxInterne.convertir;
