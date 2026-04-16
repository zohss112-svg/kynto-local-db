/**
 * ═══════════════════════════════════════════════════════════════
 *  THE SOVEREIGN API-BRIDGE — apiHandler.js
 *  Universal-Konnektor: Jede API. Eine Schnittstelle. Lokale Hoheit.
 * ═══════════════════════════════════════════════════════════════
 */

const axios  = require('axios');
const { flat } = require('flat');
const { dbApi, buildRequestHash, safeJson } = require('./database');

// ─── Vordefinierte API-Konnektoren ───────────────────────────────
// (Werden beim ersten Start automatisch in die DB geladen)
const BUILTIN_CONNECTORS = [
  // ── WETTER ──────────────────────────────────────────────────
  {
    id: 'openweathermap',
    name: 'OpenWeatherMap',
    category: 'weather',
    base_url: 'https://api.openweathermap.org/data/2.5',
    auth_type: 'apikey',
    auth_config: { keyParam: 'appid' },
    default_params: { units: 'metric', lang: 'de' },
    rate_limit_ms: 1000,
    endpoints: {
      current:  '/weather',        // ?q=Berlin
      forecast: '/forecast',       // ?q=Berlin
      onecall:  '/onecall',        // ?lat=52&lon=13
    },
    mapping: {
      current: {
        'main.temp':        'temperatur_celsius',
        'main.feels_like':  'gefuehlt_celsius',
        'main.humidity':    'luftfeuchtigkeit_prozent',
        'main.pressure':    'luftdruck_hpa',
        'wind.speed':       'windgeschwindigkeit_ms',
        'wind.deg':         'windrichtung_grad',
        'weather.0.description': 'wetter_beschreibung',
        'weather.0.icon':   'wetter_icon',
        'name':             'stadt',
        'sys.country':      'land',
        'dt':               'zeitstempel_unix',
        'visibility':       'sichtweite_meter',
      }
    }
  },
  {
    id: 'weatherapi',
    name: 'WeatherAPI.com',
    category: 'weather',
    base_url: 'https://api.weatherapi.com/v1',
    auth_type: 'apikey',
    auth_config: { keyParam: 'key' },
    rate_limit_ms: 500,
    endpoints: {
      current:  '/current.json',   // ?q=Berlin
      forecast: '/forecast.json',  // ?q=Berlin&days=3
      history:  '/history.json',   // ?q=Berlin&dt=2024-01-01
    },
    mapping: {
      current: {
        'current.temp_c':               'temperatur_celsius',
        'current.feelslike_c':          'gefuehlt_celsius',
        'current.humidity':             'luftfeuchtigkeit_prozent',
        'current.wind_kph':             'wind_kmh',
        'current.condition.text':       'wetter_status',
        'current.condition.icon':       'wetter_icon',
        'location.name':                'stadt',
        'location.country':             'land',
        'location.localtime':           'lokalzeit',
      }
    }
  },

  // ── SUCHE ────────────────────────────────────────────────────
  {
    id: 'bing-search',
    name: 'Bing Web Search',
    category: 'search',
    base_url: 'https://api.bing.microsoft.com/v7.0',
    auth_type: 'header',
    auth_config: { headerName: 'Ocp-Apim-Subscription-Key' },
    default_params: { mkt: 'de-DE', count: 10 },
    rate_limit_ms: 200,
    endpoints: {
      search:  '/search',          // ?q=...
      news:    '/news/search',     // ?q=...
      images:  '/images/search',   // ?q=...
      videos:  '/videos/search',   // ?q=...
    },
    mapping: {
      search: {
        'webPages.value':              'ergebnisse',
        'webPages.totalEstimatedMatches': 'gesamt_treffer',
        '_type':                       'antwort_typ',
        'queryContext.originalQuery':  'suchanfrage',
      }
    }
  },
  {
    id: 'google-custom-search',
    name: 'Google Custom Search',
    category: 'search',
    base_url: 'https://www.googleapis.com/customsearch/v1',
    auth_type: 'apikey',
    auth_config: { keyParam: 'key' },
    default_params: { hl: 'de', gl: 'de', num: 10 },
    rate_limit_ms: 500,
    endpoints: {
      search: '',                  // ?q=...&cx=SEARCH_ENGINE_ID
    },
    mapping: {
      search: {
        'items':               'ergebnisse',
        'searchInformation.totalResults': 'gesamt_treffer',
        'searchInformation.searchTime':   'suchzeit_s',
        'queries.request.0.searchTerms': 'suchanfrage',
      }
    }
  },

  // ── KARTEN ───────────────────────────────────────────────────
  {
    id: 'google-maps',
    name: 'Google Maps',
    category: 'maps',
    base_url: 'https://maps.googleapis.com/maps/api',
    auth_type: 'apikey',
    auth_config: { keyParam: 'key' },
    rate_limit_ms: 200,
    endpoints: {
      geocode:    '/geocode/json',      // ?address=Berlin
      directions: '/directions/json',   // ?origin=...&destination=...
      places:     '/place/nearbysearch/json', // ?location=52,13&radius=500
      elevation:  '/elevation/json',    // ?locations=52,13
      timezone:   '/timezone/json',     // ?location=52,13&timestamp=...
    },
    mapping: {
      geocode: {
        'results.0.formatted_address':           'adresse',
        'results.0.geometry.location.lat':       'breitengrad',
        'results.0.geometry.location.lng':       'laengengrad',
        'results.0.place_id':                    'place_id',
        'results.0.address_components':          'adress_komponenten',
        'status':                                'status',
      }
    }
  },
  {
    id: 'openstreetmap-nominatim',
    name: 'OpenStreetMap Nominatim (kostenlos)',
    category: 'maps',
    base_url: 'https://nominatim.openstreetmap.org',
    auth_type: 'none',
    default_headers: { 'User-Agent': 'SovereignApiBridge/1.0' },
    default_params: { format: 'json', addressdetails: 1 },
    rate_limit_ms: 1100,             // OSM-Policy: max 1 req/s
    endpoints: {
      search:  '/search',            // ?q=Berlin
      reverse: '/reverse',           // ?lat=52&lon=13
      lookup:  '/lookup',            // ?osm_ids=R62422
    },
    mapping: {
      search: {
        '0.display_name':   'vollstaendige_adresse',
        '0.lat':            'breitengrad',
        '0.lon':            'laengengrad',
        '0.type':           'typ',
        '0.address.city':   'stadt',
        '0.address.country':'land',
      }
    }
  },

  // ── MAIL ─────────────────────────────────────────────────────
  {
    id: 'gmail',
    name: 'Gmail API (Google)',
    category: 'mail',
    base_url: 'https://gmail.googleapis.com/gmail/v1/users/me',
    auth_type: 'oauth2',
    auth_config: {
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    },
    rate_limit_ms: 100,
    endpoints: {
      messages:  '/messages',        // ?maxResults=10&q=...
      send:      '/messages/send',   // POST
      labels:    '/labels',
      threads:   '/threads',
    },
    mapping: {
      messages: {
        'messages':      'nachrichten',
        'nextPageToken': 'naechste_seite',
        'resultSizeEstimate': 'geschaetzte_anzahl',
      }
    }
  },
  {
    id: 'sendgrid',
    name: 'SendGrid Mail',
    category: 'mail',
    base_url: 'https://api.sendgrid.com/v3',
    auth_type: 'bearer',
    rate_limit_ms: 200,
    endpoints: {
      send:      '/mail/send',       // POST
      stats:     '/stats',           // ?start_date=...
      contacts:  '/marketing/contacts',
    }
  },

  // ── KALENDER ─────────────────────────────────────────────────
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'calendar',
    base_url: 'https://www.googleapis.com/calendar/v3',
    auth_type: 'oauth2',
    auth_config: {
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
    },
    rate_limit_ms: 100,
    endpoints: {
      list:     '/calendars/primary/events',  // ?maxResults=10
      create:   '/calendars/primary/events',  // POST
      calList:  '/users/me/calendarList',
    },
    mapping: {
      list: {
        'items':       'termine',
        'summary':     'kalender_name',
        'nextPageToken': 'naechste_seite',
      }
    }
  },

  // ── FINANZEN ─────────────────────────────────────────────────
  {
    id: 'alpha-vantage',
    name: 'Alpha Vantage (Aktien/Krypto)',
    category: 'finance',
    base_url: 'https://www.alphavantage.co/query',
    auth_type: 'apikey',
    auth_config: { keyParam: 'apikey' },
    rate_limit_ms: 12000,            // Free: 5 req/min
    endpoints: {
      quote:       '',               // ?function=GLOBAL_QUOTE&symbol=AAPL
      intraday:    '',               // ?function=TIME_SERIES_INTRADAY
      crypto:      '',               // ?function=CURRENCY_EXCHANGE_RATE
      forex:       '',               // ?function=FX_DAILY
    },
    mapping: {
      quote: {
        'Global Quote.01. symbol':         'symbol',
        'Global Quote.05. price':          'kurs',
        'Global Quote.09. change':         'veraenderung',
        'Global Quote.10. change percent': 'veraenderung_prozent',
        'Global Quote.06. volume':         'volumen',
      }
    }
  },

  // ── NEWS ─────────────────────────────────────────────────────
  {
    id: 'newsapi',
    name: 'NewsAPI.org',
    category: 'news',
    base_url: 'https://newsapi.org/v2',
    auth_type: 'apikey',
    auth_config: { keyParam: 'apiKey' },
    rate_limit_ms: 1000,
    endpoints: {
      top:        '/top-headlines',    // ?country=de&category=...
      everything: '/everything',       // ?q=...&from=...
      sources:    '/sources',
    },
    mapping: {
      top: {
        'articles':    'artikel',
        'totalResults':'gesamt_artikel',
        'status':      'status',
      }
    }
  },

  // ── GITHUB ───────────────────────────────────────────────────
  {
    id: 'github',
    name: 'GitHub API',
    category: 'developer',
    base_url: 'https://api.github.com',
    auth_type: 'bearer',
    default_headers: { 'Accept': 'application/vnd.github.v3+json' },
    rate_limit_ms: 100,
    endpoints: {
      repos:    '/user/repos',
      issues:   '/repos/{owner}/{repo}/issues',
      commits:  '/repos/{owner}/{repo}/commits',
      search:   '/search/repositories',
    }
  },

  // ── SHOPIFY ──────────────────────────────────────────────────
  {
    id: 'shopify',
    name: 'Shopify API',
    category: 'ecommerce',
    base_url: 'https://{store}.myshopify.com/admin/api/2024-01',
    auth_type: 'client_credentials',
    auth_config: {
      clientId: '',        // Wird via setApiKey gesetzt
      clientSecret: '',    // Wird via setApiKey gesetzt
      tokenUrl: 'https://{store}.myshopify.com/admin/oauth/access_token',
      grantType: 'client_credentials'
    },
    rate_limit_ms: 300,
    endpoints: {
      products:     '/products.json',
      orders:       '/orders.json',
      customers:    '/customers.json',
      variants:     '/products/{productId}/variants.json',
      fulfillments: '/orders/{orderId}/fulfillments.json',
      shop:         '/shop.json',
    },
    mapping: {
      products: {
        'id':            'shopify_id',
        'title':         'produkt_titel',
        'handle':        'produkt_handle',
        'status':        'status',
        'vendor':        'hersteller',
        'product_type':  'produkt_typ',
        'created_at':    'erstellt_am',
        'updated_at':    'aktualisiert_am',
      },
      orders: {
        'id':                'shopify_id',
        'order_number':      'bestellnummer',
        'total_price':       'gesamtpreis',
        'financial_status':  'finanzieller_status',
        'fulfillment_status':'erfuellungsstatus',
        'created_at':        'erstellt_am',
      },
      customers: {
        'id':           'shopify_id',
        'email':        'email',
        'first_name':   'vorname',
        'last_name':    'nachname',
        'total_spent':  'gesamt_ausgegeben',
        'orders_count': 'bestellungsanzahl',
      }
    }
  },

  // ── SEO ──────────────────────────────────────────────────────
{
    id: 'google-search-console',
    name: 'Google Search Console',
    category: 'seo',
    base_url: 'https://searchconsole.googleapis.com/webmasters/v3',
    auth_type: 'oauth2',
    auth_config: {
      // DIESE BEIDEN FINDEST DU IN DEINEM GOOGLE CLOUD BILD (Credentials):
      clientId: '642235149075-fiu9uo7jf9s7ase0ka753mnoh4gef5aj.apps.googleusercontent.com', 
      clientSecret: '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', 
      
      // HIER STELLST DU EIN, WOHIN GOOGLE DICH SCHICKT:
      redirectUri: 'http://localhost:3000/api/auth/google/callback',
      
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    },
    rate_limit_ms: 500,
    endpoints: {
      sites:           '/sites',
      sitemaps:        '/sites/{siteUrl}/sitemaps',
      searchAnalytics: '/sites/{siteUrl}/searchAnalytics/query',
      urlInspection:   'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
    },
    mapping: {
      searchAnalytics: {
        'rows':                    'zeilen',
        'responseAggregationType': 'aggregationstyp',
      },
      sites: {
        'siteEntry':               'seiten',
      }
    }
  },
  {
    id: 'google-keyword-planner',
    name: 'Google Keyword Planner (Ads API)',
    category: 'seo',
    base_url: 'https://googleads.googleapis.com/v17',
    auth_type: 'oauth2',
    auth_config: {
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/adwords',
    },
    // Zusätzlich: Developer-Token im Header + Login-Customer-ID Header nötig
    default_headers: {
      'developer-token': '',          // Wird via setApiKey('google-keyword-planner-devtoken', ...) gesetzt
      'login-customer-id': '',        // Wird über custom_params befüllt
    },
    rate_limit_ms: 1000,
    endpoints: {
      keywordIdeas:    '/customers/{customerId}/googleAds:generateKeywordIdeas',           // POST
      keywordMetrics:  '/customers/{customerId}/googleAds:generateKeywordHistoricalMetrics', // POST
      campaignBudget:  '/customers/{customerId}/googleAds:suggestSmartCampaignBudgetOptions', // POST
    },
    mapping: {
      keywordIdeas: {
        'results':                                        'keyword_ideen',
        'results.0.text':                                 'keyword_0_text',
        'results.0.keywordIdeaMetrics.avgMonthlySearches':'keyword_0_monatl_suchen',
        'results.0.keywordIdeaMetrics.competition':       'keyword_0_wettbewerb',
      }
    }
  },
  {
    id: 'dataforseo',
    name: 'DataForSEO',
    category: 'seo',
    base_url: 'https://api.dataforseo.com/v3',
    auth_type: 'basic',   // login:password als Basic-Auth
    rate_limit_ms: 500,
    endpoints: {
      serp:        '/serp/google/organic/live/advanced',         // POST: [{ keyword, location_code, language_code }]
      keywords:    '/keywords_data/google_ads/keywords_for_site/live', // POST: [{ target, location_code }]
      backlinks:   '/backlinks/summary/live',                    // POST: [{ target }]
      onPage:      '/on_page/task_post',                         // POST: [{ target, max_crawl_pages }]
      rankTracker: '/rank_tracker/google/live',                  // POST: [{ keywords, domain }]
    },
    mapping: {
      serp: {
        'tasks.0.result.0.items':        'ergebnisse',
        'tasks.0.result.0.total_count':  'gesamt_treffer',
        'tasks.0.result.0.keyword':      'keyword',
        'tasks.0.cost':                  'kosten',
        'status_code':                   'status_code',
        'status_message':                'status_nachricht',
      },
      keywords: {
        'tasks.0.result.0.items':                         'keyword_daten',
        'tasks.0.result.0.items.0.keyword':               'keyword',
        'tasks.0.result.0.items.0.search_volume':         'suchvolumen',
        'tasks.0.result.0.items.0.competition':           'wettbewerb',
        'tasks.0.result.0.items.0.cpc':                   'cpc',
      },
      backlinks: {
        'tasks.0.result.0.total_count':  'backlinks_gesamt',
        'tasks.0.result.0.referring_domains': 'verweisende_domains',
        'tasks.0.result.0.rank':         'rank',
        'tasks.0.result.0.spam_score':   'spam_score',
      }
    }
  },
  {
    id: 'google-trends',
    name: 'Google Trends (via SerpAPI)',
    category: 'seo',
    base_url: 'https://serpapi.com',
    auth_type: 'apikey',
    auth_config: { keyParam: 'api_key' },
    default_params: { engine: 'google_trends' },
    rate_limit_ms: 1000,
    endpoints: {
      trends:   '/search',    // ?q=keyword&data_type=TIMESERIES
      trending: '/search',    // ?data_type=TRENDING_SEARCHES&geo=DE
      related:  '/search',    // ?q=keyword&data_type=RELATED_QUERIES
    },
    mapping: {
      trends: {
        'interest_over_time.timeline_data': 'zeitverlauf',
        'interest_by_region':               'regionen',
        'related_queries.top':              'verwandte_top',
        'related_queries.rising':           'verwandte_aufsteigend',
        'search_parameters.q':             'suchanfrage',
      }
    }
  },

  // ── ÖFFENTLICHE DATEN ────────────────────────────────────────
  {
    id: 'open-meteo',
    name: 'Open-Meteo (kostenlos, kein Key)',
    category: 'weather',
    base_url: 'https://api.open-meteo.com/v1',
    auth_type: 'none',
    rate_limit_ms: 500,
    endpoints: {
      forecast: '/forecast',     // ?latitude=52&longitude=13&hourly=temperature_2m
    },
    mapping: {
      forecast: {
        'latitude':              'breitengrad',
        'longitude':             'laengengrad',
        'hourly.time':           'zeiten',
        'hourly.temperature_2m': 'temperaturen_2m',
        'timezone':              'zeitzone',
      }
    }
  },
];

