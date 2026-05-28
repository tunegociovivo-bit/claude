// Extiende la configuración por defecto de Expo. Necesario en monorepos
// para que Metro resuelva node_modules correctamente y silencia el aviso
// de expo-doctor sobre metro config personalizado.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
