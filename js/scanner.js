// ============================================================
// Scanner ticket - foto -> ritaglio 4 angoli (correzione prospettica
// fatta a mano, senza librerie esterne) -> miglioramento automatico ->
// PDF -> upload.
// ============================================================

var scanState = {
  img: null,           // Image originale della foto in lavorazione (fase ritaglio)
  cropPts: null,       // 4 punti del ritaglio, in frazioni 0..1 dell'immagine mostrata (TL,TR,BR,BL)
  cropDragIdx: -1,
  // Un ticket puo' essere composto da piu' foto: ogni foto confermata diventa
  // una "pagina" del PDF finale. Ogni pagina tiene il suo canvas ritagliato
  // piu' rotazione e miglioramento, cosi' l'operaio puo' sistemarle una per una.
  pagine: [],          // [{ croppedCanvas, rotazione, modo }]
  pagCorrente: 0,      // indice della pagina mostrata nell'anteprima
  pdfDiretto: null,  // { base64, fileName } quando l'operaio carica direttamente un PDF gia' pronto (niente foto/ritaglio)
  unsubMieiTicket: null
};

// Pagina attualmente mostrata nell'anteprima (o null se non ce ne sono)
function paginaCorrente() {
  return scanState.pagine[scanState.pagCorrente] || null;
}

// Svuota tutto: usato all'annulla e dopo un caricamento riuscito
function azzeraScanner() {
  scanState.img = null;
  scanState.pagine = [];
  scanState.pagCorrente = 0;
  scanState.pdfDiretto = null;
}

// ---------------- Cambio scheda (Appuntamenti / Carica ticket) ----------------
(function () {
  var tabs = document.querySelectorAll('.op-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () {
      for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
      this.classList.add('active');
      var v = this.getAttribute('data-view');
      document.getElementById('viewSettimana').style.display = (v === 'settimana') ? '' : 'none';
      document.getElementById('viewScanner').style.display = (v === 'scanner') ? '' : 'none';
      if (v === 'scanner') avviaElencoMieiTicket();
    });
  }
})();

// ---------------- Cattura foto / caricamento file ----------------
function elaboraFotoOImmagine(dataUrl) {
  var img = new Image();
  img.onload = function () {
    scanState.img = img;
    // Un PDF caricato direttamente e le foto si escludono a vicenda
    scanState.pdfDiretto = null;
    avviaFaseRitaglio(dataUrl);
  };
  img.src = dataUrl;
}

// Riapre la fotocamera per aggiungere un'altra pagina allo stesso ticket
function riapriFotocamera() {
  document.getElementById('ticketCameraInput').click();
}

document.getElementById('ticketCameraInput').addEventListener('change', function () {
  var file = this.files && this.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () { elaboraFotoOImmagine(reader.result); };
  reader.readAsDataURL(file);
  this.value = '';
});

// Caricamento diretto di un file gia' pronto: se e' un'immagine passa dal
// ritaglio come una foto normale; se e' un PDF viene caricato cosi' com'e',
// senza ritaglio/miglioramento (non avrebbe senso su un PDF).
document.getElementById('ticketFileInput').addEventListener('change', function () {
  var file = this.files && this.files[0];
  if (!file) return;
  if (file.type === 'application/pdf') {
    var readerPdf = new FileReader();
    readerPdf.onload = function () {
      scanState.img = null;
      scanState.pagine = [];
      scanState.pagCorrente = 0;
      scanState.pdfDiretto = {
        base64: readerPdf.result.split(',')[1],
        fileName: file.name || ('ticket_' + Date.now() + '.pdf')
      };
      mostraAnteprimaPdfDiretto();
    };
    readerPdf.readAsDataURL(file);
  } else {
    var readerImg = new FileReader();
    readerImg.onload = function () { elaboraFotoOImmagine(readerImg.result); };
    readerImg.readAsDataURL(file);
  }
  this.value = '';
});

function mostraAnteprimaPdfDiretto() {
  document.getElementById('scannerVuoto').style.display = 'none';
  document.getElementById('scannerCrop').style.display = 'none';
  document.getElementById('scannerDomanda').style.display = 'none';
  document.getElementById('scannerAnteprima').style.display = 'block';
  document.getElementById('scannerCanvas').style.display = 'none';
  document.getElementById('scannerPagineNav').style.display = 'none';
  document.getElementById('btnScannerRuota').style.display = 'none';
  document.getElementById('scannerModi').style.display = 'none';
  // Su un PDF gia' pronto non ha senso aggiungere pagine fotografate
  document.getElementById('btnScannerAggiungi').style.display = 'none';
  document.getElementById('btnScannerEliminaPagina').style.display = 'none';
  var info = document.getElementById('pdfDirettoInfo');
  info.style.display = 'flex';
  info.textContent = '📄 ' + scanState.pdfDiretto.fileName;
  document.getElementById('scannerStatus').textContent = '';
  document.getElementById('scannerLuogo').value = '';
}