// ─── ApiHandler Klasse ───────────────────────────────────────────
class ApiHandler {
  constructor() {
    this._loadBuiltinConnectors();
  }

  /**
   * Vordefinierte Konnektoren in die DB laden (nur wenn noch nicht vorhanden)
   */
  _loadBuiltinConnectors() {
    for (const c of BUILTIN_CONNECTORS) {
      if (!dbApi.getConfig(c.id)) {
        const { endpoints, mapping, ...config } = c;
        dbApi.saveConfig(config);
        // Standard-Retention setzen
        dbApi.saveRetention(c.id, { mode: 'ttl', ttl_hours: 24, max_entries: 500, auto_archive: 0 });
        // Vordefinierte Mappings speichern
        if (mapping) {
          for (const [endpoint, map] of Object.entries(mapping)) {
            dbApi.saveMapping(c.id, endpoint, map);
          }
        }
      }
    }
  }

  /**
   * ══════════════════════════════════════════════
   *  HAUPT-METHODE: Universeller API-Call
   * ══════════════════════════════════════════════
   */
  async call(configId, endpoint = '', params = {}, options = {}) {
    const config = dbApi.getConfig(configId);
    if (!config) throw new Error(`API "${configId}" nicht gefunden`);

    const startTime = Date.now();
    const endpoint_str = String(endpoint);
    const mergedParams = { ...safeJson(config.default_params), ...params };
    const requestHash  = buildRequestHash(configId, endpoint_str, mergedParams);

    // ── 1. Cache-Check ──────────────────────────────────────────
    if (options.cache !== false) {
      const cached = dbApi.getCached(requestHash);
      if (cached) {
        dbApi.incrementCacheHit(requestHash, options.estimatedCost || 0.001);
        dbApi.log({
          config_id: configId, endpoint: endpoint_str,
          params_json: JSON.stringify(mergedParams),
          source: 'cache', status_code: 200,
          duration_ms: Date.now() - startTime, error_msg: null,
        });
        return {
          data: safeJson(cached.mapped_data, safeJson(cached.raw_response)),
          raw: safeJson(cached.raw_response),
          fromCache: true,
          cachedAt: cached.created_at,
        };
      }
    }

    // ── 2. Rate-Limit einhalten ─────────────────────────────────
    await this._respectRateLimit(config);

    // ── 3. Auth aufbauen ────────────────────────────────────────
    const { headers, queryParams } = await this._buildAuth(config, mergedParams);

    // ── 4. URL zusammensetzen ────────────────────────────────────
    const baseUrl  = config.base_url.replace(/\/$/, '');
    const fullUrl  = endpoint_str ? `${baseUrl}${endpoint_str}` : baseUrl;
    const method   = (options.method || 'GET').toUpperCase();

    // ── 5. HTTP-Request ─────────────────────────────────────────
    let rawData, statusCode;
    try {
      const response = await axios({
        method,
        url: fullUrl,
        headers: { ...safeJson(config.default_headers), ...headers },
        params: method === 'GET' ? queryParams : {},
        data:   method !== 'GET' ? (options.body || queryParams) : undefined,
        timeout: options.timeout || 15000,
      });
      rawData    = response.data;
      statusCode = response.status;

      // last_called_at aktualisieren
      dbApi.db.prepare('UPDATE api_configs SET last_called_at = ? WHERE id = ?')
        .run(Date.now(), configId);

    } catch (err) {
      const errStatus = err.response?.status || 0;
      dbApi.log({
        config_id: configId, endpoint: endpoint_str,
        params_json: JSON.stringify(mergedParams),
        source: 'api', status_code: errStatus,
        duration_ms: Date.now() - startTime,
        error_msg: err.message,
      });
      throw new Error(`API-Fehler [${errStatus}]: ${err.message}`);
    }

    // ── 6. Mapping anwenden ─────────────────────────────────────
    const mappedData = this._applyMapping(rawData, dbApi.getMapping(configId, endpoint_str));

    // ── 7. In Cache schreiben ───────────────────────────────────
    const retention = dbApi.getRetention(configId) || { mode: 'ttl', ttl_hours: 24 };
    let expiresAt = null;
    if (retention.mode === 'ttl') {
      const exp = new Date();
      exp.setHours(exp.getHours() + (retention.ttl_hours || 24));
      expiresAt = exp.toISOString();
    }

    dbApi.saveCache({
      request_hash: requestHash, config_id: configId,
      endpoint: endpoint_str, params_json: JSON.stringify(mergedParams),
      raw_response: JSON.stringify(rawData),
      mapped_data:  JSON.stringify(mappedData),
      status_code: statusCode, expires_at: expiresAt,
    });

    // ── 8. Archivieren (wenn aktiviert) ─────────────────────────
    if (retention.auto_archive) {
      dbApi.archive(configId, endpoint_str, mappedData);
    }

    // ── 9. Log ──────────────────────────────────────────────────
    dbApi.log({
      config_id: configId, endpoint: endpoint_str,
      params_json: JSON.stringify(mergedParams),
      source: 'api', status_code: statusCode,
      duration_ms: Date.now() - startTime, error_msg: null,
    });

    return { data: mappedData, raw: rawData, fromCache: false };
  }

