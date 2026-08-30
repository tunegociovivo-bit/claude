# Negocio Vivo Control Horario

Agente visible y de bajo impacto para Windows 10/11 y macOS 12+. Registra tiempo,
aplicación activa, inactividad y capturas periódicas configurables. No incluye
keylogging ni captura durante tiempo privado o en aplicaciones excluidas.

## Desarrollo y empaquetado

```bash
npm install
npm run dev
npm run dist:win
npm run dist:mac
```

La compilación para macOS debe ejecutarse y firmarse en un Mac. El token se guarda
en Windows Credential Manager o macOS Keychain mediante `keytar`.
