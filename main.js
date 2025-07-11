/**
 * ========================================
 * SCRAPER DE JURISPRUDENCIA CHILENA - RENDER.COM
 * ========================================
 * Extrae sentencias de juris.pjud.cl y las almacena en Supabase
 * con embeddings vectoriales para búsquedas semánticas
 * 
 * Optimizado para Render.com - Background Worker
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const crypto = require('crypto');
const moment = require('moment');
const _ = require('lodash');

// Configuración de logging mejorado
const log = {
    info: (message) => console.log(`[INFO] ${new Date().toISOString()} - ${message}`),
    warning: (message) => console.warn(`[WARNING] ${new Date().toISOString()} - ${message}`),
    error: (message) => console.error(`[ERROR] ${new Date().toISOString()} - ${message}`),
    debug: (message) => {
        if (process.env.DEBUG === 'true') {
            console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`);
        }
    }
};

/**
 * Clase principal del scraper
 */
class JurisprudenciaScraper {
    constructor() {
        this.supabase = null;
        this.openai = null;
        this.browser = null;
        this.page = null;
        this.stats = {
            total_procesadas: 0,
            exitosas: 0,
            duplicadas: 0,
            errores: 0,
            inicio: new Date()
        };
        
        // Configuración desde variables de entorno
        this.config = {
            tribunal: process.env.TRIBUNAL || 'Corte_Suprema',
            startDate: process.env.START_DATE || moment().subtract(30, 'days').format('DD/MM/YYYY'),
            endDate: process.env.END_DATE || moment().format('DD/MM/YYYY'),
            maxSentencias: parseInt(process.env.MAX_SENTENCIAS) || 100,
            searchTerm: process.env.SEARCH_TERM || '',
            enableEmbeddings: process.env.ENABLE_EMBEDDINGS === 'true',
            debugMode: process.env.DEBUG === 'true',
            delayBetweenRequests: parseInt(process.env.DELAY_BETWEEN_REQUESTS) || 2000
        };
        
        // URLs del sitio judicial
        this.BASE_URL = 'https://juris.pjud.cl';
        this.SEARCH_URLS = {
            'Corte_Suprema': '/busqueda?Corte_Suprema',
            'Corte_de_Apelaciones': '/busqueda?Corte_de_Apelaciones',
            'Penales': '/busqueda?Penales',
            'Familia': '/busqueda?Familia',
            'Laboral': '/busqueda?Laboral',
            'Civil': '/busqueda?Civil'
        };
    }

    /**
     * Inicializar conexiones y servicios
     */
    async initialize() {
        log.info('Inicializando scraper para Render.com...');
        
        // Inicializar Supabase
        if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
            this.supabase = createClient(
                process.env.SUPABASE_URL,
                process.env.SUPABASE_ANON_KEY
            );
            log.info('Supabase inicializado correctamente');
        } else {
            log.warning('Supabase no inicializado - faltan variables de entorno');
            this.supabase = null;
        }
        
        // Inicializar OpenAI si está habilitado
        if (this.config.enableEmbeddings && process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
            log.info('OpenAI inicializado para embeddings');
        } else {
            log.info('OpenAI no inicializado - embeddings deshabilitados');
        }
        