  // ─── Auth-Builder ─────────────────────────────────────────────
  async _buildAuth(config, params) {
    const authConfig = safeJson(config.auth_config);
    const apiKey = dbApi.getApiKey(config.id);

    const headers     = { ...safeJson(config.default_headers) };
    const queryParams = { ...params };

    if (!apiKey && config.auth_type !== 'none') {
      // Kein Key → trotzdem versuchen (manche APIs haben Free-Endpoints)
      return { headers, queryParams };
    }

    switch (config.auth_type) {
      case 'apikey':
        queryParams[authConfig.keyParam || 'apikey'] = apiKey;
        break;
      case 'bearer':
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'header':
        headers[authConfig.headerName] = apiKey;
        break;
      case 'basic': {
        const [user, pass] = apiKey.split(':');
        headers['Authorization'] = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
        break;
      }
      case 'oauth2':
        // OAuth2: Access Token muss extern verwaltet werden (Electron-Flow)
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;
    }
    return { headers, queryParams };
  }

  // ─── Rate-Limit ───────────────────────────────────────────────
  async _respectRateLimit(config) {
    const now       = Date.now();
    const lastCall  = config.last_called_at || 0;
    const minGap    = config.rate_limit_ms || 200;
    const wait      = minGap - (now - lastCall);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }

