/**
 * Script de prueba para verificar configuración
 * Ejecutar con: node test.js
 */

require('dotenv').config();

console.log('🧪 Probando configuración del scraper...\n');

// Verificar variables de entorno
const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
];

const optionalVars = [
    'OPENAI_API_KEY',
    'TRIBUNAL',
    'START_DATE',
    'END_DATE',
    'MAX_SENTENCIAS',
    'ENABLE_EMBEDDINGS',
    'DEBUG'
];

console.log('📋 Variables requeridas:');
let allRequiredPresent = true;
requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
        console.log(`  ✅ ${varName}: ${value.substring(0, 20)}...`);
    } else {
        console.log(`  ❌ ${varName}: NO CONFIGURADA`);
        allRequiredPresent = false;
    }
});

console.log('\n📋 Variables opcionales:');
optionalVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
        console.log(`  ✅ ${varName}: ${value}`);
    } else {
        console.log(`  ⚠️  ${varName}: NO CONFIGURADA (opcional)`);
    }
});

console.log('\n🔧 Configuración actual:');
console.log(`  Tribunal: ${process.env.TRIBUNAL || 'Corte_Suprema'}`);
console.log(`  Fecha inicio: ${process.env.START_DATE || 'No configurada'}`);
console.log(`  Fecha fin: ${process.env.END_DATE || 'No configurada'}`);
console.log(`  Máximo sentencias: ${process.env.MAX_SENTENCIAS || '100'}`);
console.log(`  Embeddings: ${process.env.ENABLE_EMBEDDINGS === 'true' ? 'Habilitados' : 'Deshabilitados'}`);
console.log(`  Debug: ${process.env.DEBUG === 'true' ? 'Habilitado' : 'Deshabilitado'}`);

if (allRequiredPresent) {
    console.log('\n✅ Configuración correcta! El scraper está listo para ejecutarse.');
    console.log('   Ejecuta: npm start');
} else {
    console.log('\n❌ Faltan variables requeridas. Configura las variables de entorno antes de ejecutar.');
    console.log('   Copia env.example a .env y configura tus credenciales.');
}

console.log('\n📚 Para más información, consulta el README.md'); 