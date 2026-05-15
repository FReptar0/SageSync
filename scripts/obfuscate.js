#!/usr/bin/env node

/**
 * Script de ofuscación para SageSync
 *
 * Copia el proyecto a una carpeta `dist/` y ofusca todos los archivos .js
 * dentro de `src/`. Los archivos de configuración, public/, tests/, etc.
 * se copian sin modificar.
 *
 * Uso:
 *   node scripts/obfuscate.js              → genera en dist/
 *   node scripts/obfuscate.js --push       → genera en dist/ y pushea al repo destino
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// ─── Configuración ──────────────────────────────────────────────────
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// Repositorio destino (cambiar por tu URL real)
const TARGET_REPO = process.env.OBFUSCATED_REPO_URL || 'https://github.com/FReptar0/SageSync-dist.git';

// Carpetas/archivos a copiar tal cual (sin ofuscar)
const COPY_AS_IS = [
    'package.json',
    'package-lock.json',
    'jest.config.js',
    'README.md',
    'LICENSE.md',
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'public',
    'config.json',
    '.env.example',
    'tests',  // Incluir suite de tests para QA en cliente
];

// Carpetas cuyo JS se ofuscará
const OBFUSCATE_DIRS = ['src'];

// Archivos/carpetas excluidos de la copia
const EXCLUDED = [
    'node_modules',
    '.git',
    '.github',
    'dist',
    'logs',
    'reports',
    'coverage',
    'backups',
    'postman',
    '.env',
    '.env.local',
    '.DS_Store',
    '.fracttal-token',
    '.sage-credentials',
    '.claude',
    '.agents',
    '.planning',
    'docs',
    'scripts/obfuscate.js',  // No incluir este script en la distribución
    // NOTA: 'tests' ya NO está excluido — se incluyen en dist para QA en cliente.
    // Tests unitarios contra src/ ofuscado pueden fallar si el obfuscator
    // renombra métodos públicos. Tests de integración via HTTP / mocks deberían
    // funcionar igual.
];

// Opciones de javascript-obfuscator (nivel alto)
const OBFUSCATION_OPTIONS = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,               // true puede causar problemas en producción
    disableConsoleOutput: false,           // mantener console.log funcional
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,                  // false para evitar romper require/module.exports
    selfDefending: false,                  // false para entornos server-side
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    target: 'node',                        // Optimizado para Node.js
};

// ─── Utilidades ─────────────────────────────────────────────────────

function isExcluded(relativePath) {
    return EXCLUDED.some((ex) => {
        const normalized = relativePath.replace(/\\/g, '/');
        return normalized === ex || normalized.startsWith(ex + '/');
    });
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function copyFileSync(src, dest) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

function copyDirSync(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        const relPath = path.relative(ROOT_DIR, srcPath);

        if (isExcluded(relPath)) continue;

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

function obfuscateFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    try {
        const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATION_OPTIONS);
        return result.getObfuscatedCode();
    } catch (err) {
        console.warn(`  ⚠ No se pudo ofuscar ${filePath}: ${err.message}`);
        return code; // devolver sin ofuscar si falla
    }
}

function processDirectory(srcDir, destDir) {
    ensureDir(destDir);
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        const relPath = path.relative(ROOT_DIR, srcPath);

        if (isExcluded(relPath)) continue;

        if (entry.isDirectory()) {
            processDirectory(srcPath, destPath);
        } else if (entry.name.endsWith('.js')) {
            console.log(`  🔒 Ofuscando: ${relPath}`);
            const obfuscated = obfuscateFile(srcPath);
            ensureDir(path.dirname(destPath));
            fs.writeFileSync(destPath, obfuscated, 'utf8');
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

// ─── Ejecución principal ────────────────────────────────────────────

async function main() {
    const shouldPush = process.argv.includes('--push');

    console.log('╔══════════════════════════════════════════════╗');
    console.log('║       SageSync — Obfuscation Build           ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log();

    // 1. Limpiar directorio dist
    console.log('🗑  Limpiando directorio dist/...');
    if (fs.existsSync(DIST_DIR)) {
        fs.rmSync(DIST_DIR, { recursive: true, force: true });
    }
    ensureDir(DIST_DIR);

    // 2. Copiar archivos/carpetas estáticos
    console.log('📋 Copiando archivos estáticos...');
    for (const item of COPY_AS_IS) {
        const srcPath = path.join(ROOT_DIR, item);
        const destPath = path.join(DIST_DIR, item);

        if (!fs.existsSync(srcPath)) {
            console.log(`  ⏭  Omitido (no existe): ${item}`);
            continue;
        }

        const stat = fs.statSync(srcPath);
        if (stat.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
        console.log(`  ✅ ${item}`);
    }

    // 3. Ofuscar código fuente
    console.log();
    console.log('🔐 Ofuscando código fuente...');
    for (const dir of OBFUSCATE_DIRS) {
        const srcPath = path.join(ROOT_DIR, dir);
        const destPath = path.join(DIST_DIR, dir);

        if (!fs.existsSync(srcPath)) {
            console.log(`  ⏭  Omitido (no existe): ${dir}/`);
            continue;
        }

        processDirectory(srcPath, destPath);
    }

    // 4. Crear .gitignore para dist
    const distGitignore = [
        'node_modules/',
        '.env',
        '.env.local',
        '.env.*.local',
        '.fracttal-token',
        '.sage-credentials',
        'logs/',
        '*.log',
        '.DS_Store',
    ].join('\n');
    fs.writeFileSync(path.join(DIST_DIR, '.gitignore'), distGitignore, 'utf8');

    // 5. Modificar package.json en dist (mantener devDependencies de testing y scripts QA)
    const pkgPath = path.join(DIST_DIR, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

        // Mantener solo devDependencies útiles para QA en cliente; quitar build/dev tools.
        if (pkg.devDependencies) {
            const keepDev = ['jest', 'supertest'];
            const filtered = {};
            for (const k of keepDev) {
                if (pkg.devDependencies[k]) filtered[k] = pkg.devDependencies[k];
            }
            pkg.devDependencies = filtered;
        }

        // Scripts producción + QA (tests + maintenance)
        pkg.scripts = {
            start: pkg.scripts?.start || 'node src/main.js',
            'sync-only': pkg.scripts?.['sync-only'] || 'node src/app.js',
            sync: pkg.scripts?.sync || 'node src/sync.js',
            'sync:preview': pkg.scripts?.['sync:preview'] || 'node src/sync.js --dry-run',
            maintenance: pkg.scripts?.maintenance || 'node src/maintenance.js',
            'maintenance:clean': pkg.scripts?.['maintenance:clean'] || 'node src/maintenance.js clean-logs',
            'maintenance:token': pkg.scripts?.['maintenance:token'] || 'node src/maintenance.js renew-token',
            'maintenance:backup': pkg.scripts?.['maintenance:backup'] || 'node src/maintenance.js backup-config',
            'install-service': pkg.scripts?.['install-service'] || 'node src/service-installer.js install',
            'uninstall-service': pkg.scripts?.['uninstall-service'] || 'node src/service-installer.js uninstall',
            // QA scripts — tests/ se copia al dist
            test: pkg.scripts?.test || 'jest',
            'test:fracttal': pkg.scripts?.['test:fracttal'] || 'jest tests/services/fracttalClient.test.js',
            'test:sage': pkg.scripts?.['test:sage'] || 'jest tests/services/sageService.test.js',
            'test:integration': pkg.scripts?.['test:integration'] || 'jest tests/integration/',
            'test:credentials': pkg.scripts?.['test:credentials'] || 'node tests/manual/test-credentials.js',
            'test:workflow': pkg.scripts?.['test:workflow'] || 'node tests/manual/test-workflow.js',
        };
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
        console.log('  ✅ package.json preparado (runtime + QA scripts + jest/supertest devDeps)');
    }

    console.log();
    console.log('✅ Build ofuscado generado en dist/');

    // 6. Push al repositorio destino (opcional)
    if (shouldPush) {
        console.log();
        console.log(`🚀 Pusheando al repositorio: ${TARGET_REPO}`);

        const { execSync } = require('child_process');
        const opts = { cwd: DIST_DIR, stdio: 'inherit' };

        try {
            // Inicializar repo git en dist si no existe
            if (!fs.existsSync(path.join(DIST_DIR, '.git'))) {
                execSync('git init', opts);
                execSync(`git remote add origin ${TARGET_REPO}`, opts);
            }

            // Obtener la rama actual del repo original
            const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
                cwd: ROOT_DIR,
                encoding: 'utf8',
            }).trim();

            // Obtener el último commit message del repo original
            const commitMsg = execSync('git log -1 --pretty=%B', {
                cwd: ROOT_DIR,
                encoding: 'utf8',
            }).trim();

            execSync('git add -A', opts);
            execSync(
                `git commit -m "build(obfuscated): ${commitMsg}" --allow-empty`,
                opts
            );
            execSync(`git push -u origin HEAD:${currentBranch} --force`, opts);

            console.log('✅ Push completado exitosamente');
        } catch (err) {
            console.error('❌ Error al pushear:', err.message);
            console.log();
            console.log('Asegúrate de:');
            console.log(`  1. El repositorio ${TARGET_REPO} existe en GitHub`);
            console.log('  2. Tienes permisos de escritura');
            console.log('  3. Tu autenticación de Git está configurada');
            process.exit(1);
        }
    }

    console.log();
    console.log('🎉 ¡Proceso completado!');
}

main().catch((err) => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
