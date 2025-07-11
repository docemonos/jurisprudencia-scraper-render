-- ========================================
-- ESQUEMA DE BASE DE DATOS PARA JURISPRUDENCIA
-- ========================================
-- Tabla específica para Corte Suprema con optimización para pgvector + OpenAI embeddings

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Crear tabla principal para jurisprudencia de Corte Suprema
CREATE TABLE IF NOT EXISTS jurisprudencia_cs (
    -- Campos de identificación únicos
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rol VARCHAR(50) NOT NULL UNIQUE, -- ROL único para anti-duplicados
    k_parameter VARCHAR(255) NOT NULL, -- Parámetro k del sitio para URL de detalle
    url_detalle TEXT NOT NULL, -- URL completa del detalle
    
    -- Metadatos básicos de la sentencia
    caratula TEXT NOT NULL,
    fecha_sentencia DATE NOT NULL,
    tribunal VARCHAR(100) NOT NULL DEFAULT 'Corte Suprema',
    sala VARCHAR(50),
    
    -- Información del recurso
    tipo_recurso VARCHAR(100),
    resultado_recurso VARCHAR(100),
    materia VARCHAR(200),
    descriptores TEXT[], -- Array de descriptores/keywords
    
    -- Información de instancias previas
    corte_origen VARCHAR(200),
    ministro_redactor VARCHAR(200),
    
    -- Contenido textual
    texto_completo TEXT NOT NULL,
    parte_expositiva TEXT,
    considerandos TEXT,
    parte_resolutiva TEXT,
    votos_minoria TEXT,
    
    -- Embeddings vectoriales para búsquedas semánticas
    embedding_titulo VECTOR(1536), -- Embedding del título/carátula
    embedding_contenido VECTOR(1536), -- Embedding del contenido principal
    embedding_descriptores VECTOR(1536), -- Embedding de descriptores
    
    -- Metadatos de procesamiento
    hash_contenido VARCHAR(64) NOT NULL, -- Hash para detectar cambios
    fecha_scraping TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    version_scraper VARCHAR(20) DEFAULT '1.0.0',
    
    -- Estadísticas del texto
    num_caracteres INTEGER,
    num_palabras INTEGER,
    num_parrafos INTEGER,
    
    -- Campos de auditoría
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Campos de calidad y validación
    es_valido BOOLEAN DEFAULT true,
    errores_procesamiento TEXT[],
    calidad_extraccion INTEGER DEFAULT 100 CHECK (calidad_extraccion >= 0 AND calidad_extraccion <= 100)
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_rol ON jurisprudencia_cs(rol);
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_fecha ON jurisprudencia_cs(fecha_sentencia);
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_tribunal ON jurisprudencia_cs(tribunal);
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_materia ON jurisprudencia_cs(materia);
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_descriptores ON jurisprudencia_cs USING GIN(descriptores);
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_hash ON jurisprudencia_cs(hash_contenido);

-- Índices vectoriales para búsquedas semánticas
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_embedding_titulo ON jurisprudencia_cs USING ivfflat (embedding_titulo vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_embedding_contenido ON jurisprudencia_cs USING ivfflat (embedding_contenido vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_embedding_descriptores ON jurisprudencia_cs USING ivfflat (embedding_descriptores vector_cosine_ops) WITH (lists = 100);

-- Índices de texto completo para búsquedas tradicionales
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_texto_completo ON jurisprudencia_cs USING gin(to_tsvector('spanish', texto_completo));
CREATE INDEX IF NOT EXISTS idx_jurisprudencia_cs_caratula ON jurisprudencia_cs USING gin(to_tsvector('spanish', caratula));

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_jurisprudencia_cs_updated_at 
    BEFORE UPDATE ON jurisprudencia_cs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Función para búsqueda semántica por título
CREATE OR REPLACE FUNCTION buscar_por_titulo(query_embedding VECTOR(1536), limite INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    rol VARCHAR(50),
    caratula TEXT,
    fecha_sentencia DATE,
    similaridad FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        j.id,
        j.rol,
        j.caratula,
        j.fecha_sentencia,
        1 - (j.embedding_titulo <=> query_embedding) as similaridad
    FROM jurisprudencia_cs j
    WHERE j.embedding_titulo IS NOT NULL
    ORDER BY j.embedding_titulo <=> query_embedding
    LIMIT limite;
END;
$$ LANGUAGE plpgsql;

-- Función para búsqueda semántica por contenido
CREATE OR REPLACE FUNCTION buscar_por_contenido(query_embedding VECTOR(1536), limite INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    rol VARCHAR(50),
    caratula TEXT,
    fecha_sentencia DATE,
    similaridad FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        j.id,
        j.rol,
        j.caratula,
        j.fecha_sentencia,
        1 - (j.embedding_contenido <=> query_embedding) as similaridad
    FROM jurisprudencia_cs j
    WHERE j.embedding_contenido IS NOT NULL
    ORDER BY j.embedding_contenido <=> query_embedding
    LIMIT limite;
END;
$$ LANGUAGE plpgsql;

-- Función para verificar duplicados por ROL
CREATE OR REPLACE FUNCTION existe_sentencia_por_rol(rol_buscar VARCHAR(50))
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM jurisprudencia_cs 
        WHERE rol = rol_buscar
    );
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar hash de contenido
CREATE OR REPLACE FUNCTION actualizar_hash_contenido()
RETURNS TRIGGER AS $$
BEGIN
    NEW.hash_contenido = encode(sha256(NEW.texto_completo::bytea), 'hex');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_actualizar_hash_contenido
    BEFORE INSERT OR UPDATE OF texto_completo ON jurisprudencia_cs
    FOR EACH ROW EXECUTE FUNCTION actualizar_hash_contenido();

-- Crear política de seguridad (RLS)
ALTER TABLE jurisprudencia_cs ENABLE ROW LEVEL SECURITY;

-- Política para permitir lectura a todos los usuarios autenticados
CREATE POLICY "jurisprudencia_cs_select_policy" ON jurisprudencia_cs
    FOR SELECT USING (true);

-- Política para permitir inserción solo a usuarios con rol service_role
CREATE POLICY "jurisprudencia_cs_insert_policy" ON jurisprudencia_cs
    FOR INSERT WITH CHECK (true);

-- Política para permitir actualización solo a usuarios con rol service_role
CREATE POLICY "jurisprudencia_cs_update_policy" ON jurisprudencia_cs
    FOR UPDATE USING (true);

-- Crear vista para consultas optimizadas
CREATE OR REPLACE VIEW vista_jurisprudencia_cs AS
SELECT 
    id,
    rol,
    caratula,
    fecha_sentencia,
    tribunal,
    sala,
    tipo_recurso,
    resultado_recurso,
    materia,
    descriptores,
    corte_origen,
    ministro_redactor,
    substring(texto_completo, 1, 500) as resumen_texto,
    num_caracteres,
    num_palabras,
    fecha_scraping,
    es_valido,
    calidad_extraccion,
    created_at,
    updated_at
FROM jurisprudencia_cs
WHERE es_valido = true;

-- Estadísticas de la tabla
CREATE OR REPLACE VIEW estadisticas_jurisprudencia_cs AS
SELECT 
    COUNT(*) as total_sentencias,
    COUNT(DISTINCT materia) as total_materias,
    COUNT(DISTINCT ministro_redactor) as total_ministros,
    COUNT(DISTINCT sala) as total_salas,
    MIN(fecha_sentencia) as fecha_mas_antigua,
    MAX(fecha_sentencia) as fecha_mas_reciente,
    AVG(num_palabras) as promedio_palabras,
    AVG(calidad_extraccion) as calidad_promedio,
    COUNT(CASE WHEN embedding_contenido IS NOT NULL THEN 1 END) as con_embeddings,
    COUNT(CASE WHEN es_valido = false THEN 1 END) as invalidas
FROM jurisprudencia_cs;

-- Comentarios en la tabla
COMMENT ON TABLE jurisprudencia_cs IS 'Tabla principal para almacenar jurisprudencia de la Corte Suprema de Chile con embeddings vectoriales';
COMMENT ON COLUMN jurisprudencia_cs.rol IS 'ROL único de la sentencia para evitar duplicados';
COMMENT ON COLUMN jurisprudencia_cs.k_parameter IS 'Parámetro k del sitio web para construir URL de detalle';
COMMENT ON COLUMN jurisprudencia_cs.embedding_titulo IS 'Embedding vectorial del título/carátula para búsquedas semánticas';
COMMENT ON COLUMN jurisprudencia_cs.embedding_contenido IS 'Embedding vectorial del contenido completo para búsquedas semánticas';
COMMENT ON COLUMN jurisprudencia_cs.hash_contenido IS 'Hash SHA-256 del contenido para detectar cambios';
COMMENT ON COLUMN jurisprudencia_cs.calidad_extraccion IS 'Puntuación de calidad de la extracción (0-100)'; 