  // ─── Mapping anwenden ─────────────────────────────────────────
  _applyMapping(rawData, mapping) {
    if (!mapping || Object.keys(mapping).length === 0) {
      // Kein Mapping: Flat-Variante zurückgeben
      return flat(rawData, { delimiter: '_', maxDepth: 4 });
    }
    const result = {};
    const getDeep = (obj, path) =>
      path.split('.').reduce((acc, key) => {
        if (acc === null || acc === undefined) return undefined;
        // Array-Zugriff: "items.0.name" → items[0].name
        return !isNaN(key) ? acc[parseInt(key)] : acc[key];
      }, obj);

    for (const [apiPath, cleanName] of Object.entries(mapping)) {
      const val = getDeep(rawData, apiPath);
      if (val !== undefined) result[cleanName] = val;
    }
    // Felder ohne Mapping zusätzlich anhängen (als flat)
    const flatAll = flat(rawData, { delimiter: '_', maxDepth: 3 });
    const mappedPaths = new Set(Object.values(mapping));
    for (const [key, val] of Object.entries(flatAll)) {
      if (!mappedPaths.has(key)) result[`_raw_${key}`] = val;
    }
    return result;
  }

  // ─── Convenience-Shortcuts ────────────────────────────────────

  /** Wetter aktuell */
  async weather(city, provider = 'openweathermap') {
    return this.call(provider, provider === 'openweathermap' ? '/weather' : '/current.json', { q: city });
  }

