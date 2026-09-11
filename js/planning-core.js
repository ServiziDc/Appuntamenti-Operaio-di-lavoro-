// ============================================================
// Planning Operai — logica condivisa tra l'app di gestione (index.html)
// e l'app dedicata dell'operaio (operaio/index.html).
// Nessun template literal annidato - solo concatenazione di stringhe.
// ============================================================

var GIORNI_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
var MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

// ---------------- Utility ----------------
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function oggiMese() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
function oggiData() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function giorniNelMese(mese) {
  var p = mese.split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10), 0).getDate();
}
function classeValore(v) {
  if (!v) return '';
  var t = v.trim().toUpperCase();
  if (t.indexOf('ASSENZA') === 0) return 'v-assenza';
  if (t.indexOf('PERMESSO') === 0) return 'v-permesso';
  if (t.indexOf('FERIE') === 0 || t.indexOf('VACANZ') === 0) return 'v-ferie';
  if (t === 'UFF' || t.indexOf('UFFICIO') === 0) return 'v-uff';
  if (t.indexOf('MALATTIA') === 0) return 'v-malattia';
  return '';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function slugify(nome) {
  var s = nome.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return s || ('op_' + Date.now());
}

// ---------------- Celle divise Giorno/Sera ----------------
// Un carattere di controllo (Unit Separator) non digitabile da tastiera:
// se e' presente nel valore salvato, la cella e' "divisa" in due parti.
var SPLIT_SEP = '\x1F';
function isSplitValue(v) { return typeof v === 'string' && v.indexOf(SPLIT_SEP) !== -1; }
function splitValue(v) {
  var parts = (v || '').split(SPLIT_SEP);
  return { giorno: parts[0] || '', sera: parts[1] || '' };
}
function combineSplit(giorno, sera) {
  giorno = (giorno || '').trim();
  sera = (sera || '').trim();
  if (!giorno && !sera) return '';
  return giorno + SPLIT_SEP + sera;
}

// ---------------- Nota separata (icona avviso al passaggio del mouse) ----------------
var NOTE_SEP = '\x1E';
function splitNote(v) {
  v = v || '';
  var i = v.indexOf(NOTE_SEP);
  if (i === -1) return { main: v, nota: '' };
  return { main: v.substring(0, i), nota: v.substring(i + 1) };
}
function combineNote(main, nota) {
  main = main || '';
  nota = (nota || '').trim();
  if (!nota) return main;
  return main + NOTE_SEP + nota;
}

// ---------------- Link Google Maps (indirizzo del cantiere) ----------------
var MAPS_SEP = '\x1C';
function splitMaps(v) {
  v = v || '';
  var i = v.indexOf(MAPS_SEP);
  if (i === -1) return { resto: v, maps: '' };
  return { resto: v.substring(0, i), maps: v.substring(i + 1) };
}
function combineMaps(resto, maps) {
  resto = resto || '';
  maps = (maps || '').trim();
  if (!maps) return resto;
  return resto + MAPS_SEP + maps;
}

// ---------------- Ticket allegati (link a Google Drive) ----------------
// Va SEMPRE in fondo alla stringa: se presente, tutto quello che segue e'
// un JSON con un ARRAY di { nome, url, fileId } (una cella puo' avere piu'
// di un ticket allegato). Per compatibilita' con celle vecchie, se il JSON
// e' un singolo oggetto (non un array) viene incapsulato in un array da 1.
var TICKET_SEP = '\x1D';
function splitTicket(v) {
  v = v || '';
  var i = v.indexOf(TICKET_SEP);
  if (i === -1) return { resto: v, ticket: [] };
  var resto = v.substring(0, i);
  var ticket = [];
  try {
    var parsed = JSON.parse(v.substring(i + 1));
    ticket = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  } catch (e) { ticket = []; }
  return { resto: resto, ticket: ticket };
}
function combineTicket(resto, ticket) {
  resto = resto || '';
  if (!ticket || !ticket.length) return resto;
  return resto + TICKET_SEP + JSON.stringify(ticket);
}
// Analizza una cella grezza restituendo le sue 3 componenti indipendenti.
function analizzaCella(raw) {
  var st = splitTicket(raw || '');
  var sm = splitMaps(st.resto);
  var sn = splitNote(sm.resto);
  return { main: sn.main, nota: sn.nota, maps: sm.maps, ticket: st.ticket };
}

// Converte un link Google Drive (webViewLink, tipo ".../file/d/ID/view")
// nell'URL di anteprima incorporabile in un iframe.
function driveEmbedUrl(url) {
  if (!url) return '';
  var m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return '';
  return 'https://drive.google.com/file/d/' + m[1] + '/preview';
}

// Trova, tra una lista di operai {id, nome, uid, email}, quello collegato
// all'utente Firebase attualmente loggato (per uid, con l'email come
// riserva). Restituisce null se nessuno corrisponde.
function trovaOperaioPerUtente(operai, user) {
  if (!user) return null;
  var uid = user.uid;
  var email = (user.email || '').toLowerCase();
  for (var i = 0; i < operai.length; i++) {
    if (operai[i].uid && operai[i].uid === uid) return operai[i];
  }
  for (var j = 0; j < operai.length; j++) {
    if (operai[j].email && operai[j].email.toLowerCase() === email) return operai[j];
  }
  return null;
}

// ---------------- Settimana lavorativa (Lunedi -> Sabato) ----------------
function isoData(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

// Restituisce il lunedi della settimana che contiene la data data (stringa
// "YYYY-MM-DD"), come oggetto Date.
function lunediSettimana(dataStr) {
  var d = new Date(dataStr + 'T12:00:00');
  var dow = d.getDay(); // 0=domenica ... 6=sabato
  var diff = (dow === 0) ? -6 : (1 - dow);
  d.setDate(d.getDate() + diff);
  return d;
}

// I 7 giorni Lunedi->Domenica della settimana corrente (o di una settimana
// prima/dopo, indicata da weekOffset in settimane: -1 = precedente, +1 =
// successiva, 0/omesso = quella di oggi), ciascuno con le informazioni utili
// per il rendering e per capire quali mesi (documenti po_planning) servono
// per coprirli tutti.
function giorniSettimanaCorrente(weekOffset) {
  weekOffset = weekOffset || 0;
  var oggi = oggiData();
  var lunedi = lunediSettimana(oggi);
  if (weekOffset) lunedi.setDate(lunedi.getDate() + weekOffset * 7);
  var giorni = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(lunedi.getTime());
    d.setDate(d.getDate() + i);
    var iso = isoData(d);
    giorni.push({
      iso: iso,
      mese: iso.substring(0, 7),
      giornoStr: iso.substring(8, 10),
      label: GIORNI_IT[d.getDay()],
      numero: d.getDate(),
      meseLabel: MESI_IT[d.getMonth()],
      anno: d.getFullYear(),
      oggi: iso === oggi
    });
  }
  return giorni;
}

// Elenco (senza doppioni) dei mesi "YYYY-MM" coinvolti dai giorni dati:
// di solito 1, ma 2 quando la settimana scavalca il cambio mese.
function mesiCoinvolti(giorni) {
  var visti = {}, out = [];
  for (var i = 0; i < giorni.length; i++) {
    if (!visti[giorni[i].mese]) { visti[giorni[i].mese] = true; out.push(giorni[i].mese); }
  }
  return out;
}

function intestazioneSettimana(giorni) {
  var primo = giorni[0], ultimo = giorni[giorni.length - 1];
  if (primo.mese === ultimo.mese) {
    return primo.numero + ' - ' + ultimo.numero + ' ' + ultimo.meseLabel + ' ' + ultimo.anno;
  }
  return primo.numero + ' ' + primo.meseLabel + ' - ' + ultimo.numero + ' ' + ultimo.meseLabel + ' ' + ultimo.anno;
}

// Costruisce l'HTML del contenuto di UN giorno (lavoro/nota/ticket) dato il
// valore grezzo della cella. Usata sia per la card di oggi che per le
// righe della settimana.
function renderizzaContenutoGiorno(raw) {
  var an = analizzaCella(raw || '');
  var corpo;
  if (!an.main) {
    corpo = '<div class="op-vuoto">Nessuna assegnazione.</div>';
  } else if (isSplitValue(an.main)) {
    var sp = splitValue(an.main);
    corpo =
      '<div class="op-turno"><div class="op-turno-label">☀️ Giorno</div><div class="op-turno-val ' + classeValore(sp.giorno) + '">' + (sp.giorno ? esc(sp.giorno) : '—') + '</div></div>' +
      '<div class="op-turno"><div class="op-turno-label">🌙 Sera</div><div class="op-turno-val ' + classeValore(sp.sera) + '">' + (sp.sera ? esc(sp.sera) : '—') + '</div></div>';
  } else {
    corpo = '<div class="op-lavoro ' + classeValore(an.main) + '">' + esc(an.main) + '</div>';
  }

  var notaHtml = an.nota ? '<div class="op-nota">⚠️ ' + esc(an.nota) + '</div>' : '';

  var mapsHtml = an.maps
    ? '<a class="btn btn-primary op-maps-btn" href="' + esc(an.maps) + '" target="_blank" rel="noopener">🗺️ Apri navigatore</a>'
    : '';

  var ticketHtml = '';
  if (an.ticket && an.ticket.length) {
    for (var ti = 0; ti < an.ticket.length; ti++) {
      var t = an.ticket[ti];
      var previewSrc = driveEmbedUrl(t.url);
      ticketHtml +=
        '<div class="op-ticket">' +
          '<div class="op-ticket-titolo">📎 ' + esc(t.nome || 'Ticket') + '</div>' +
          (previewSrc ? '<iframe class="op-ticket-frame" src="' + esc(previewSrc) + '" loading="lazy" allow="autoplay"></iframe>' : '') +
          '<a class="btn btn-primary op-ticket-btn" href="' + esc(t.url) + '" target="_blank" rel="noopener">Apri a schermo intero</a>' +
        '</div>';
    }
  }

  return corpo + notaHtml + mapsHtml + ticketHtml;
}

// Costruisce l'HTML della "scheda della settimana" (Lunedi -> Sabato) di un
// operaio: usata sia dalla vista non-admin dentro l'app di gestione, sia
// dall'app dedicata operaio/index.html.
// `cellePerMese` e' un oggetto { "YYYY-MM": { "<operaioId>_<GG>": "testo" } }
// - serve piu' di un mese quando la settimana scavalca il cambio mese.
function renderizzaSchedaSettimana(operaioTrovato, cellePerMese, emailUtente, weekOffset) {
  var giorni = giorniSettimanaCorrente(weekOffset);
  var intestazione = intestazioneSettimana(giorni);

  if (!operaioTrovato) {
    return '<div class="op-header">' + esc(intestazione) + '</div>' +
      '<div class="op-noaccount">' +
        '<p>👋 Ciao! Il tuo account (<strong>' + esc(emailUtente || '') + '</strong>) non è ancora collegato a nessun operaio del planning.</p>' +
        '<p class="hint">Chiedi all\'amministratore di collegare la tua email nella sezione Gestione → Operai (Planning Operai).</p>' +
      '</div>';
  }

  var righeGiorni = '';
  for (var i = 0; i < giorni.length; i++) {
    var g = giorni[i];
    var celleMese = cellePerMese[g.mese] || {};
    var raw = celleMese[operaioTrovato.id + '_' + g.giornoStr] || '';
    righeGiorni +=
      '<div class="op-day-card' + (g.oggi ? ' op-day-oggi' : '') + '">' +
        '<div class="op-day-head"><span class="op-day-label">' + esc(g.label) + ' ' + g.numero + '</span>' + (g.oggi ? '<span class="op-day-oggi-badge">OGGI</span>' : '') + '</div>' +
        renderizzaContenutoGiorno(raw) +
      '</div>';
  }

  return '<div class="op-header">' + esc(intestazione) + '</div>' +
    '<div class="op-nome">' + esc(operaioTrovato.nome) + '</div>' +
    righeGiorni;
}

function intestazioneOggi() {
  var oggi = oggiData();
  var d = new Date(oggi + 'T12:00:00');
  return GIORNI_IT[d.getDay()] + ' ' + d.getDate() + ' ' + MESI_IT[d.getMonth()] + ' ' + d.getFullYear();
}
