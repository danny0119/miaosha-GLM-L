@echo off
chcp 65001 >nul
title PP-OCR + YOLO Server (miaosha)

:: Kill any existing listener on port 8888
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8888"') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Prefer bundled exe over Python (no venv dependency)
set EXE=%~dp0dist\ppocr_server\ppocr_server.exe
if exist "%EXE%" (
    echo Starting PP-OCR + YOLO server (bundled exe) on port 8888 ...
    "%EXE%"
) else (
    :: Fallback to l-4 venv Python
    set VENV=D:\test\glm-cpu-lite-concurrency-l-4\venv
    set PYTHON=%VENV%\Scripts\python.exe
    if not exist "%PYTHON%" (
        echo ERROR: neither bundled exe nor venv python found
        pause
        exit /b 1
    )
    echo Starting PP-OCR + YOLO server (Python) on port 8888 ...
    "%PYTHON%" "%~dp0ppocr_server.py"
)
if errorlevel 1 (
    echo Server exited with error code %errorlevel%
    pause
)
