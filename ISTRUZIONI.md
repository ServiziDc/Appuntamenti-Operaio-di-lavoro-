# Appuntamenti Operaio di Lavoro — Gama Service

App dedicata SOLO agli operai: mostra il lavoro assegnato per oggi ed
eventuali ticket allegati (letti dallo stesso Planning Operai che gestisci
tu). Nessun menu, nessuna funzione di modifica.

## Pubblicazione (prima volta)

1. Crea su GitHub il repository **Appuntamenti-Operaio-di-lavoro-** sotto
   l'organizzazione/utente **ServiziDc** (se non esiste già), lasciandolo
   vuoto (senza README).
2. Metti tutti i file di questa cartella dentro la cartella del progetto
   sul tuo PC (o usa direttamente questa cartella).
3. Fai doppio click su **PUBBLICA-SU-GITHUB.bat**. La prima volta ti
   chiederà di fare login a GitHub (si apre il browser o una finestra di
   Windows) — dopo se lo ricorda da solo.
4. Su GitHub, vai in **Settings → Pages** del repository e imposta come
   sorgente il branch **main**, cartella **/ (root)**. Salva. Questo va
   fatto UNA SOLA VOLTA.
5. Dopo 1-2 minuti il sito è online su:
   `https://servizidc.github.io/Appuntamenti-Operaio-di-lavoro-/`

## Aggiornamenti successivi

Ogni volta che modifichi qualcosa in questa cartella, fai di nuovo doppio
click su **PUBBLICA-SU-GITHUB.bat**: carica le modifiche in automatico.

## Come lo usano gli operai

Manda loro il link `https://servizidc.github.io/Appuntamenti-Operaio-di-lavoro-/`.
Fanno login con le stesse credenziali di Gestione Ore, e al primo accesso
compare un pulsante "📲 Installa app" per aggiungerla alla schermata home
del telefono (su iPhone: tasto Condividi → "Aggiungi a schermata Home").

## Collegamento operaio ↔ email di login

Perché il sistema riconosca chi è chi, ogni operaio deve avere il
collegamento fatto in Planning Operai (Gestione → Operai): o
l'abbinamento automatico UID ("🔗 Carica account Gestione Ore" +
"⚡ Applica abbinamenti UID"), oppure il campo email compilato a mano con
la stessa email che l'operaio usa per accedere.

## Nota tecnica

Questa app legge gli stessi dati di Planning Operai (stesso progetto
Firebase `gama-service`, stesse regole Firestore già configurate) — non
serve nessun setup aggiuntivo lato Firebase, è già tutto pronto e
funzionante appena pubblicata.