// ---------------- Fase 1: ritaglio a 4 angoli (correzione prospettica) ----------------
function avviaFaseRitaglio(dataUrl) {
  var cropImg = document.getElementById('cropImg');
  document.getElementById('scannerVuoto').style.display = 'none';
  document.getElementById('scannerAnteprima').style.display = 'none';
  document.getElementById('scannerDomanda').style.display = 'none';
  document.getElementById('scannerCrop').style.display = 'block';

  // Ogni scatto ha il suo numero: serve a non far scrivere i risultati di
  // un rilevamento partito in ritardo sopra una foto nel frattempo rifatta.
  scanState.scattoId = (scanState.scattoId || 0) + 1;
  scanState.utenteHaSpostato = false;
  var mioScatto = scanState.scattoId;
  var avviso = document.getElementById('cropStatus');

  function provaRilevamento() {
    // Se l'operaio ha gia' sistemato un angolo a mano, non glielo si tocca.
    if (scanState.scattoId !== mioScatto || scanState.utenteHaSpostato) return true;
    var auto = rilevaAngoliAutomatico(cropImg);
    if (auto) {
      scanState.cropPts = auto;
      renderCropOverlay();
      if (avviso) avviso.textContent = '';
      return true;
    }
    return false;
  }

  function inizializzaAngoli() {
    // Angoli di partenza: quasi ai bordi dell'inquadratura (TL, TR, BR, BL).
    // Prima erano rientrati del 6%: se il rilevamento automatico falliva e
    // l'operaio confermava senza aggiustare a mano, si perdeva un pezzo di
    // testo ai lati. Meglio partire quasi a tutto schermo (si vede un po'
    // di sfondo in piu', ma non si perde mai contenuto del foglio).
    scanState.cropPts = [
      { x: 0.02, y: 0.02 },
      { x: 0.98, y: 0.02 },
      { x: 0.98, y: 0.98 },
      { x: 0.02, y: 0.98 }
    ];
    renderCropOverlay();

    if (provaRilevamento()) return;

    // Qui il rilevamento non ha funzionato. Il caso piu' frequente e' che
    // OpenCV.js (circa 9 MB) non sia ancora arrivata: sotto rete mobile ci
    // mette qualche secondo, e prima di questa modifica restavano per
    // sempre i 4 angoli di default, come se il rilevamento non esistesse.
    // Quindi si riprova finche' la libreria non e' pronta.
    if (!window.cvPronto) {
      if (avviso) avviso.textContent = 'Ricerca automatica dei bordi in corso...';
      var tentativi = 0;
      var attesa = setInterval(function () {
        tentativi++;
        if (scanState.scattoId !== mioScatto || scanState.utenteHaSpostato) {
          clearInterval(attesa);
          return;
        }
        if (window.cvPronto) {
          clearInterval(attesa);
          if (!provaRilevamento() && avviso) {
            avviso.textContent = 'Bordi non riconosciuti: sistema i 4 angoli a mano.';
          }
        } else if (tentativi > 60) {     // ~18 secondi
          clearInterval(attesa);
          if (avviso) avviso.textContent = 'Bordi non riconosciuti: sistema i 4 angoli a mano.';
        }
      }, 300);
    } else if (avviso) {
      avviso.textContent = 'Bordi non riconosciuti: sistema i 4 angoli a mano.';
    }
  }

  cropImg.onload = inizializzaAngoli;
  cropImg.src = dataUrl;
  // Se l'immagine e' gia' in cache il browser puo' non richiamare onload
  // (o averlo gia' fatto prima di questo punto): controlliamo anche
  // "complete" come rete di sicurezza.
  if (cropImg.complete && cropImg.naturalWidth > 0) inizializzaAngoli();
}

// ============================================================
// RILEVAMENTO AUTOMATICO DEL FOGLIO (multi-strategia)
// ------------------------------------------------------------
// Invece di un solo tentativo con Canny, prova piu' modi diversi di
// trovare i bordi (soglie dalla mediana, soglie basse per fogli a basso
// contrasto, gradiente morfologico) e per ognuno cerca tutti i
// quadrilateri plausibili. Poi da' un punteggio a ogni candidato
// (quanto e' grande, quanto gli angoli sono vicini a 90 gradi, quanto i
// lati opposti si somigliano) e tiene il migliore. Cosi' il foglio viene
// trovato anche con poca luce, sfondo chiaro o foto storta.
// ============================================================

// Mediana della luminosita' (campionata): serve per calcolare le soglie
// di Canny sulla foto reale invece di usare numeri fissi.
function medianaLuminosita(mat) {
  var d = mat.data, n = d.length;
  var passo = Math.max(1, Math.floor(n / 20000));
  var campioni = [];
  for (var i = 0; i < n; i += passo) campioni.push(d[i]);
  campioni.sort(function (a, b) { return a - b; });
  return campioni.length ? campioni[Math.floor(campioni.length / 2)] : 128;
}

// Punteggio di un quadrilatero: piu' alto = piu' probabile che sia il foglio.
function punteggioQuadrilatero(pts, w, h) {
  var dist = function (a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); };

  // 1) Area occupata rispetto all'inquadratura: un foglio inquadrato
  // riempie una buona parte della foto.
  var area = Math.abs(
    (pts[0].x * pts[1].y - pts[1].x * pts[0].y) +
    (pts[1].x * pts[2].y - pts[2].x * pts[1].y) +
    (pts[2].x * pts[3].y - pts[3].x * pts[2].y) +
    (pts[3].x * pts[0].y - pts[0].x * pts[3].y)
  ) / 2;
  var frazioneArea = area / (w * h);
  if (frazioneArea < 0.12) return -1;            // troppo piccolo: non e' il foglio
  if (frazioneArea > 0.95) return -1;            // e' tutta l'inquadratura, non un foglio
  var pArea = Math.min(1, frazioneArea / 0.75);

  // Il bordo stesso della foto e' un rettangolo perfetto: angoli a 90 gradi,
  // lati identici, area massima. Senza questo controllo prendeva il
  // punteggio pieno e vinceva sul foglio vero. Si contano quindi gli angoli
  // "appiccicati" al bordo dell'inquadratura: un foglio fotografato ne ha
  // zero o al massimo uno (se sborda), il bordo della foto tutti e quattro.
  var margine = 0.012;
  var suBordo = 0;
  for (var k = 0; k < 4; k++) {
    if (pts[k].x <= w * margine || pts[k].x >= w * (1 - margine) ||
        pts[k].y <= h * margine || pts[k].y >= h * (1 - margine)) suBordo++;
  }
  if (suBordo >= 4) return -1;
  var pBordo = 1 - suBordo * 0.25;

  // 2) Angoli vicini a 90 gradi: un foglio fotografato resta un
  // quadrilatero con angoli quasi retti, il rumore no.
  var sommaCos = 0;
  for (var i = 0; i < 4; i++) {
    var p = pts[(i + 3) % 4], c = pts[i], n = pts[(i + 1) % 4];
    var v1x = p.x - c.x, v1y = p.y - c.y, v2x = n.x - c.x, v2y = n.y - c.y;
    var l1 = Math.sqrt(v1x * v1x + v1y * v1y), l2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (l1 < 1e-6 || l2 < 1e-6) return -1;
    sommaCos += Math.abs((v1x * v2x + v1y * v2y) / (l1 * l2));
  }
  var pAngoli = Math.max(0, 1 - (sommaCos / 4) / 0.5);

  // 3) Lati opposti di lunghezza simile (la prospettiva li accorcia un
  // po', ma non li stravolge).
  var sopra = dist(pts[0], pts[1]), sotto = dist(pts[3], pts[2]);
  var sin = dist(pts[0], pts[3]), des = dist(pts[1], pts[2]);
  if (Math.min(sopra, sotto, sin, des) < 20) return -1;
  var pLati = (Math.min(sopra, sotto) / Math.max(sopra, sotto) +
               Math.min(sin, des) / Math.max(sin, des)) / 2;

  return (0.45 * pArea + 0.35 * pAngoli + 0.20 * pLati) * pBordo;
}

