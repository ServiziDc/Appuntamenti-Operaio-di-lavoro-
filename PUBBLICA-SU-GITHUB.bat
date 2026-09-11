@echo off
REM ============================================================
REM Pubblica "Appuntamenti Operaio di Lavoro" su GitHub Pages
REM Repo:  https://github.com/ServiziDc/Appuntamenti-Operaio-di-lavoro-
REM Sito:  https://servizidc.github.io/Appuntamenti-Operaio-di-lavoro-/
REM ============================================================
setlocal

set REPO_URL=https://github.com/ServiziDc/Appuntamenti-Operaio-di-lavoro-.git

cd /d "%~dp0"

echo.
echo === Appuntamenti Operaio di Lavoro - Pubblicazione su GitHub ===
echo.

REM Usa il Git Credential Manager di Windows per salvare le credenziali
REM (chiede login la prima volta, poi se le ricorda in automatico).
git config --global credential.helper manager 2>nul

if not exist ".git" (
    echo Nessun repository Git trovato qui: lo creo ora...
    git init
    git branch -M main
    git remote add origin "%REPO_URL%"
) else (
    echo Repository Git gia' presente.
    git remote get-url origin >nul 2>nul
    if errorlevel 1 (
        echo Aggiungo il collegamento al repository remoto...
        git remote add origin "%REPO_URL%"
    )
)

echo.
echo Aggiungo tutti i file modificati...
git add -A

echo.
set /p COMMIT_MSG="Descrizione della modifica (invio per usare una data automatica): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=Aggiornamento del %date% %time%

git commit -m "%COMMIT_MSG%"

echo.
echo Pubblico su GitHub (branch main)...
git push --force origin main

echo.
if errorlevel 1 (
    echo ============================================================
    echo  ERRORE durante la pubblicazione. Controlla il messaggio sopra.
    echo  Se e' la prima volta, verifica di aver fatto il login a GitHub
    echo  quando richiesto dalla finestra del browser/credenziali.
    echo ============================================================
) else (
    echo ============================================================
    echo  Pubblicato! Tra 1-2 minuti sara' online su:
    echo  https://servizidc.github.io/Appuntamenti-Operaio-di-lavoro-/
    echo.
    echo  IMPORTANTE (solo al primo caricamento del repository):
    echo  vai su GitHub - Settings - Pages e imposta come sorgente
    echo  il branch "main", cartella "/ (root)". Dopo il primo salvataggio
    echo  restera' cosi' per sempre, non serve rifarlo ogni volta.
    echo ============================================================
)

echo.
pause
