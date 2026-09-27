@echo off
:: Self-elevate to Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Meminta izin Administrator untuk memperbaiki routing...
    powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   Memperbaiki Rute Mikrotik ke Interface Fisik Ethernet (192.168.1.81)
echo ============================================================

:: Hapus rute lama yang nyasar ke Tailscale
route delete 192.168.50.0 >nul 2>&1

:: Dapatkan Interface Index dari kartu jaringan fisik 192.168.1.81
for /f "tokens=1" %%i in ('powershell -Command "(Get-NetIPAddress -IPAddress 192.168.1.81).InterfaceIndex"') do set IF_IDX=%%i

if "%IF_IDX%"=="" set IF_IDX=13

echo Interface Fisik Ethernet terdeteksi: IF %IF_IDX%
echo Menambahkan rute 192.168.50.0/24 via 192.168.1.64 IF %IF_IDX%...

route add 192.168.50.0 mask 255.255.255.0 192.168.1.64 IF %IF_IDX% -p

echo.
echo ============================================================
echo Rute berhasil diperbarui! Menguji koneksi ke 192.168.50.69...
echo ============================================================
echo.
ping 192.168.50.69 -n 3
echo.
pause