// Estrae tutti i quadrilateri plausibili da una mappa di bordi binaria.
function candidatiDaMappaBordi(bordi, w, h, fuori) {
  var contours = new cv.MatVector(), hierarchy = new cv.Mat();
  try {
    cv.findContours(bordi, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    var epsilon = [0.015, 0.02, 0.03, 0.045];
    for (var i = 0; i < contours.size(); i++) {
      var cnt = contours.get(i);
      var peri = cv.arcLength(cnt, true);
      if (peri > 0) {
        for (var e = 0; e < epsilon.length; e++) {
          var approx = new cv.Mat();
          cv.approxPolyDP(cnt, approx, epsilon[e] * peri, true);
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            var d = approx.data32S, pts = [];
            for (var p = 0; p < 4; p++) pts.push({ x: d[p * 2], y: d[p * 2 + 1] });
            pts = ordinaAngoliQuadrilatero(pts);
            var punteggio = punteggioQuadrilatero(pts, w, h);
            if (punteggio > 0) fuori.push({ punteggio: punteggio, pts: pts });
          }
          approx.delete();
        }
        // Rete di sicurezza: il rettangolo ruotato che racchiude il
        // contorno. Non e' preciso come il quadrilatero, ma su un foglio
        // con un bordo interrotto e' meglio di niente.
        if (cv.contourArea(cnt) > w * h * 0.15) {
          var rr = cv.minAreaRect(cnt);
          var v = cv.RotatedRect.points(rr);
          var ptsR = ordinaAngoliQuadrilatero([
            { x: v[0].x, y: v[0].y }, { x: v[1].x, y: v[1].y },
            { x: v[2].x, y: v[2].y }, { x: v[3].x, y: v[3].y }
          ]);
          var pr = punteggioQuadrilatero(ptsR, w, h);
          // leggera penalita': e' un'approssimazione, non il bordo vero
          if (pr > 0) fuori.push({ punteggio: pr * 0.85, pts: ptsR });
        }
      }
      cnt.delete();
    }
  } catch (e) { /* strategia saltata */ }
  finally { contours.delete(); hierarchy.delete(); }
}

// Mappa "carta": invece di cercare i bordi, separa il foglio dallo sfondo
// per COLORE. La carta e' poco satura e chiara; un tavolo di legno, un
// cartoncino o una scrivania sono piu' saturi e/o piu' scuri. Su un foglio
// beige appoggiato su legno chiaro - dove il contrasto di luminosita' e'
// quasi nullo e le venature del legno sembrano bordi - questa e' l'unica
// strategia che trova il foglio.
// Restituisce la maschera binaria di partenza (bianco = probabile carta),
// da cui poi si ricavano le maschere con aperture diverse.
function punteggioCarta(piccola) {
  var rgb = null, hsv = null, lab = null, invS = null, sc = null, base = null;
  var canaliHsv = new cv.MatVector(), canaliLab = new cv.MatVector();
  try {
    rgb = new cv.Mat();
    cv.cvtColor(piccola, rgb, cv.COLOR_RGBA2RGB);
    hsv = new cv.Mat();
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    lab = new cv.Mat();
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    cv.split(hsv, canaliHsv);
    cv.split(lab, canaliLab);

    // poco saturo (255 - S) + chiaro (L), mezzo e mezzo
    invS = new cv.Mat();
    cv.bitwise_not(canaliHsv.get(1), invS);
    sc = new cv.Mat();
    cv.addWeighted(invS, 0.5, canaliLab.get(0), 0.5, 0, sc);
    cv.GaussianBlur(sc, sc, new cv.Size(0, 0), 3);

    // Otsu trova da solo la separazione fra carta e sfondo
    base = new cv.Mat();
    cv.threshold(sc, base, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    return base;
  } catch (e) {
    if (base) { base.delete(); }
    return null;
  } finally {
    if (rgb) rgb.delete();
    if (hsv) hsv.delete();
    if (lab) lab.delete();
    if (invS) invS.delete();
    if (sc) sc.delete();
    for (var i = 0; i < canaliHsv.size(); i++) canaliHsv.get(i).delete();
    for (var j = 0; j < canaliLab.size(); j++) canaliLab.get(j).delete();
    canaliHsv.delete();
    canaliLab.delete();
  }
}

// Apertura morfologica sulla maschera carta. La dimensione conta molto:
// serve a staccare il foglio da altre superfici chiare che lo toccano
// (il bordo del tavolo, un ripiano grigio). Troppo piccola non stacca
// niente, troppo grande rimangia il foglio: per questo se ne provano
// diverse e poi decide il punteggio.
function mascheraCarta(base, apertura, out) {
  var k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(apertura, apertura));
  try {
    cv.morphologyEx(base, out, cv.MORPH_OPEN, k);
  } finally { k.delete(); }
}

function rilevaAngoliAutomatico(img) {
  if (!window.cvPronto || typeof cv === 'undefined') return null;
  var src = null, piccola = null, gray = null, blur = null, carta = null;
  try {
    src = cv.imread(img);
    if (!src.cols || !src.rows) return null;

    // Si lavora su una copia ridotta: molto piu' veloce sul telefono e
    // meno sensibile al rumore della fotocamera. I punti finali sono
    // frazioni 0..1, quindi tornano validi sulla foto a piena risoluzione.
    var LATO = 900;
    var scala = Math.min(1, LATO / Math.max(src.cols, src.rows));
    piccola = new cv.Mat();
    cv.resize(src, piccola, new cv.Size(Math.max(1, Math.round(src.cols * scala)),
                                        Math.max(1, Math.round(src.rows * scala))), 0, 0, cv.INTER_AREA);
    var w = piccola.cols, h = piccola.rows;

    gray = new cv.Mat();
    cv.cvtColor(piccola, gray, cv.COLOR_RGBA2GRAY);
    blur = new cv.Mat();
    cv.bilateralFilter(gray, blur, 9, 50, 50);

    var med = medianaLuminosita(blur);
    var candidati = [];
    var kChiudi = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));

    // Due famiglie di strategie, i cui candidati finiscono nello stesso
    // calderone e vengono poi scelti dal punteggio:
    //  A) BORDI   - Canny con soglie dalla mediana, Canny a soglie basse,
    //               gradiente morfologico + Otsu. Vanno bene quando il
    //               foglio stacca dallo sfondo.
    //  B) COLORE  - segmentazione "carta" (poco satura e chiara) con tre
    //               aperture diverse. E' quella che salva i casi come il
    //               foglio beige sul tavolo di legno chiaro.
    var strategieBordi = [
      function (out) {
        cv.Canny(blur, out, Math.max(0, Math.round(med * 0.66)), Math.min(255, Math.round(med * 1.33)));
      },
      function (out) { cv.Canny(blur, out, 20, 70); },
      function (out) {
        var g = new cv.Mat();
        try {
          cv.morphologyEx(blur, g, cv.MORPH_GRADIENT, kChiudi);
          cv.threshold(g, out, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        } finally { g.delete(); }
      }
    ];

    for (var s = 0; s < strategieBordi.length; s++) {
      var bordi = new cv.Mat();
      try {
        strategieBordi[s](bordi);
        // Chiude i buchi nel bordo del foglio, altrimenti il contorno
        // si spezza e non viene piu' riconosciuto come quadrilatero.
        cv.morphologyEx(bordi, bordi, cv.MORPH_CLOSE, kChiudi);
        cv.dilate(bordi, bordi, kChiudi);
        candidatiDaMappaBordi(bordi, w, h, candidati);
      } catch (e) { /* strategia saltata */ }
      finally { bordi.delete(); }
    }
    kChiudi.delete();

    // B) segmentazione per colore. Qui NON si chiude ne' si dilata: servirebbe
    // solo a riattaccare il foglio a quello che gli sta intorno.
    carta = punteggioCarta(piccola);
    if (carta) {
      var aperture = [9, 15, 21];
      for (var a = 0; a < aperture.length; a++) {
        var mc = new cv.Mat();
        try {
          mascheraCarta(carta, aperture[a], mc);
          candidatiDaMappaBordi(mc, w, h, candidati);
        } catch (e) { /* strategia saltata */ }
        finally { mc.delete(); }
      }
    }

    if (!candidati.length) return null;
    candidati.sort(function (a, b) { return b.punteggio - a.punteggio; });
    var migliore = candidati[0];
    // Sotto questa soglia il risultato non e' affidabile: meglio lasciare
    // gli angoli di default che l'operaio aggiusta a mano.
    if (migliore.punteggio < 0.45) return null;

    var frazioni = migliore.pts.map(function (p) { return { x: p.x / w, y: p.y / h }; });
    return allargaLeggermente(frazioni, 0.008);
  } catch (e) {
    return null;
  } finally {
    if (src) src.delete();
    if (piccola) piccola.delete();
    if (gray) gray.delete();
    if (blur) blur.delete();
    if (carta) carta.delete();
  }
}