        // Inicializar navegador optimizado para Render
        this.browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ]
        });

        this.page = await this.browser.newPage();
        
        // Configurar user agent y headers
        await this.page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        );
        
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });
        
        log.info('Scraper inicializado correctamente para Render.com');
    }

    /**
     * Ejecutar proceso completo de scraping
     */
    async run() {
        try {
            await this.initialize();
            
            log.info(`Iniciando scraping de ${this.config.tribunal}...`);
            log.info(`Rango de fechas: ${this.config.startDate} - ${this.config.endDate}`);
            log.info(`Máximo de sentencias: ${this.config.maxSentencias}`);
            
            // Navegar a la página de búsqueda
            await this.navigateToSearchPage();
            
            // Configurar filtros de búsqueda
            await this.setupSearchFilters();
            
            // Ejecutar búsqueda y obtener resultados
            const resultados = await this.executeSearch();
            
            // Procesar cada resultado
            await this.processResults(resultados);
            
            // Imprimir estadísticas finales
            await this.printFinalStats();
            
        } catch (error) {
            log.error('Error en proceso principal:', error);
            throw error;
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }

    /**
     * Navegar a página de búsqueda del tribunal seleccionado
     */
    async navigateToSearchPage() {
        const searchUrl = this.BASE_URL + this.SEARCH_URLS[this.config.tribunal];
        log.info(`Navegando a: ${searchUrl}`);
        
        await this.page.goto(searchUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Esperar a que cargue la interfaz de búsqueda
        await this.page.waitForSelector('input[type="submit"]', { timeout: 15000 });
        
        if (this.config.debugMode) {
            log.info('Página de búsqueda cargada correctamente');
        }
    }

    /**
     * Configurar filtros de búsqueda
     */
    async setupSearchFilters() {
        log.info('Configurando filtros de búsqueda...');
        
        try {
            // Establecer fechas si existen campos de fecha
            const fechaDesdeField = await this.page.$('input[name*="fecha"][name*="desde"], input[name*="fec_desde"]');
            const fechaHastaField = await this.page.$('input[name*="fecha"][name*="hasta"], input[name*="fec_hasta"]');
            
            if (fechaDesdeField && fechaHastaField) {
                await fechaDesdeField.clear();
                await fechaDesdeField.type(this.config.startDate);
                
                await fechaHastaField.clear();
                await fechaHastaField.type(this.config.endDate);
                
                log.info(`Filtros de fecha establecidos: ${this.config.startDate} - ${this.config.endDate}`);
            }
            
            // Establecer término de búsqueda si existe
            if (this.config.searchTerm) {
                const searchField = await this.page.$('input[name*="texto"], textarea[name*="texto"]');
                if (searchField) {
                    await searchField.type(this.config.searchTerm);
                    log.info(`Término de búsqueda establecido: ${this.config.searchTerm}`);
                }
            }
            
            // Configurar para mostrar con descripción (más información)
            const conDescripcionRadio = await this.page.$('input[value*="descripcion"]');
            if (conDescripcionRadio) {
                await conDescripcionRadio.click();
                log.info('Configurado para mostrar con descripción');
            }
            
        } catch (error) {
            log.warning('Error configurando filtros:', error.message);
        }
    }

    /**
     * Ejecutar búsqueda y obtener resultados
     */
    async executeSearch() {
        log.info('Ejecutando búsqueda...');
        
        try {
            // Hacer clic en el botón de búsqueda
            await this.page.click('input[type="submit"]');
        
            // Esperar a que carguen los resultados
            await this.page.waitForSelector('.resultado, .sentencia, table', { timeout: 20000 });
        
            // Extraer resultados de todas las páginas
            const resultados = [];
            let pagina = 1;
        
            while (resultados.length < this.config.maxSentencias) {
                log.info(`Procesando página ${pagina}...`);
            
            const resultadosPagina = await this.extractResultsFromPage();
                resultados.push(...resultadosPagina);
            
                log.info(`Encontrados ${resultadosPagina.length} resultados en página ${pagina}`);
            
                // Verificar si hay más páginas
                const siguientePagina = await this.goToNextPage();
                if (!siguientePagina) {
                    log.info('No hay más páginas disponibles');
                    break;
                }
                
                pagina++;
                await this.delay(this.config.delayBetweenRequests);
            }
            
            log.info(`Total de resultados encontrados: ${resultados.length}`);
            return resultados.slice(0, this.config.maxSentencias);
            
        } catch (error) {
            log.error('Error ejecutando búsqueda:', error);
            throw error;
        }
    }

    /**
     * Extraer resultados de la página actual
     */
    async extractResultsFromPage() {
        const resultados = await this.page.evaluate(() => {
            const items = [];
            
            // Buscar diferentes tipos de selectores para resultados
            const selectores = [
                '.resultado',
                '.sentencia', 
                'table tr',
                '.item-resultado',
                '[class*="resultado"]'
            ];
            
            let elementos = [];
            for (const selector of selectores) {
                elementos = document.querySelectorAll(selector);
                if (elementos.length > 0) break;
            }
            
            elementos.forEach((elemento, index) => {
                // Extraer información básica
                const rol = elemento.querySelector('[class*="rol"], [class*="numero"]')?.textContent?.trim();
                const fecha = elemento.querySelector('[class*="fecha"]')?.textContent?.trim();
                const tribunal = elemento.querySelector('[class*="tribunal"]')?.textContent?.trim();
                const caratulado = elemento.querySelector('[class*="caratulado"], [class*="materia"]')?.textContent?.trim();
                
                // Buscar enlace al detalle
                const enlace = elemento.querySelector('a[href*="detalle"], a[href*="sentencia"]')?.href;
                
                if (rol || fecha || tribunal) {
                    items.push({
                        rol: rol || `ROL-${Date.now()}-${index}`,
                        fecha: fecha || '',
                        tribunal: tribunal || '',
                        caratulado: caratulado || '',
                        enlace: enlace || '',
                        index: index
                    });
                }
            });
            
            return items;
        });
        
        return resultados;
    }

    /**
     * Ir a la siguiente página de resultados
     */
    async goToNextPage() {
        try {
            const siguienteEnlace = await this.page.$('a[href*="pagina"], a:contains("Siguiente"), a:contains(">")');
            if (siguienteEnlace) {
                await siguienteEnlace.click();
                await this.page.waitForSelector('.resultado, .sentencia, table', { timeout: 10000 });
                return true;
            }
            return false;
        } catch (error) {
            log.debug('No se encontró siguiente página');
            return false;
        }
    }

    /**
     * Procesar todos los resultados
     */
    async processResults(resultados) {
        log.info(`Procesando ${resultados.length} resultados...`);
        
        for (let i = 0; i < resultados.length; i++) {
            const resultado = resultados[i];
            this.stats.total_procesadas++;
            
            try {
                await this.processSingleResult(resultado);
                await this.delay(this.config.delayBetweenRequests);
            } catch (error) {
                log.error(`Error procesando resultado ${i + 1}:`, error.message);
                this.stats.errores++;
            }
        }
    }

    /**
     * Procesar un resultado individual
     */
    async processSingleResult(resultado) {
        log.info(`Procesando: ${resultado.rol}`);
        
        // Verificar si ya existe en la base de datos
        if (this.supabase) {
            const existe = await this.checkDuplicateByRol(resultado.rol);
                if (existe) {
                log.info(`Duplicado encontrado: ${resultado.rol}`);
                this.stats.duplicadas++;
                    return;
                }
            }
        
        // Extraer detalles completos de la sentencia
        const sentencia = await this.extractSentenceDetails(resultado);
            
            // Generar embeddings si está habilitado
        if (this.config.enableEmbeddings && this.openai) {
                await this.generateEmbeddings(sentencia);
            }
            
            // Guardar en Supabase
        if (this.supabase) {
            await this.saveSentenceToSupabase(sentencia);
            this.stats.exitosas++;
            log.info(`Sentencia guardada: ${resultado.rol}`);
        } else {
            log.info(`Sentencia procesada (sin guardar): ${resultado.rol}`);
        }
    }

    /**
     * Extraer detalles completos de una sentencia
     */
    async extractSentenceDetails(resultado) {
        let sentencia = {
            rol: resultado.rol,
            fecha: resultado.fecha,
            tribunal: resultado.tribunal,
            caratulado: resultado.caratulado,
            enlace: resultado.enlace,
            texto_completo: '',
            considerandos: '',
            resolucion: '',
            fecha_ingreso: new Date().toISOString(),
            hash_contenido: '',
            embeddings: null
        };
            
        // Si hay enlace al detalle, navegar y extraer información completa
        if (resultado.enlace) {
            try {
                await this.page.goto(resultado.enlace, { waitUntil: 'networkidle2', timeout: 15000 });
                
                const detalles = await this.page.evaluate(() => {
                const extraerTexto = (selector) => {
                        const elemento = document.querySelector(selector);
                        return elemento ? elemento.textContent.trim() : '';
                };
                
                const extraerTextoMultiple = (selectores) => {
                    for (const selector of selectores) {
                        const texto = extraerTexto(selector);
                        if (texto) return texto;
                    }
                    return '';
                };
                
                    return {
                        texto_completo: extraerTextoMultiple([
                            '.texto-sentencia',
                            '.contenido-sentencia',
                            '.sentencia-texto',
                            '#contenido',
                            '.main-content'
                        ]),
                        considerandos: extraerTextoMultiple([
                            '.considerandos',
                            '[class*="considerando"]',
                            '.fundamentos'
                        ]),
                        resolucion: extraerTextoMultiple([
                            '.resolucion',
                            '.fallo',
                            '[class*="resuelve"]'
                        ]),
                        fecha: extraerTextoMultiple([
                            '.fecha-sentencia',
                    '[class*="fecha"]',
                            '.fecha'
                        ]),
                        tribunal: extraerTextoMultiple([
                            '.tribunal',
                            '[class*="tribunal"]',
                            '.corte'
                        ])
                    };
                });
                
                // Actualizar sentencia con detalles extraídos
                sentencia = { ...sentencia, ...detalles };
                
            } catch (error) {
                log.warning(`Error extrayendo detalles de ${resultado.rol}:`, error.message);
            }
        }
            
            // Procesar fecha
            if (sentencia.fecha) {
            sentencia.fecha = this.processFecha(sentencia.fecha);
            }
            
            // Generar hash del contenido
        const contenidoParaHash = `${sentencia.rol}${sentencia.texto_completo}${sentencia.considerandos}`;
        sentencia.hash_contenido = crypto.createHash('sha256').update(contenidoParaHash).digest('hex');
            
            return sentencia;
    }

    /**
     * Procesar fecha de texto a formato ISO
     */
    processFecha(fechaTexto) {
        try {
            // Intentar diferentes formatos de fecha
            const formatos = [
                'DD/MM/YYYY',
                'DD-MM-YYYY',
                'YYYY-MM-DD',
                'DD/MM/YY',
                'DD-MM-YY'
            ];
            
            for (const formato of formatos) {
                const fecha = moment(fechaTexto, formato, true);
                if (fecha.isValid()) {
                    return fecha.toISOString();
                }
            }
            
            // Si no coincide ningún formato, devolver la fecha original
            return fechaTexto;
        } catch (error) {
            log.warning(`Error procesando fecha: ${fechaTexto}`);
            return fechaTexto;
        }
    }

    /**
     * Verificar si existe duplicado por ROL
     */
    async checkDuplicateByRol(rol) {
        try {
            const { data, error } = await this.supabase
                .from('jurisprudencia_cs')
                .select('rol')
                .eq('rol', rol)
                .limit(1);
            
            if (error) {
                log.error('Error verificando duplicado:', error);
                return false;
            }
            
            return data && data.length > 0;
        } catch (error) {
            log.error('Error en checkDuplicateByRol:', error);
            return false;
        }
    }

    /**
     * Generar embeddings para la sentencia
     */
    async generateEmbeddings(sentencia) {
        try {
            const textoParaEmbedding = `${sentencia.caratulado} ${sentencia.considerandos} ${sentencia.resolucion}`.trim();
            
            if (!textoParaEmbedding) {
                log.warning('No hay texto para generar embeddings');
                return;
            }
            
            const response = await this.openai.embeddings.create({
                    model: 'text-embedding-3-small',
                input: textoParaEmbedding,
                    encoding_format: 'float'
                });
            
            sentencia.embeddings = response.data[0].embedding;
            log.info('Embeddings generados correctamente');
            
        } catch (error) {
            log.error('Error generando embeddings:', error);
        }
    }

    /**
     * Guardar sentencia en Supabase
     */
    async saveSentenceToSupabase(sentencia) {
        try {
            const { data, error } = await this.supabase
                .from('jurisprudencia_cs')
                .insert([{
                    rol: sentencia.rol,
                    fecha: sentencia.fecha,
                    tribunal: sentencia.tribunal,
                    caratulado: sentencia.caratulado,
                    texto_completo: sentencia.texto_completo,
                    considerandos: sentencia.considerandos,
                    resolucion: sentencia.resolucion,
                    enlace: sentencia.enlace,
                    hash_contenido: sentencia.hash_contenido,
                    embeddings: sentencia.embeddings,
                    fecha_ingreso: sentencia.fecha_ingreso
                }]);
            
            if (error) {
                log.error('Error guardando en Supabase:', error);
                throw error;
            }
            
                log.info(`Sentencia guardada en Supabase: ${sentencia.rol}`);
            
        } catch (error) {
            log.error('Error en saveSentenceToSupabase:', error);
            throw error;
        }
    }

    /**
     * Imprimir estadísticas finales
     */
    async printFinalStats() {
        const duracion = moment().diff(this.stats.inicio, 'seconds');
        
        log.info('=== ESTADÍSTICAS FINALES ===');
        log.info(`Duración total: ${duracion} segundos`);
        log.info(`Total procesadas: ${this.stats.total_procesadas}`);
        log.info(`Exitosas: ${this.stats.exitosas}`);
        log.info(`Duplicadas: ${this.stats.duplicadas}`);
        log.info(`Errores: ${this.stats.errores}`);
        log.info('============================');
    }

    /**
     * Delay entre requests
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// --- INICIO SERVIDOR EXPRESS PARA RENDER WEB SERVICE ---
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Manejo global de errores para debug en Render
process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

app.get('/', (req, res) => {
    res.send('🟢 Scraper de Jurisprudencia listo. Usa /run-scraper para ejecutar.');
});

app.get('/run-scraper', async (req, res) => {
    log.info('🔔 Solicitud recibida en /run-scraper');
    try {
        const scraper = new JurisprudenciaScraper();
        await scraper.run();
        res.send('✅ Scraping completado. Revisa logs y base de datos.');
    } catch (error) {
        log.error('❌ Error ejecutando el scraper vía web:');
        if (error && error.stack) {
            console.error('STACK:', error.stack);
        }
        if (error && error.message) {
            console.error('MESSAGE:', error.message);
        }
        console.error('RAW ERROR:', error);
        res.status(500).send('❌ Error ejecutando el scraper. Revisa logs.');
    }
});

// Solo iniciar el servidor si es el archivo principal
if (require.main === module) {
    app.listen(PORT, () => {
        log.info(`🌐 Web Service escuchando en puerto ${PORT}`);
    });
} 