  /** Wetter-Forecast */
  async forecast(city, days = 5, provider = 'openweathermap') {
    if (provider === 'openweathermap') return this.call(provider, '/forecast', { q: city, cnt: days * 8 });
    return this.call(provider, '/forecast.json', { q: city, days });
  }

  /** Web-Suche */
  async search(query, provider = 'bing-search') {
    const ep = provider === 'bing-search' ? '/search' : '';
    return this.call(provider, ep, { q: query });
  }

  /** News-Suche */
  async news(query, options = {}) {
    if (options.provider === 'bing') return this.call('bing-search', '/news/search', { q: query });
    return this.call('newsapi', '/everything', { q: query, language: 'de', ...options });
  }

  /** Geocoding */
  async geocode(address, provider = 'openstreetmap-nominatim') {
    return this.call(provider, '/search', { q: address, limit: 5 });
  }

  /** Aktienkurs */
  async stockQuote(symbol) {
    return this.call('alpha-vantage', '', { function: 'GLOBAL_QUOTE', symbol });
  }

  /** Google Search Console — Search Analytics */
  async gscSearchAnalytics(siteUrl, startDate, endDate, dimensions = ['query', 'page']) {
    const endpoint = `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    return this.call('google-search-console', endpoint, {}, {
      method: 'POST',
      body: { startDate, endDate, dimensions, rowLimit: 1000 },
    });
  }

  /** DataForSEO — SERP-Analyse */
  async seoSerp(keyword, locationCode = 2276 /* Deutschland */, languageCode = 'de') {
    return this.call('dataforseo', '/serp/google/organic/live/advanced', {}, {
      method: 'POST',
      body: [{ keyword, location_code: locationCode, language_code: languageCode }],
    });
  }

  /** DataForSEO — Keyword-Daten für Domain */
  async seoKeywords(domain, locationCode = 2276) {
    return this.call('dataforseo', '/keywords_data/google_ads/keywords_for_site/live', {}, {
      method: 'POST',
      body: [{ target: domain, location_code: locationCode }],
    });
  }

  /** Google Trends — Zeitverlauf */
  async trends(keyword, geo = 'DE') {
    return this.call('google-trends', '/search', { q: keyword, data_type: 'TIMESERIES', geo });
  }

  /** Freier API-Call mit Custom-Config */
  async custom(baseUrl, endpoint, params = {}, options = {}) {
    const tempId = 'custom_' + Date.now();
    dbApi.saveConfig({
      id: tempId, name: 'Custom', base_url: baseUrl,
      auth_type: options.authType || 'none',
      default_headers: options.headers || {},
    });
    if (options.apiKey) dbApi.saveApiKey(tempId, options.apiKey);
    const result = await this.call(tempId, endpoint, params, options);
    dbApi.deleteConfig(tempId);
    return result;
  }

  // ─── SHOPIFY METHODEN ─────────────────────────────────────────

  /** Shopify — Produkte abrufen */
  async shopifyProducts(limit = 250) {
    return this.call('shopify', '/products.json', { limit });
  }

  /** Shopify — Bestellungen abrufen */
  async shopifyOrders(limit = 250, status = 'any') {
    return this.call('shopify', '/orders.json', { limit, status });
  }

  /** Shopify — Kunden abrufen */
  async shopifyCustomers(limit = 250) {
    return this.call('shopify', '/customers.json', { limit });
  }

  /** Shopify — Shop-Informationen */
  async shopifyShopInfo() {
    return this.call('shopify', '/shop.json', {});
  }

  /** Shopify — Varianten für Produkt */
  async shopifyVariants(productId, limit = 250) {
    return this.call('shopify', `/products/${productId}/variants.json`, { limit });
  }

  /** Shopify — Fulfillments für Bestellung */
  async shopifyFulfillments(orderId) {
    return this.call('shopify', `/orders/${orderId}/fulfillments.json`, {});
  }

  // ─── Verwaltungs-Methoden ─────────────────────────────────────

  /** API-Key setzen */
  setApiKey(configId, key) {
    dbApi.saveApiKey(configId, key);
    return this;
  }

  /** Neue API registrieren */
  register(config) {
    dbApi.saveConfig(config);
    dbApi.saveRetention(config.id, config.retention || { mode: 'ttl', ttl_hours: 24 });
    return this;
  }

  /** Cache leeren */
  clearCache(configId = null) {
    dbApi.clearCache(configId);
    return this;
  }

  /** Retention konfigurieren */
  setRetention(configId, rule) {
    dbApi.saveRetention(configId, rule);
    return this;
  }

  /** Alle verfügbaren APIs auflisten */
  listApis() {
    return dbApi.getAllConfigs().map(c => ({
      id: c.id, name: c.name, category: c.category,
      hasKey: !!dbApi.getApiKey(c.id),
    }));
  }

  /** Statistiken */
  stats(configId = null) {
    return configId ? dbApi.getStats(configId) : dbApi.getGlobalStats();
  }

  /** KI-Mapping manuell setzen */
  setMapping(configId, endpoint, mapping) {
    dbApi.saveMapping(configId, endpoint, mapping);
    return this;
  }

  /** Historisches Archiv abrufen */
  getHistory(configId, endpoint, limit = 100) {
    return dbApi.getArchive(configId, endpoint, limit);
  }
}

// ─── Singleton ───────────────────────────────────────────────────
const api = new ApiHandler();
module.exports = api;