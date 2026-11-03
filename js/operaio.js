// ============================================================
// Planning Operaio - app dedicata per gli operai
// Mostra la settimana Lun-Sab della persona collegata, con
// eventuale nota e ticket allegato per ciascun giorno.
// Nessuna funzione di modifica.
// ============================================================

var opState = {
  user: null,
  operai: [],
  cellePerMese: {},   // { "YYYY-MM": { opId_DD: "testo" } }
  unsubOperai: null,
  unsubPlanning: {},  // { "YYYY-MM": funzioneDiUnsubscribe }
  weekOffset: 0        // 0 = settimana di oggi, -1 = precedente, +1 = successiva...
};

// ---------------- Navigazione tra le settimane ----------------
document.getElementById('btnSettPrec').addEventListener('click', function () {
  opState.weekOffset--;
  cambiaSettimana();
});
document.getElementById('btnSettSucc').addEventListener('click', function () {
  opState.weekOffset++;
  cambiaSettimana();
});
document.getElementById('btnSettOggi').addEventListener('click', function () {
  opState.weekOffset = 0;
  cambiaSettimana();
});
function cambiaSettimana() {
  document.getElementById('btnSettOggi').style.display = opState.weekOffset === 0 ? 'none' : '';
  ascoltaMesiSettimana();
  renderScheda();
}

// ---------------- Auth ----------------
document.getElementById('btnLogin').addEventListener('click', doLoginOperaio);
document.getElementById('loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLoginOperaio(); });
document.getElementById('btnLogout').addEventListener('click', function () { auth.signOut(); });

function doLoginOperaio() {
  var email = document.getElementById('loginEmail').value.trim();
  var pass = document.getElementById('loginPassword').value;
  var err = document.getElementById('loginError');
  err.textContent = '';
  auth.signInWithEmailAndPassword(email, pass).catch(function (e) {
    var msg;
    var code = e && e.code ? e.code : '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      msg = 'Email o password errati.';
    } else if (code === 'auth/invalid-email') {
      msg = 'Formato email non valido.';
    } else if (code === 'auth/too-many-requests') {
      msg = 'Troppi tentativi: riprova tra qualche minuto.';
    } else if (code === 'auth/network-request-failed') {
      msg = 'Problema di rete: controlla la connessione.';
    } else {
      msg = 'Errore: ' + (code || e.message);
    }
    err.textContent = msg;
    console.error(e);
  });
}

auth.onAuthStateChanged(function (user) {
  opState.user = user;
  if (user) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'block';
    avviaAscolto();
  } else {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appScreen').style.display = 'none';
    if (opState.unsubOperai) { opState.unsubOperai(); opState.unsubOperai = null; }
    fermaAscoltoPlanning();
    opState.weekOffset = 0;
    document.getElementById('btnSettOggi').style.display = 'none';
  }
});

function fermaAscoltoPlanning() {
  Object.keys(opState.unsubPlanning).forEach(function (m) { opState.unsubPlanning[m](); });
  opState.unsubPlanning = {};
}

// ---------------- Ascolto dati in tempo reale ----------------
function avviaAscolto() {
  if (opState.unsubOperai) opState.unsubOperai();
  opState.unsubOperai = db.collection('po_config').doc('operai').onSnapshot(function (snap) {
    opState.operai = (snap.exists && snap.data().lista) ? snap.data().lista : [];
    renderScheda();
  });

  ascoltaMesiSettimana();

  // A mezzanotte la settimana/il mese potrebbero cambiare mentre l'app
  // resta aperta: ricontrolla ogni minuto quali mesi servono.
  setInterval(ascoltaMesiSettimana, 60 * 1000);
}

// Ascolta (in tempo reale) tutti i documenti po_planning necessari a
// coprire la settimana Lun-Sab corrente (di solito 1, a volte 2 se la
// settimana scavalca il cambio mese), senza duplicare gli ascolti gia'
// attivi e fermando quelli non piu' necessari.
function ascoltaMesiSettimana() {
  var mesiServiti = mesiCoinvolti(giorniSettimanaCorrente(opState.weekOffset));

  // Ferma gli ascolti di mesi che non servono piu' (es. settimana avanzata)
  Object.keys(opState.unsubPlanning).forEach(function (m) {
    if (mesiServiti.indexOf(m) === -1) {
      opState.unsubPlanning[m]();
      delete opState.unsubPlanning[m];
      delete opState.cellePerMese[m];
    }
  });

  // Avvia gli ascolti mancanti
  mesiServiti.forEach(function (mese) {
    if (opState.unsubPlanning[mese]) return; // gia' in ascolto
    opState.unsubPlanning[mese] = db.collection('po_planning').doc(mese).onSnapshot(function (snap) {
      opState.cellePerMese[mese] = (snap.exists && snap.data().celle) ? snap.data().celle : {};
      renderScheda();
    });
  });
}

// ---------------- Rendering ----------------
function renderScheda() {
  var el = document.getElementById('operaioCard');
  if (!el) return;
  var op = trovaOperaioPerUtente(opState.operai, opState.user);
  el.innerHTML = renderizzaSchedaSettimana(op, opState.cellePerMese, opState.user && opState.user.email, opState.weekOffset);
}

// ---------------- Service worker + installazione come app a se stante ----------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { scope: '/Appuntamenti-Operaio-di-lavoro-/' })
    .catch(function (e) { console.warn('SW operaio non registrato:', e); });
}

(function () {
  var deferredPrompt = null;

  function creaBottone() {
    if (document.getElementById('pwaInstallBtnOperaio')) return;
    var btn = document.createElement('button');
    btn.id = 'pwaInstallBtnOperaio';
    btn.textContent = '📲 Installa app';
    btn.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:999;background:#f59014;color:#fff;border:none;border-radius:24px;padding:12px 18px;font-size:14px;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,.3);cursor:pointer;';
    btn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        btn.remove();
      });
    });
    document.body.appendChild(btn);
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    creaBottone();
  });

  window.addEventListener('appinstalled', function () {
    var b = document.getElementById('pwaInstallBtnOperaio');
    if (b) b.remove();
  });

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isIOS && !standalone && !localStorage.getItem('pwaIosHintOperaioVisto')) {
    var hint = document.createElement('div');
    hint.style.cssText = 'position:fixed;bottom:14px;left:14px;right:14px;z-index:999;background:#2e3036;color:#fff;border-radius:12px;padding:14px;font-size:13px;box-shadow:0 6px 18px rgba(0,0,0,.4);';
    hint.innerHTML = '📲 Per installare l\'app: tocca <b>Condividi</b> (quadrato con freccia) e poi <b>"Aggiungi a schermata Home"</b>. <span id="pwaIosOkOperaio" style="float:right;font-weight:700;color:#f59014;cursor:pointer;">OK</span>';
    document.body.appendChild(hint);
    document.getElementById('pwaIosOkOperaio').addEventListener('click', function () {
      localStorage.setItem('pwaIosHintOperaioVisto', '1');
      hint.remove();
    });
  }
})();