// Riordina 4 punti qualsiasi nell'ordine TL, TR, BR, BL (alto-sinistra,
// alto-destra, basso-destra, basso-sinistra), usando somma/differenza
// delle coordinate: e' il modo standard per farlo senza sapere in che
// ordine il contorno li ha restituiti.
function ordinaAngoliQuadrilatero(pts) {
  var somme = pts.map(function (p) { return p.x + p.y; });
  var diff = pts.map(function (p) { return p.x - p.y; });
  var tl = pts[somme.indexOf(Math.min.apply(null, somme))];
  var br = pts[somme.indexOf(Math.max.apply(null, somme))];
  var tr = pts[diff.indexOf(Math.max.apply(null, diff))];
  var bl = pts[diff.indexOf(Math.min.apply(null, diff))];
  return [tl, tr, br, bl];
}

// Allarga leggermente i 4 angoli rilevati verso l'esterno (rispetto al
// centro del quadrilatero): il contorno individuato tocca spesso il bordo
// esatto del foglio o e' anche un filo piu' interno, ed e' molto meglio
// avere un pelo di sfondo in piu' che tagliare via del testo vicino al bordo.
function allargaLeggermente(pts, margine) {
  var cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  var cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  return pts.map(function (p) {
    var dx = p.x - cx, dy = p.y - cy;
    return {
      x: Math.min(1, Math.max(0, p.x + dx * margine * 4)),
      y: Math.min(1, Math.max(0, p.y + dy * margine * 4))
    };
  });
}

function renderCropOverlay() {
  var stage = document.getElementById('cropStage');
  var img = document.getElementById('cropImg');
  var w = img.clientWidth, h = img.clientHeight;
  if (!w || !h) return;
  var pts = scanState.cropPts;

  var poly = document.getElementById('cropPoly');
  var pStr = pts.map(function (p) { return (p.x * w) + ',' + (p.y * h); }).join(' ');
  poly.setAttribute('points', pStr);

  var handles = stage.querySelectorAll('.crop-handle');
  for (var i = 0; i < handles.length; i++) {
    var idx = parseInt(handles[i].getAttribute('data-i'), 10);
    handles[i].style.left = (pts[idx].x * w) + 'px';
    handles[i].style.top = (pts[idx].y * h) + 'px';
  }
}

