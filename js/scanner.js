// ============================================================
// Scanner ticket - foto -> ritaglio 4 angoli (correzione prospettica
// fatta a mano, senza librerie esterne) -> miglioramento automatico ->
// PDF -> upload.
// ============================================================

var scanState = {
  img: null,           // Image originale caricata
  croppedCanvas: null, // canvas con la prospettiva gia' corretta (dopo il ritaglio)
  cropPts: null,       // 4 punti del ritaglio, in frazioni 0..1 dell'immagine mostrata (TL,TR,BR,BL)
  cropDragIdx: -1,
  rotazione: 0,      // 0, 90, 180, 270
  migliorata: false,
  pdfDiretto: null,  // { base64, fileName } quando l'operaio carica direttamente un PDF gia' pronto (niente foto/ritaglio)
  unsubMieiTicket: null
};

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
    scanState.croppedCanvas = null;
    scanState.pdfDiretto = null;
    scanState.rotazione = 0;
    scanState.migliorata = false;
    avviaFaseRitaglio(dataUrl);
  };
  img.src = dataUrl;
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
      scanState.croppedCanvas = null;
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
  document.getElementById('scannerAnteprima').style.display = 'block';
  document.getElementById('scannerCanvas').style.display = 'none';
  document.getElementById('btnScannerRuota').style.display = 'none';
  document.getElementById('btnScannerMigliora').style.display = 'none';
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
  document.getElementById('scannerCrop').style.display = 'block';

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
    // Se OpenCV.js e' pronta proviamo il rilevamento automatico del foglio
    // (i 4 angoli restano comunque trascinabili a mano dopo, per correggere).
    var auto = rilevaAngoliAutomatico(cropImg);
    if (auto) scanState.cropPts = auto;
    renderCropOverlay();
  }

  cropImg.onload = inizializzaAngoli;
  cropImg.src = dataUrl;
  // Se l'immagine e' gia' in cache il browser puo' non richiamare onload
  // (o averlo gia' fatto prima di questo punto): controlliamo anche
  // "complete" come rete di sicurezza.
  if (cropImg.complete && cropImg.naturalWidth > 0) inizializzaAngoli();
}

// Rileva automaticamente i 4 angoli del foglio nella foto usando OpenCV.js
// (bordi con Canny + ricerca del contorno a 4 lati piu' grande). Ritorna
// i punti come frazioni 0..1 dell'immagine, in ordine TL,TR,BR,BL, oppure
// null se OpenCV non e' ancora pronta o non trova nulla di affidabile
// (in quel caso restano gli angoli di default, regolabili a mano).
function rilevaAngoliAutomatico(img) {
  if (!window.cvPronto || typeof cv === 'undefined') return null;
  var src, gray, edged, kernel, contours, hierarchy;
  var migliore = null;
  try {
    src = cv.imread(img);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    // Soglie di Canny calcolate sulla luminosita' media della foto (invece
    // di valori fissi 50/150): con poca luce o forte controluce due soglie
    // fisse spesso non trovavano il bordo giusto del foglio.
    var media = cv.mean(gray)[0];
    var basso = Math.max(0, Math.round(media * 0.66));
    var alto = Math.min(255, Math.round(media * 1.33));
    edged = new cv.Mat();
    cv.Canny(gray, edged, basso, alto);
    kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edged, edged, kernel);
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    // RETR_EXTERNAL: interessano solo i contorni piu' esterni (il bordo del
    // foglio), non quelli interni (testo, tabelle, timbri...).
    cv.findContours(edged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    var areaImg = src.rows * src.cols;
    var areaMigliore = 0;
    for (var i = 0; i < contours.size(); i++) {
      var cnt = contours.get(i);
      var peri = cv.arcLength(cnt, true);
      var approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      // Il foglio deve essere un quadrilatero convesso che occupa una
      // porzione consistente dell'inquadratura: cosi' si scarta sia il
      // rumore piccolo sia forme irregolari/concave che non sono un foglio.
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        var area = Math.abs(cv.contourArea(approx));
        if (area > areaMigliore && area > areaImg * 0.25) {
          areaMigliore = area;
          if (migliore) migliore.delete();
          migliore = approx.clone();
        }
      }
      approx.delete();
      cnt.delete();
    }

    var risultato = null;
    if (migliore) {
      var data = migliore.data32S;
      var pts = [];
      for (var p = 0; p < 4; p++) {
        pts.push({ x: data[p * 2] / src.cols, y: data[p * 2 + 1] / src.rows });
      }
      risultato = ordinaAngoliQuadrilatero(pts);
      risultato = allargaLeggermente(risultato, 0.012);
    }
    return risultato;
  } catch (e) {
    return null;
  } finally {
    if (migliore) migliore.delete();
    if (src) src.delete();
    if (gray) gray.delete();
    if (edged) edged.delete();
    if (kernel) kernel.delete();
    if (contours) contours.delete();
    if (hierarchy) hierarchy.delete();
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
  document.getElementById('scannerVuoto').style.display = '';
});

