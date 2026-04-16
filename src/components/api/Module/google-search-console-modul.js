/**
 * ═══════════════════════════════════════════════════════════════
 *  Kynto Intel — src/components/api/Module/google-search-console-modul.js
 *
 *  FIX 1: ES Module `export` → CommonJS `module.exports`
 *  FIX 2: `fetch` (Browser) → `https` (Node.js Main Process)
 *  FIX 3: registerGSC() → registriert Config in DB + configCache
 *  FIX 4: auth_type 'oauth2' → 'bearer' (kompatibel mit apiHandler)
 *  FIX 5: Token-Refresh Logik hinzugefügt
 * ═══════════════════════════════════════════════════════════════
 */

const https       = require('https');
const querystring = require('querystring');
const axios       = require('axios');

const path = require('path');
const fs  = require('fs');

// Erst danach kommen die anderen Requires:
const { dbApi }  = require(path.join(__dirname, '..', 'database.js'));
const apiHandler = require(path.join(__dirname, '..', 'apiHandler.js'));
const GSCMapper  = require('./google-search-console-data-mapper.js');

// ─── Settings Loader ─────────────────────────────────────────────
function loadSettings() {
    try {
        const settingsPath = path.join(__dirname, '../../../../data/settings.json');
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (e) {
        console.warn('[GSC] Fehler beim Laden von settings.json:', e.message);
    }
    return {};
}

// ─── Konfiguration laden (aus settings.json) ────────────────────────
function getGSCConfig() {
    const settings = loadSettings();
    const credentials = settings.apis?.credentials?.['google-search-console'] || {};
    
    // FEHLER wenn keine Credentials konfiguriert
    if (!credentials.clientId || !credentials.clientSecret) {
        throw new Error(
            '[GSC] ❌ Google Search Console nicht konfiguriert!\n' +
            'Bitte geben Sie clientId und clientSecret in settings.json unter:\n' +
            'apis.credentials["google-search-console"] ein'
        );
    }
    
    return {
        id:       'google-search-console',
        name:     'Google Search Console',
        category: 'seo',
        base_url: 'https://searchconsole.googleapis.com/webmasters/v3',
        auth_type: 'bearer',
        auth_config: {
            clientId:     credentials.clientId,
            clientSecret: credentials.clientSecret,
            redirectUri:  credentials.redirectUri || 'http://localhost:3000/api/auth/google/callback',
            authUrl:      'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl:     'https://oauth2.googleapis.com/token',
            scope:        'https://www.googleapis.com/auth/webmasters.readonly',
        },
        endpoints: {
            sites:           '/sites',
            sitemaps:        '/sites/{siteUrl}/sitemaps',
            searchAnalytics: '/sites/{siteUrl}/searchAnalytics/query',
            urlInspection:   'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
        },
        rate_limit_ms: 1000,
    };
}

let GSC_CONFIG = null;

// ─── In-Memory Token Store (ergänzend zur DB) ───────────────────
let _tokenExpiry = null; // Unix-Timestamp ms, wann access_token abläuft

// ─── SCHRITT 0: GSC in apiHandler registrieren ──────────────────
/**
 * Muss einmal beim App-Start aufgerufen werden (in main.js).
 * Schreibt die Config in die SQLite-DB und aktualisiert den configCache.
 */
function registerGSC() {
    try {
        // Lade Config aus settings.json (wirft Fehler wenn nicht konfiguriert)
        GSC_CONFIG = getGSCConfig();
        
        dbApi.saveConfig({
            id:              GSC_CONFIG.id,
            name:            GSC_CONFIG.name,
            category:        GSC_CONFIG.category,
            base_url:        GSC_CONFIG.base_url,
            auth_type:       GSC_CONFIG.auth_type,
            auth_config:     GSC_CONFIG.auth_config,
            default_headers: {},
            default_params:  {},
            rate_limit_ms:   GSC_CONFIG.rate_limit_ms,
        });

        // configCache in apiHandler aktualisieren
        apiHandler.register({
            id:          GSC_CONFIG.id,
            name:        GSC_CONFIG.name,
            category:    GSC_CONFIG.category,
            base_url:    GSC_CONFIG.base_url,
            auth_type:   GSC_CONFIG.auth_type,
            auth_config: GSC_CONFIG.auth_config,
            rate_limit_ms: GSC_CONFIG.rate_limit_ms,
        });

        // Gespeicherte Tokens wiederherstellen
        restoreStoredTokens();

        console.log('[GSC] ✅ Google Search Console erfolgreich registriert');
    } catch (e) {
        console.warn('[GSC] ⚠ Registrierung fehlgeschlagen:', e.message);
        console.warn('[GSC] Bitte konfigurieren Sie Google Search Console in settings.json');
    }
}

/**
 * Stellt gespeicherte Tokens beim App-Start wieder her.
 * Wird nach registerGSC() automatisch aufgerufen.
 */
function restoreStoredTokens() {
    try {
        const accessToken = dbApi.getApiKey(GSC_CONFIG.id);
        const refreshToken = dbApi.getSecret('gsc:refresh_token');
        
        if (accessToken) {
            console.log('[GSC] ✅ Access Token aus Speicher wiederhergestellt');
            // _tokenExpiry auf "sofort-erneuern" setzen damit refreshGSCTokenIfNeeded aufgerufen wird
            _tokenExpiry = Date.now() - 1; // Abgelaufen
        }
        
        if (refreshToken) {
            console.log('[GSC] ✅ Refresh Token gefunden – Verbindung bleibt bestehen');
        } else if (accessToken) {
            console.log('[GSC] ⚠ Access Token vorhanden, aber kein Refresh Token gespeichert');
        }
    } catch (e) {
        console.warn('[GSC] Fehler beim Wiederherstellen der Tokens:', e.message);
    }
}

// ─── SCHRITT 1: OAuth2-URL generieren ───────────────────────────
/**
 * Öffnet den Google-Login im externen Browser (via shell.openExternal).
 */
function getGSCAuthUrl() {
    const params = new URLSearchParams({
        client_id:     GSC_CONFIG.auth_config.clientId,
        redirect_uri:  GSC_CONFIG.auth_config.redirectUri,
        response_type: 'code',
        scope:         GSC_CONFIG.auth_config.scope,
        access_type:   'offline', // Refresh Token erhalten
        prompt:        'consent'  // Erzwingt Refresh Token Erstellung
    });
    return `${GSC_CONFIG.auth_config.authUrl}?${params.toString()}`;
}

// ─── SCHRITT 2: Authorization Code gegen Tokens tauschen ────────
/**
 * Läuft im Main Process → benutzt Node.js `https`, NICHT fetch.
 * Nach Erfolg werden access_token UND refresh_token in der DB gespeichert.
 *
 * @param {string} code - Der Code aus dem Google OAuth2 Redirect
 * @returns {Promise<{access_token, refresh_token, expires_in}>}
 */
function exchangeGSCCodeForTokens(code) {
    return new Promise((resolve, reject) => {
        const body = querystring.stringify({
            code,
            client_id:     GSC_CONFIG.auth_config.clientId,
            client_secret: GSC_CONFIG.auth_config.clientSecret,
            redirect_uri:  GSC_CONFIG.auth_config.redirectUri,
            grant_type:    'authorization_code',
        });

        const options = {
            hostname: 'oauth2.googleapis.com',
            path:     '/token',
            method:   'POST',
            headers: {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const tokens = JSON.parse(data);
                    if (tokens.error) {
                        reject(new Error(`Google Fehler: ${tokens.error_description || tokens.error}`));
                    } else {
                        // FIX: Tokens direkt in DB speichern, damit apiHandler sie findet
                        _saveTokens(tokens);
                        resolve(tokens);
                    }
                } catch (e) {
                    reject(new Error('Token-Verarbeitung fehlgeschlagen: ' + e.message));
                }
            });
        });

        req.on('error', (e) => {
            console.error('[GSC] Token Exchange fehlgeschlagen:', e);
            reject(new Error('Netzwerkfehler beim Token Exchange: ' + e.message));
        });

        req.write(body);
        req.end();
    });
}