(function () {
  var stage = document.getElementById('cropStage');

  function posDaEvento(e) {
    var rect = stage.getBoundingClientRect();
    var cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    var cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    var x = (cx - rect.left) / rect.width;
    var y = (cy - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  stage.addEventListener('pointerdown', function (e) {
    if (!e.target.classList.contains('crop-handle')) return;
    scanState.cropDragIdx = parseInt(e.target.getAttribute('data-i'), 10);
    // da qui in poi il rilevamento automatico non sovrascrive piu' gli angoli
    scanState.utenteHaSpostato = true;
    e.target.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener('pointermove', function (e) {
    if (scanState.cropDragIdx < 0) return;
    var p = posDaEvento(e);
    scanState.cropPts[scanState.cropDragIdx] = p;
    renderCropOverlay();
    e.preventDefault();
  });
  function fine(e) { scanState.cropDragIdx = -1; }
  stage.addEventListener('pointerup', fine);
  stage.addEventListener('pointercancel', fine);

  window.addEventListener('resize', function () {
    if (scanState.cropPts && document.getElementById('scannerCrop').style.display !== 'none') renderCropOverlay();
  });
})();

document.getElementById('btnCropAnnulla').addEventListener('click', function () {
  document.getElementById('scannerCrop').style.display = 'none';
  document.getElementById('cropStatus').textContent = '';
  scanState.img = null;
  // Se ci sono gia' pagine confermate si torna alla loro anteprima,
  // altrimenti alla schermata iniziale.
  if (scanState.pagine.length > 0) {
    mostraAnteprimaPagine();
  } else {
    document.getElementById('scannerVuoto').style.display = '';
  }
});

// ============================================================
// CORREZIONE PROSPETTICA (omografia vera)
// ------------------------------------------------------------
// Prima questo passaggio spezzava il quadrilatero in 2 triangoli e
// applicava a ognuno una trasformazione affine. E' una scorciatoia che
// NON e' una correzione prospettica: lungo la diagonale che divide i due
// triangoli il testo si piega e le righe si spezzano, ed e' il motivo
// principale per cui le scansioni venivano peggiori di quelle di un
// programma dedicato.
// Ora si usa l'omografia (getPerspectiveTransform + warpPerspective),
// cioe' la trasformazione matematicamente corretta per raddrizzare un
// piano fotografato di sbieco: la stessa cosa che fanno i programmi di
// scansione. Il metodo a triangoli resta solo come riserva se OpenCV
// non e' disponibile.
// ============================================================
function correggiProspettiva(img, ptsFrazioni) {
  var src = ptsFrazioni.map(function (p) {
    return { x: p.x * img.naturalWidth, y: p.y * img.naturalHeight };
  });

  var dist = function (a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); };
  var larghezza = Math.round(Math.max(dist(src[0], src[1]), dist(src[3], src[2])));
  var altezza = Math.round(Math.max(dist(src[0], src[3]), dist(src[1], src[2])));
  // Risoluzione finale: su un A4 pieno ~3000 px sul lato lungo sono circa
  // 260 DPI, abbondanti per leggere un ticket scritto a mano e per l'OCR.
  var MAX_LATO = 3000;
  var scala = Math.min(1, MAX_LATO / Math.max(larghezza, altezza));
  larghezza = Math.max(1, Math.round(larghezza * scala));
  altezza = Math.max(1, Math.round(altezza * scala));

  var out = document.createElement('canvas');
  out.width = larghezza;
  out.height = altezza;

  if (window.cvPronto && typeof cv !== 'undefined') {
    var mSrc = null, mDst = null, M = null, pSrc = null, pDst = null;
    try {
      mSrc = cv.imread(img);
      pSrc = cv.matFromArray(4, 1, cv.CV_32FC2, [
        src[0].x, src[0].y, src[1].x, src[1].y, src[2].x, src[2].y, src[3].x, src[3].y
      ]);
      pDst = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0, larghezza, 0, larghezza, altezza, 0, altezza
      ]);
      M = cv.getPerspectiveTransform(pSrc, pDst);
      mDst = new cv.Mat();
      // INTER_CUBIC: interpolazione piu' morbida della lineare, mantiene
      // leggibili i tratti sottili della penna.
      cv.warpPerspective(mSrc, mDst, M, new cv.Size(larghezza, altezza),
        cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
      cv.imshow(out, mDst);
      return out;
    } catch (e) {
      // continua con il metodo di riserva sotto
    } finally {
      if (mSrc) mSrc.delete();
      if (mDst) mDst.delete();
      if (M) M.delete();
      if (pSrc) pSrc.delete();
      if (pDst) pDst.delete();
    }
  }

  // Riserva senza OpenCV: vecchio metodo a 2 triangoli affini.
  var octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  var dst = [
    { x: 0, y: 0 }, { x: larghezza, y: 0 }, { x: larghezza, y: altezza }, { x: 0, y: altezza }
  ];
  disegnaTriangoloProspettico(octx, img, src[0], src[1], src[3], dst[0], dst[1], dst[3]);
  disegnaTriangoloProspettico(octx, img, src[1], src[2], src[3], dst[1], dst[2], dst[3]);
  return out;
}

document.getElementById('btnCropConferma').addEventListener('click', function () {
  var img = scanState.img;
  var pts = scanState.cropPts;
  if (!img || !pts) return;
  // Raddrizzare e migliorare a piena risoluzione richiede un attimo: si
  // mostra l'avviso e si lascia al browser il tempo di disegnarlo prima
  // di bloccarsi sul calcolo.
  var attesa = document.getElementById('cropStatus');
  if (attesa) attesa.textContent = 'Elaborazione della scansione...';
  setTimeout(function () {
    var out = correggiProspettiva(img, pts);
    if (attesa) attesa.textContent = '';
    // La foto raddrizzata diventa una nuova pagina del ticket. Parte in
    // modo "Magico" (il piu' simile a una scansione vera); l'operaio puo'
    // cambiare modo dall'anteprima di quella pagina.
    scanState.pagine.push({ croppedCanvas: out, rotazione: 0, modo: 'magico' });
    scanState.pagCorrente = scanState.pagine.length - 1;
    scanState.img = null;
    // Il luogo si azzera solo quando si comincia un ticket nuovo, non fra le
    // pagine dello stesso ticket (altrimenti l'operaio dovrebbe riscriverlo).
    if (scanState.pagine.length === 1) document.getElementById('scannerLuogo').value = '';
    document.getElementById('scannerCrop').style.display = 'none';
    document.getElementById('scannerStatus').textContent = '';
    // Chiede subito se aggiungere un'altra foto allo stesso ticket
    mostraDomandaAltraFoto();
  }, 30);
});

// ---------------- Domanda "altra foto?" dopo ogni scatto ----------------
function mostraDomandaAltraFoto() {
  document.getElementById('scannerVuoto').style.display = 'none';
  document.getElementById('scannerCrop').style.display = 'none';
  document.getElementById('scannerAnteprima').style.display = 'none';
  document.getElementById('scannerDomanda').style.display = 'block';
  var n = scanState.pagine.length;
  document.getElementById('scannerDomandaTesto').textContent =
    n === 1 ? 'Foto 1 aggiunta al ticket.' : ('Foto ' + n + ' aggiunta: il ticket ha ora ' + n + ' pagine.');
}

document.getElementById('btnAltraFotoSi').addEventListener('click', function () {
  document.getElementById('scannerDomanda').style.display = 'none';
  riapriFotocamera();
});

document.getElementById('btnAltraFotoNo').addEventListener('click', function () {
  document.getElementById('scannerDomanda').style.display = 'none';
  mostraAnteprimaPagine();
});

// ---------------- Anteprima delle pagine fotografate ----------------
function mostraAnteprimaPagine() {
  if (scanState.pagine.length === 0) {
    document.getElementById('scannerAnteprima').style.display = 'none';
    document.getElementById('scannerVuoto').style.display = '';
    return;
  }
  if (scanState.pagCorrente > scanState.pagine.length - 1) scanState.pagCorrente = scanState.pagine.length - 1;
  if (scanState.pagCorrente < 0) scanState.pagCorrente = 0;

  document.getElementById('scannerVuoto').style.display = 'none';
  document.getElementById('scannerCrop').style.display = 'none';
  document.getElementById('scannerDomanda').style.display = 'none';
  document.getElementById('scannerAnteprima').style.display = 'block';
  document.getElementById('scannerCanvas').style.display = '';
  document.getElementById('btnScannerRuota').style.display = '';
  document.getElementById('scannerModi').style.display = '';
  document.getElementById('btnScannerAggiungi').style.display = '';
  document.getElementById('pdfDirettoInfo').style.display = 'none';

  var piuPagine = scanState.pagine.length > 1;
  document.getElementById('scannerPagineNav').style.display = piuPagine ? 'flex' : 'none';
  document.getElementById('btnScannerEliminaPagina').style.display = piuPagine ? '' : 'none';
  document.getElementById('scannerPagineInfo').textContent =
    'Pagina ' + (scanState.pagCorrente + 1) + ' di ' + scanState.pagine.length;

  var pag = paginaCorrente();
  aggiornaBottoniModo();
  disegnaCanvas();
}

document.getElementById('btnPagPrec').addEventListener('click', function () {
  if (scanState.pagCorrente > 0) { scanState.pagCorrente--; mostraAnteprimaPagine(); }
});
document.getElementById('btnPagSucc').addEventListener('click', function () {
  if (scanState.pagCorrente < scanState.pagine.length - 1) { scanState.pagCorrente++; mostraAnteprimaPagine(); }
});

document.getElementById('btnScannerAggiungi').addEventListener('click', function () {
  riapriFotocamera();
});

document.getElementById('btnScannerEliminaPagina').addEventListener('click', function () {
  if (scanState.pagine.length <= 1) return;
  scanState.pagine.splice(scanState.pagCorrente, 1);
  if (scanState.pagCorrente > scanState.pagine.length - 1) scanState.pagCorrente = scanState.pagine.length - 1;
  mostraAnteprimaPagine();
});

// Disegna un triangolo dell'immagine sorgente deformato (mappatura affine)
// nel triangolo di destinazione: e' la tecnica standard per ottenere una
// correzione prospettica su <canvas> senza librerie (si divide il
// quadrilatero in 2 triangoli e si applica una trasformazione affine a testa).
function disegnaTriangoloProspettico(ctx, img, s0, s1, s2, d0, d1, d2) {
  var denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (!denom) return;

  var a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
  var c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
  var e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denom;
  var b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
  var d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
  var f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denom;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// ---------------- Disegna sul canvas tenendo conto della rotazione ----------------
function disegnaCanvas() {
  var pag = paginaCorrente();
  if (!pag) return;
  renderizzaPagina(pag, document.getElementById('scannerCanvas'));
}

// Disegna una pagina (con la sua rotazione e il suo miglioramento) sul canvas
// indicato. Usata sia per l'anteprima a schermo sia, su canvas temporanei,
// per generare le pagine del PDF finale.
function renderizzaPagina(pag, canvas, maxLato) {
  var img = pag.croppedCanvas;
  if (!img) return;
  var ctx = canvas.getContext('2d');
  var ruotato90 = (pag.rotazione === 90 || pag.rotazione === 270);

  // Limita la dimensione massima per non appesantire troppo il telefono.
  // Chi genera il PDF puo' chiedere una dimensione piu' bassa se il file
  // finale viene troppo pesante da caricare.
  var MAX_LATO = maxLato || 2600;
  var scala = Math.min(1, MAX_LATO / Math.max(img.width, img.height));
  var w = Math.round(img.width * scala);
  var h = Math.round(img.height * scala);

  canvas.width = ruotato90 ? h : w;
  canvas.height = ruotato90 ? w : h;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(pag.rotazione * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();

  applicaModo(ctx, canvas.width, canvas.height, pag.modo || 'magico');
}

document.getElementById('btnScannerRuota').addEventListener('click', function () {
  var pag = paginaCorrente();
  if (!pag) return;
  pag.rotazione = (pag.rotazione + 90) % 360;
  disegnaCanvas();
});

// Scelta del modo di scansione della pagina mostrata
(function () {
  var bottoni = document.querySelectorAll('.scanner-modo');
  for (var i = 0; i < bottoni.length; i++) {
    bottoni[i].addEventListener('click', function () {
      var pag = paginaCorrente();
      if (!pag) return;
      pag.modo = this.getAttribute('data-modo');
      aggiornaBottoniModo();
      var stato = document.getElementById('scannerStatus');
      stato.className = 'hint';
      stato.textContent = 'Elaborazione...';
      // lascia disegnare l'avviso prima del calcolo, che blocca la pagina
      setTimeout(function () { disegnaCanvas(); stato.textContent = ''; }, 30);
    });
  }
})();

function aggiornaBottoniModo() {
  var pag = paginaCorrente();
  var modo = pag ? (pag.modo || 'magico') : 'magico';
  var bottoni = document.querySelectorAll('.scanner-modo');
  for (var i = 0; i < bottoni.length; i++) {
    bottoni[i].classList.toggle('attivo', bottoni[i].getAttribute('data-modo') === modo);
  }
}

document.getElementById('btnScannerAnnulla').addEventListener('click', function () {
  azzeraScanner();
  document.getElementById('scannerVuoto').style.display = '';
  document.getElementById('scannerAnteprima').style.display = 'none';
  document.getElementById('scannerDomanda').style.display = 'none';
  document.getElementById('scannerStatus').textContent = '';
});

// ============================================================
// MIGLIORAMENTO IMMAGINE - 4 modi come i programmi di scansione
// ------------------------------------------------------------
// Il passaggio chiave e' la normalizzazione dell'illuminazione: si stima
// lo sfondo del foglio (la luce, le ombre, il grigio del cartoncino) e si
// divide l'immagine per quello sfondo. Il risultato e' un foglio bianco
// uniforme con il testo intatto, anche con l'ombra della mano, foto
// scattata di sera o luce da una sola finestra. E' la tecnica della
// divisione per il fondo ("rolling ball"), usata da tutti gli scanner da
// foto: nella libreria di CamScanner la funzione corrispondente si chiama
// infatti DenoiseColorImageBasedOnRollBall.
//
// Modi disponibili:
//   originale -> nessuna elaborazione
//   magico    -> colore con fondo bianco e ombre rimosse (default)
//   grigio    -> scala di grigi normalizzata, buona per fogli stampati
//   bn        -> bianco/nero netto, file piu' leggero, massima leggibilita'
// ============================================================

// Stima lo sfondo dell'immagine (la componente di illuminazione lenta).
// Si lavora su una miniatura: molto piu' veloce e il risultato e' lo
// stesso, perche' quello che interessa sono le variazioni larghe.
function stimaSfondo(src) {
  var pic = new cv.Mat(), chiuso = new cv.Mat(), sfocato = new cv.Mat(), grande = new cv.Mat(), k = null;
  try {
    var f = 8;
    cv.resize(src, pic, new cv.Size(Math.max(8, Math.round(src.cols / f)),
                                    Math.max(8, Math.round(src.rows / f))), 0, 0, cv.INTER_AREA);
    // La chiusura morfologica "riempie" il testo e lascia solo il fondo:
    // il nucleo deve essere piu' grande dello spessore delle lettere.
    k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(21, 21));
    cv.morphologyEx(pic, chiuso, cv.MORPH_CLOSE, k);
    cv.GaussianBlur(chiuso, sfocato, new cv.Size(0, 0), 7);
    cv.resize(sfocato, grande, new cv.Size(src.cols, src.rows), 0, 0, cv.INTER_LINEAR);
    return grande;
  } finally {
    pic.delete(); chiuso.delete(); sfocato.delete();
    if (k) k.delete();
  }
}

// Maschera di contrasto (unsharp mask): ridisegna i contorni delle
// lettere senza inventare dettagli, come la nitidezza di uno scanner.
function applicaNitidezza(mat, forza) {
  var b = new cv.Mat();
  try {
    cv.GaussianBlur(mat, b, new cv.Size(0, 0), 1.2);
    cv.addWeighted(mat, 1 + forza, b, -forza, 0, mat);
  } finally { b.delete(); }
}

function applicaModo(ctx, w, h, modo) {
  if (!modo || modo === 'originale') return;

  if (window.cvPronto && typeof cv !== 'undefined') {
    var src = null, rgb = null, sfondo = null, norm = null, gray = null,
        finale = null, rgba = null, clahe = null, tmp = null, pulito = null;
    try {
      src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
      rgb = new cv.Mat();
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

      // --- Normalizzazione dell'illuminazione (toglie ombre e ingiallimenti) ---
      sfondo = stimaSfondo(rgb);
      norm = new cv.Mat();
      cv.divide(rgb, sfondo, norm, 255);

      if (modo === 'magico') {
        // Colore conservato (timbri, firme e penna blu restano blu) ma su
        // fondo bianco, con un po' di contrasto e nitidezza.
        norm.convertTo(norm, -1, 1.15, -12);
        applicaNitidezza(norm, 0.6);
        finale = norm;
      } else {
        gray = new cv.Mat();
        cv.cvtColor(norm, gray, cv.COLOR_RGB2GRAY);

        if (modo === 'grigio') {
          // CLAHE leggero: contrasto locale, utile su scrittura a matita
          // o penna chiara, senza amplificare troppo il rumore.
          tmp = new cv.Mat();
          clahe = new cv.CLAHE(1.6, new cv.Size(8, 8));
          clahe.apply(gray, tmp);
          applicaNitidezza(tmp, 0.5);
          finale = tmp;
        } else {
          // bn: soglia adattiva, blocco proporzionato alla risoluzione
          // (un blocco fisso su foto grandi sporca il risultato).
          // ATTENZIONE: bilateralFilter di OpenCV non puo' lavorare
          // "in-place" (stessa Mat in ingresso e in uscita): serve una Mat
          // separata, altrimenti il risultato esce corrotto.
          pulito = new cv.Mat();
          cv.bilateralFilter(gray, pulito, 7, 50, 50);
          tmp = new cv.Mat();
          var blocco = Math.round(Math.min(w, h) / 18);
          if (blocco < 21) blocco = 21;
          if (blocco % 2 === 0) blocco++;
          cv.adaptiveThreshold(pulito, tmp, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, blocco, 12);
          // Toglie i puntini neri isolati rimasti, senza intaccare le
          // lettere che sono tratti continui piu' grandi.
          finale = new cv.Mat();
          cv.medianBlur(tmp, finale, 3);
        }
      }

      rgba = new cv.Mat();
      cv.cvtColor(finale, rgba, finale.channels() === 1 ? cv.COLOR_GRAY2RGBA : cv.COLOR_RGB2RGBA);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), w, h), 0, 0);
      return;
    } catch (e) {
      // se qualcosa va storto si continua con il metodo di riserva sotto
    } finally {
      if (src) src.delete();
      if (rgb) rgb.delete();
      if (sfondo) sfondo.delete();
      if (norm && norm !== finale) norm.delete();
      if (gray) gray.delete();
      if (tmp && tmp !== finale) tmp.delete();
      if (pulito && pulito !== finale) pulito.delete();
      if (finale) finale.delete();
      if (rgba) rgba.delete();
      if (clahe) clahe.delete();
    }
  }

  // ---- Riserva senza OpenCV: grigio + stiramento del contrasto ----
  var imgData = ctx.getImageData(0, 0, w, h);
  var d = imgData.data;
  var min = 255, max = 0;
  for (var i = 0; i < d.length; i += 4) {
    var g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (modo !== 'magico') d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  var range = Math.max(1, max - min);
  for (var j = 0; j < d.length; j += 4) {
    for (var c = 0; c < 3; c++) {
      var v = (d[j + c] - min) * (255 / range);
      v = Math.pow(Math.max(0, Math.min(255, v)) / 255, 0.85) * 255;
      if (modo === 'bn') v = v > 150 ? 255 : 0;
      d[j + c] = v;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// Costruisce il PDF con tutte le pagine del ticket e lo restituisce in
// base64. lato = dimensione massima del lato lungo di ogni pagina,
// qualita = qualita' JPEG (il modo bianco/nero usa comunque il PNG).
function costruisciPdfPagine(lato, qualita) {
  var jsPDFCtor = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
  var pdf = null;
  // Ogni foto confermata diventa una pagina del PDF, nell'ordine in cui
  // e' stata scattata. Ogni pagina ha la dimensione della sua immagine,
  // cosi' non viene mai deformata o tagliata.
  for (var p = 0; p < scanState.pagine.length; p++) {
    var tmp = document.createElement('canvas');
    renderizzaPagina(scanState.pagine[p], tmp, lato);
    var orientamento = tmp.width >= tmp.height ? 'l' : 'p';
    if (!pdf) {
      // compress: true e' decisivo. Senza, jsPDF scrive le immagini PNG nel
      // PDF praticamente non compresse: una pagina in bianco/nero passava
      // da 20 KB a 3,7 MB, e il caricamento di un ticket di piu' pagine
      // andava in errore. Sulle pagine JPEG non cambia nulla.
      pdf = new jsPDFCtor({ orientation: orientamento, unit: 'px', format: [tmp.width, tmp.height], compress: true });
    } else {
      pdf.addPage([tmp.width, tmp.height], orientamento);
    }
    // In bianco/nero il PNG e' piu' nitido del JPEG (niente artefatti
    // attorno alle lettere); negli altri modi il JPEG tiene il file in
    // dimensioni ragionevoli.
    if (scanState.pagine[p].modo === 'bn') {
      pdf.addImage(tmp.toDataURL('image/png'), 'PNG', 0, 0, tmp.width, tmp.height);
    } else {
      pdf.addImage(tmp.toDataURL('image/jpeg', qualita), 'JPEG', 0, 0, tmp.width, tmp.height);
    }
  }
  return pdf.output('datauristring').split(',')[1];
}

// ---------------- Caricamento su Drive ----------------
document.getElementById('btnScannerCarica').addEventListener('click', function () {
  if (scanState.pagine.length === 0 && !scanState.pdfDiretto) return;
  var stato = document.getElementById('scannerStatus');

  if (!CARICA_TICKET_OPERAIO_URL) {
    stato.className = 'hint';
    stato.textContent = 'Caricamento non ancora configurato (manca l\'indirizzo della Cloud Function).';
    return;
  }
  if (!opState.user) {
    stato.className = 'hint';
    stato.textContent = 'Devi essere loggato.';
    return;
  }

  var op = trovaOperaioPerUtente(opState.operai, opState.user);
  if (!op) {
    stato.className = 'hint';
    stato.textContent = 'Il tuo account non e\' ancora collegato a un operaio del planning.';
    return;
  }

  var luogo = (document.getElementById('scannerLuogo').value || '').trim();
  if (!luogo) {
    stato.className = 'result-msg err';
    stato.textContent = 'Scrivi il luogo/cantiere dell\'intervento prima di caricare.';
    document.getElementById('scannerLuogo').focus();
    return;
  }

  var nomeFile = luogo.replace(/[^a-z0-9]+/gi, '_') + '_' + Date.now() + '.pdf';

  try {
    var pdfBase64;
    if (scanState.pdfDiretto) {
      // File PDF caricato cosi' com'e', nessuna elaborazione da fare
      pdfBase64 = scanState.pdfDiretto.base64;
      stato.className = 'hint';
      stato.textContent = 'Caricamento in corso...';
    } else {
      stato.className = 'hint';
      stato.textContent = scanState.pagine.length > 1
        ? ('Preparazione PDF (' + scanState.pagine.length + ' pagine)...')
        : 'Preparazione PDF...';
      // Il PDF viaggia in base64 dentro una richiesta HTTP: se e' troppo
      // grande il caricamento fallisce (soprattutto con piu' pagine e sotto
      // rete mobile). Si parte dalla qualita' piena e, solo se il file
      // supera il limite, si riprova con risoluzione e compressione piu'
      // basse finche' non rientra.
      var tentativi = [
        { lato: 2600, qualita: 0.95 },
        { lato: 2100, qualita: 0.88 },
        { lato: 1700, qualita: 0.82 },
        { lato: 1400, qualita: 0.75 }
      ];
      var LIMITE_BYTE = 7 * 1024 * 1024;
      pdfBase64 = null;
      for (var t = 0; t < tentativi.length; t++) {
        pdfBase64 = costruisciPdfPagine(tentativi[t].lato, tentativi[t].qualita);
        if (pdfBase64.length * 0.75 <= LIMITE_BYTE) break;
        if (t < tentativi.length - 1) {
          stato.textContent = 'Il file e\' pesante: riduco per il caricamento...';
        }
      }
      stato.textContent = 'Caricamento in corso...';
    }
    opState.user.getIdToken().then(function (idToken) {
      return fetch(CARICA_TICKET_OPERAIO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
        body: JSON.stringify({
          fileName: nomeFile,
          fileBase64: pdfBase64,
          operaioId: op.id,
          operaioNome: op.nome,
          luogo: luogo
        })
      });
    }).then(function (res) { return res.json(); })
      .then(function (r) {
        if (r && r.ok) {
          stato.className = 'result-msg ok';
          stato.textContent = 'Ticket caricato correttamente.';
          azzeraScanner();
          document.getElementById('scannerVuoto').style.display = '';
          document.getElementById('scannerAnteprima').style.display = 'none';
          document.getElementById('scannerDomanda').style.display = 'none';
        } else {
          stato.className = 'result-msg err';
          stato.textContent = 'Errore durante il caricamento (' + (r && r.error ? r.error : 'risposta non valida') + ').';
        }
      })
      .catch(function () {
        stato.className = 'result-msg err';
        stato.textContent = 'Errore di connessione durante il caricamento.';
      });
  } catch (e) {
    stato.className = 'result-msg err';
    stato.textContent = 'Errore nella preparazione del PDF: ' + e.message;
  }
});

// ---------------- Elenco dei ticket gia' caricati da questo operaio ----------------
function avviaElencoMieiTicket() {
  if (scanState.unsubMieiTicket) return;
  var op = trovaOperaioPerUtente(opState.operai, opState.user);
  if (!op) return;
  scanState.unsubMieiTicket = db.collection('po_ticket_caricati')
    .where('operaioId', '==', op.id)
    .onSnapshot(function (snap) {
      var righe = [];
      var limite24h = Date.now() - (24 * 60 * 60 * 1000);
      snap.forEach(function (doc) {
        var d = doc.data();
        // Cronologia solo delle ultime 24 ore lato operaio (per non riempire
        // lo schermo): i ticket restano comunque per sempre nel database e
        // nella pagina amministrazione, qui si "auto-puliscono" solo dalla vista.
        var ms = d.timestamp && d.timestamp.toMillis ? d.timestamp.toMillis() : 0;
        if (ms >= limite24h) righe.push(d);
      });
      righe.sort(function (a, b) {
        var ta = a.timestamp && a.timestamp.toMillis ? a.timestamp.toMillis() : 0;
        var tb = b.timestamp && b.timestamp.toMillis ? b.timestamp.toMillis() : 0;
        return tb - ta;
      });
      renderizzaElencoMieiTicket(righe);
    }, function () { /* niente indice o niente permessi: ignora silenziosamente */ });
}

function renderizzaElencoMieiTicket(righe) {
  var el = document.getElementById('scannerElenco');
  if (!righe || righe.length === 0) {
    el.innerHTML = '<p class="hint" style="margin-top:18px;">Nessun ticket caricato nelle ultime 24 ore.</p>';
    return;
  }
  var html = '<h3 class="scanner-elenco-titolo">Caricati nelle ultime 24 ore</h3>';
  for (var i = 0; i < righe.length; i++) {
    var r = righe[i];
    var data = r.timestamp && r.timestamp.toDate ? r.timestamp.toDate() : null;
    var dataStr = data ? (pad2(data.getDate()) + '/' + pad2(data.getMonth() + 1) + '/' + data.getFullYear()) : '';
    html += '<a class="scanner-item" href="' + esc(r.url || '#') + '" target="_blank" rel="noopener">' +
      '<span class="scanner-item-nome">📄 ' + esc(r.luogo || r.fileName || 'Ticket') + '</span>' +
      '<span class="scanner-item-data">' + esc(dataStr) + '</span>' +
      '</a>';
  }
  el.innerHTML = html;
}
