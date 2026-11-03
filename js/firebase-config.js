// ============================================================
// CONFIGURAZIONE FIREBASE - Planning Operai Gama Service
// Progetto: gama-service (stesso di Gestione Ore)
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCp7WCI9wWBH1hLNXdYA0LTvRmKYjVo53o",
  authDomain: "gama-service.firebaseapp.com",
  projectId: "gama-service",
  storageBucket: "gama-service.firebasestorage.app",
  messagingSenderId: "440236038955",
  appId: "1:440236038955:web:24eaa8dca617b54b1b836e"
};

// Email con permessi di ADMIN (possono modificare il planning).
// Tutti gli altri utenti autenticati vedono in sola lettura.
const ADMIN_EMAILS = [
  "simox91.st@gmail.com",
  "simone.terragni@gama-service.com",
  "amministrazione@gama-service.com"
];

// URL delle Cloud Functions per il caricamento dei ticket su Google Drive
// (vedi cartella "cloud-function-ticket" per il codice da distribuire e le
// istruzioni). Da compilare DOPO aver fatto il deploy delle due funzioni.
const TICKET_UPLOAD_URL = "";   // es. "https://europe-west1-gama-service.cloudfunctions.net/caricaTicketPlanning"
const TICKET_DELETE_URL = "";   // es. "https://europe-west1-gama-service.cloudfunctions.net/eliminaTicketPlanning"

// URL della Cloud Function che riceve la foto/PDF del ticket scattato
// dall'operaio con la funzione "Carica ticket" (scanner). Da compilare
// dopo aver creato e pubblicato la funzione su Google Cloud Run.
const CARICA_TICKET_OPERAIO_URL = "https://caricaticketoperaio-440236038955.europe-west1.run.app";

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