// ─── SCHRITT 3: Token intern speichern ──────────────────────────
/**
 * Speichert access_token als Bearer-Token in der DB (für apiHandler).
 * Refresh Token wird OHNE FK-Constraint in api_secrets gespeichert.
 *
 * @param {{ access_token, refresh_token, expires_in }} tokens
 */
function _saveTokens(tokens) {
    try {
        // access_token → api_keys (hat FK auf api_configs — Eintrag existiert nach registerGSC())
        if (tokens.access_token) {
            dbApi.saveApiKey(GSC_CONFIG.id, tokens.access_token);
        }

        // refresh_token → api_secrets (KEIN FK — kein Constraint-Problem)
        if (tokens.refresh_token) {
            dbApi.saveSecret('gsc:refresh_token', tokens.refresh_token);
        }

        // Ablaufzeit merken (expires_in = Sekunden)
        if (tokens.expires_in) {
            _tokenExpiry = Date.now() + (tokens.expires_in - 60) * 1000; // 60s Puffer
        }

        console.log('[GSC] ✅ Tokens gespeichert. Access Token läuft ab in:', tokens.expires_in, 'Sekunden');
    } catch (e) {
        console.error('[GSC] ❌ Fehler beim Speichern der Tokens:', e.message);
        throw e;
    }
}

