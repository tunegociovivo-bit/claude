@echo off
setlocal
title Instalador de Control Horario - Negocio Vivo
color 1F
echo.
echo  NEGOCIO VIVO - CONTROL HORARIO
echo  Preparando la instalacion segura...
echo.

powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference='Stop'; $basePath=Join-Path $env:LOCALAPPDATA 'NegocioVivo\ControlHorario'; New-Item -ItemType Directory -Force -Path $basePath | Out-Null; $certificatePath=Join-Path $basePath 'Negocio-Vivo-Editor-Confiable.cer'; $installerPath=Join-Path $basePath 'Negocio.Vivo.Control.Horario.Setup.0.2.0.exe'; Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/tunegociovivo-bit/claude/releases/download/time-agent-v0.2.0/Negocio-Vivo-Editor-Confiable.cer' -OutFile $certificatePath; if((Get-FileHash -LiteralPath $certificatePath -Algorithm SHA256).Hash -ne '660043706FBF95556DFDC81B09D3F89271C3037C674CBEEEB3EA4376C18E6FD9'){throw 'El certificado descargado no es valido'}; $certificate=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certificatePath); if($certificate.Thumbprint -ne '7BD7D8745253F281D6A47A61CC396437257D2C7C'){throw 'La huella del certificado no coincide'}; Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null; Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null; Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/tunegociovivo-bit/claude/releases/download/time-agent-v0.2.0/Negocio.Vivo.Control.Horario.Setup.0.2.0.exe' -OutFile $installerPath; if((Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash -ne '036EE3AAE6C8E30D96CC6C3AD4976A9F0E4A2930F5B918AF3A9F6F09CA19B751'){throw 'El instalador descargado no es valido'}; $signature=Get-AuthenticodeSignature -FilePath $installerPath; if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne '7BD7D8745253F281D6A47A61CC396437257D2C7C'){throw 'La firma del instalador no es valida'}; Unblock-File -LiteralPath $installerPath; Start-Process -FilePath $installerPath -Wait"

if errorlevel 1 goto error
echo.
echo  Instalacion completada. Ya puedes cerrar esta ventana.
timeout /t 4 /nobreak >nul
exit /b 0

:error
color 4F
echo.
echo  No se ha podido completar la instalacion.
echo  Haz una foto de esta ventana y enviala al administrador.
echo.
pause
exit /b 1