document.getElementById('btnCropConferma').addEventListener('click', function () {
  var img = scanState.img;
  var pts = scanState.cropPts;
  // Converte le frazioni (rispetto all'immagine mostrata) in pixel reali della foto originale
  var src = pts.map(function (p) { return { x: p.x * img.naturalWidth, y: p.y * img.naturalHeight }; });

  var dist = function (a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); };
  var larghezza = Math.round(Math.max(dist(src[0], src[1]), dist(src[3], src[2])));
  var altezza = Math.round(Math.max(dist(src[0], src[3]), dist(src[1], src[2])));
  var MAX_LATO2 = 2800;
  var scala2 = Math.min(1, MAX_LATO2 / Math.max(larghezza, altezza));
  larghezza = Math.max(1, Math.round(larghezza * scala2));
  altezza = Math.max(1, Math.round(altezza * scala2));

  var out = document.createElement('canvas');
  out.width = larghezza;
  out.height = altezza;
  var octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  var dst = [
    { x: 0, y: 0 },
    { x: larghezza, y: 0 },
    { x: larghezza, y: altezza },
    { x: 0, y: altezza }
  ];

  disegnaTriangoloProspettico(octx, img, src[0], src[1], src[3], dst[0], dst[1], dst[3]);
  disegnaTriangoloProspettico(octx, img, src[1], src[2], src[3], dst[1], dst[2], dst[3]);

  scanState.croppedCanvas = out;
  document.getElementById('scannerCrop').style.display = 'none';
  document.getElementById('scannerAnteprima').style.display = 'block';
  document.getElementById('scannerCanvas').style.display = '';
  document.getElementById('btnScannerRuota').style.display = '';
  document.getElementById('btnScannerMigliora').style.display = '';
  document.getElementById('pdfDirettoInfo').style.display = 'none';
  document.getElementById('scannerStatus').textContent = '';
  document.getElementById('scannerLuogo').value = '';
  // Dopo il ritaglio il miglioramento parte automaticamente (l'operaio puo'
  // comunque disattivarlo premendo di nuovo "Migliora" se preferisce la foto originale).
  scanState.migliorata = true;
  document.getElementById('btnScannerMigliora').classList.add('btn-primary');
  disegnaCanvas();
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
  var img = scanState.croppedCanvas || scanState.img;
  if (!img) return;
  var canvas = document.getElementById('scannerCanvas');
  var ctx = canvas.getContext('2d');
  var ruotato90 = (scanState.rotazione === 90 || scanState.rotazione === 270);

  // Limita la dimensione massima per non appesantire troppo il telefono
  // (alzata rispetto a prima per una qualita' del ticket piu' leggibile)
  var MAX_LATO = 2600;
  var scala = Math.min(1, MAX_LATO / Math.max(img.width, img.height));
  var w = Math.round(img.width * scala);
  var h = Math.round(img.height * scala);

  canvas.width = ruotato90 ? h : w;
  canvas.height = ruotato90 ? w : h;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(scanState.rotazione * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();

  if (scanState.migliorata) applicaMiglioramento(ctx, canvas.width, canvas.height);
}

document.getElementById('btnScannerRuota').addEventListener('click', function () {
  scanState.rotazione = (scanState.rotazione + 90) % 360;
  disegnaCanvas();
});

document.getElementById('btnScannerMigliora').addEventListener('click', function () {
  scanState.migliorata = !scanState.migliorata;
  this.classList.toggle('btn-primary', scanState.migliorata);
  disegnaCanvas();
});

document.getElementById('btnScannerAnnulla').addEventListener('click', function () {
  scanState.img = null;
  scanState.croppedCanvas = null;
  scanState.pdfDiretto = null;
  document.getElementById('scannerVuoto').style.display = '';
  document.getElementById('scannerAnteprima').style.display = 'none';
});

// Miglioramento tipo "documento". Se OpenCV.js e' pronta usa una soglia
// adattiva (adaptive threshold), la stessa tecnica delle app tipo
// CamScanner: risultato bianco/nero pulito anche con luce non uniforme.
// Se OpenCV non e' disponibile si usa il metodo di riserva (scala di
// grigi + stiramento del contrasto).
function applicaMiglioramento(ctx, w, h) {
  if (window.cvPronto && typeof cv !== 'undefined') {
    var src, gray, claheM, dst, pulito, rgba, clahe;
    try {
      src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // Riduce il rumore della fotocamera mantenendo i contorni delle
      // lettere (a differenza della sfocatura semplice): senza questo
      // passaggio la soglia bianco/nero trasforma il rumore in una
      // pioggia di puntini neri su tutto il foglio.
      cv.bilateralFilter(gray, gray, 9, 60, 60);

      // CLAHE leggero: aumenta il contrasto locale (utile con scrittura
      // chiara o luce non uniforme) senza esagerare ed amplificare il rumore.
      claheM = new cv.Mat();
      clahe = new cv.CLAHE(1.5, new cv.Size(8, 8));
      clahe.apply(gray, claheM);

      dst = new cv.Mat();
      // Dimensione del blocco proporzionata alla risoluzione della foto:
      // con foto piu' grandi un blocco fisso diventa troppo piccolo e il
      // risultato viene "sporco". Deve essere un numero dispari.
      var blocco = Math.round(Math.min(w, h) / 18);
      if (blocco < 21) blocco = 21;
      if (blocco % 2 === 0) blocco++;
      cv.adaptiveThreshold(claheM, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, blocco, 14);

      // Pulizia finale: toglie i puntini neri isolati rimasti (rumore residuo)
      // senza intaccare le lettere, che sono tratti continui piu' grandi.
      pulito = new cv.Mat();
      cv.medianBlur(dst, pulito, 3);

      rgba = new cv.Mat();
      cv.cvtColor(pulito, rgba, cv.COLOR_GRAY2RGBA);
      var out = new ImageData(new Uint8ClampedArray(rgba.data), w, h);
      ctx.putImageData(out, 0, 0);
      return;
    } catch (e) {
      // se qualcosa va storto continua con il metodo di riserva sotto
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (claheM) claheM.delete();
      if (dst) dst.delete();
      if (pulito) pulito.delete();
      if (rgba) rgba.delete();
      if (clahe) clahe.delete();
    }
  }

  var imgData = ctx.getImageData(0, 0, w, h);
  var d = imgData.data;
  var min = 255, max = 0;
  for (var i = 0; i < d.length; i += 4) {
    var gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  var range = Math.max(1, max - min);
  for (var j = 0; j < d.length; j += 4) {
    var v = (d[j] - min) * (255 / range);
    // leggera curva per schiarire il fondo e scurire il tratto
    v = Math.pow(v / 255, 0.85) * 255;
    d[j] = d[j + 1] = d[j + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
}

// ---------------- Caricamento su Drive ----------------
document.getElementById('btnScannerCarica').addEventListener('click', function () {
  if (!scanState.img && !scanState.pdfDiretto) return;
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
      stato.textContent = 'Preparazione PDF...';
      var canvas = document.getElementById('scannerCanvas');
      var jsPDFCtor = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
      var orientamento = canvas.width >= canvas.height ? 'l' : 'p';
      var pdf = new jsPDFCtor({ orientation: orientamento, unit: 'px', format: [canvas.width, canvas.height] });
      var dataUrl = canvas.toDataURL('image/jpeg', 0.94);
      pdf.addImage(dataUrl, 'JPEG', 0, 0, canvas.width, canvas.height);
      pdfBase64 = pdf.output('datauristring').split(',')[1];
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
          scanState.img = null;
          scanState.croppedCanvas = null;
          scanState.pdfDiretto = null;
          document.getElementById('scannerVuoto').style.display = '';
          document.getElementById('scannerAnteprima').style.display = 'none';
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