// ─── SCHRITT 4: Token automatisch erneuern ───────────────────────
/**
 * Prüft ob der access_token abgelaufen ist und erneuert ihn via refresh_token.
 * Wird aufgerufen bevor ein GSC-API-Call gemacht wird.
 *
 * @returns {Promise<boolean>} true wenn Token gültig/erneuert, false wenn kein Refresh Token
 */
function refreshGSCTokenIfNeeded() {
    return new Promise((resolve, reject) => {
        // Token noch gültig?
        if (_tokenExpiry && Date.now() < _tokenExpiry) {
            return resolve(true);
        }

        const refreshToken = dbApi.getSecret('gsc:refresh_token');
        if (!refreshToken) {
            console.warn('[GSC] Kein Refresh Token vorhanden – erneute Anmeldung erforderlich');
            return resolve(false);
        }

        console.log('[GSC] Access Token abgelaufen – erneuere via Refresh Token...');

        const body = querystring.stringify({
            client_id:     GSC_CONFIG.auth_config.clientId,
            client_secret: GSC_CONFIG.auth_config.clientSecret,
            refresh_token: refreshToken,
            grant_type:    'refresh_token',
        });

        const options = {
            hostname: 'oauth2.googleapis.com',
            path:     '/token',
            method:   'POST',
            headers: {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const tokens = JSON.parse(data);
                    if (tokens.error) {
                        reject(new Error(`Token Refresh Fehler: ${tokens.error_description || tokens.error}`));
                    } else {
                        _saveTokens(tokens);
                        console.log('[GSC] ✅ Access Token erfolgreich erneuert');
                        resolve(true);
                    }
                } catch (e) {
                    reject(new Error('Ungültige JSON-Antwort beim Token Refresh: ' + e.message));
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error('Netzwerkfehler beim Token Refresh: ' + e.message));
        });

        req.write(body);
        req.end();
    });
}

// ─── Prüfen ob GSC authentifiziert ist ──────────────────────────
/**
 * Gibt true zurück wenn ein access_token in der DB gespeichert ist.
 */
function isGSCAuthenticated() {
    const token = dbApi.getApiKey(GSC_CONFIG.id);
    return !!token;
}

// ─── DATEN-ABRUF FUNKTIONEN (Verbindung zum Mapper) ─────────────

/**
 * Ruft die Liste der verifizierten Websites ab.
 */
async function getGSCSites() {
    const isReady = await refreshGSCTokenIfNeeded();
    if (!isReady) throw new Error('Nicht authentifiziert');

    const response = await apiHandler.call(GSC_CONFIG.id, '/sites');
    return GSCMapper.mapSites(response.siteEntry);
}

/**
 * Ruft Performance-Daten (Clicks, Impressions, etc.) ab.
 */
async function getGSCSearchPerformance(siteUrl, startDate, endDate, dimensions = ['query', 'page', 'country', 'device', 'date']) {
    const isReady = await refreshGSCTokenIfNeeded();
    if (!isReady) throw new Error('Nicht authentifiziert');

    // Versuche das siteUrl Format automatisch zu erraten
    let attempts = [];
    
    if (siteUrl.startsWith('http')) {
        // Wenn es eine volle URL ist, encode as-is
        attempts.push(encodeURIComponent(siteUrl));
    } else {
        // Sonst versuche sc-domain: prefix und https:// prefix
        attempts.push(encodeURIComponent(`sc-domain:${siteUrl}`));
        attempts.push(encodeURIComponent(`https://${siteUrl}`));
    }
    
    console.log('[GSC] fetchPerformance Versuche:', { siteUrl, attempts, startDate, endDate });
    
    let lastError = null;
    
    for (let i = 0; i < attempts.length; i++) {
        const encodedSiteUrl = attempts[i];
        const endpoint = `/sites/${encodedSiteUrl}/searchAnalytics/query`;
        
        try {
            console.log(`[GSC] Versuch ${i + 1}/${attempts.length}: ${endpoint}`);
            
            const response = await apiHandler.call(GSC_CONFIG.id, endpoint, {}, {
                method: 'POST',
                body: {
                    startDate,
                    endDate,
                    dimensions,
                    rowLimit: 1000
                }
            });

            console.log('[GSC] ✅ API erfolgreich angerufen');
            console.log('[GSC] Response:', { 
                hasRows: !!response?.rows, 
                rowCount: response?.rows?.length || 0,
                firstRow: response?.rows?.[0] 
            });
            
            const rows = response?.rows || [];
            const mapped = GSCMapper.mapSearchAnalytics(rows, dimensions);
            console.log(`[GSC] Mapped: ${mapped.length} Zeilen`);
            
            return mapped;
            
        } catch (e) {
            lastError = e;
            console.warn(`[GSC] Versuch ${i + 1} fehlgeschlagen:`, e.message);
            // Nächster Versuch...
        }
    }
    
    // Alle Versuche fehlgeschlagen
    console.error('[GSC] ❌ Alle Versuche fehlgeschlagen:', lastError?.message);
    throw new Error(`GSC-Anfrage fehlgeschlagen für ${siteUrl}: ${lastError?.message}`);
}

/**
 * Ruft die Sitemaps einer Website ab.
 */
async function getGSCSitemaps(siteUrl) {
    const isReady = await refreshGSCTokenIfNeeded();
    if (!isReady) throw new Error('Nicht authentifiziert');

    // URL-encode siteUrl für Pfad
    const encodedSiteUrl = encodeURIComponent(siteUrl.startsWith('http') ? siteUrl : `sc-domain:${siteUrl}`);
    
    const response = await apiHandler.call(GSC_CONFIG.id, `/sites/${encodedSiteUrl}/sitemaps`);
    return GSCMapper.mapSitemaps(response.sitemap);
}

/**
 * Prüft eine spezifische URL (URL Inspection Tool).
 */
async function inspectGSCUrl(siteUrl, inspectionUrl) {
    const isReady = await refreshGSCTokenIfNeeded();
    if (!isReady) throw new Error('Nicht authentifiziert');

    const keyVal = dbApi.getApiKey(GSC_CONFIG.id);
    if (!keyVal) throw new Error('Kein Bearer Token für GSC');
    
    // URL Inspection API hat einen anderen Endpoint als der Rest von GSC
    const response = await axios.post(
        'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
        {
            inspectionUrl,
            siteUrl,
            languageCode: 'de'
        },
        {
            headers: {
                'Authorization': `Bearer ${keyVal}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return GSCMapper.mapUrlInspection(response.data);
}

// ─── CommonJS Export ─────────────────────────────────────────────
module.exports = {
    GSC_CONFIG,
    registerGSC,
    getGSCAuthUrl,
    exchangeGSCCodeForTokens,
    refreshGSCTokenIfNeeded,
    isGSCAuthenticated,
    getGSCSites,
    getGSCSearchPerformance,
    getGSCSitemaps,
    inspectGSCUrl
};