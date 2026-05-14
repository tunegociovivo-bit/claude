# AI Web Designer for Elementor

Plugin de WordPress que genera diseños web completos en Elementor a partir de un briefing guiado, integrándose con Claude para diseño y contenidos, generación de imágenes IA, SEO, legales, e integraciones externas.

## Características

### Captura de información (Wizard 10 pasos)
1. **Negocio**: nombre, sector, descripción, público, tono, USP, competidores.
2. **Marca**: logo (subir o generar IA), paleta, tipografías, eslogan.
3. **Contacto y dominio**: email, teléfono, WhatsApp, dirección, horario, redes, maps. Importador desde dominio existente.
4. **Fotos**: galería masiva con drag&drop, generación IA de imágenes faltantes, eliminación de fondos.
5. **Textos**: hero, sobre nosotros, servicios, por qué elegirnos, testimonios, FAQ, CTA. Botón "Generar IA" y "Ver 3 variantes" por bloque.
6. **Referencias visuales**: pega URLs, la IA extrae patrones.
7. **Páginas y estructura**: Home, Servicios, About, Blog, Contacto, Tienda, Reservas + posts iniciales.
8. **SEO + legal**: keywords, meta, Schema.org, RGPD/cookies/aviso por país.
9. **Integraciones**: WhatsApp, Calendly, GMB, CRM, idiomas, GA4.
10. **Generar diseño**: web completa, 3 propuestas o propuesta PDF.

### IA
- **Claude API** (texto, briefing, SEO, legales, traducciones, design blueprint).
- **Imágenes**: OpenAI (DALL·E / gpt-image-1), Stability, Flux, Replicate.
- **Remove.bg** para quitar fondos.
- **Scraper** de dominios (logo, colores, redes, contacto).

### Elementor
- **Template Builder** que convierte el blueprint JSON de Claude en `_elementor_data` real.
- **Librería de plantillas por sector**: restaurante, abogados, clínica, ecommerce, portfolio, inmobiliaria, educación, beauty, construcción, SaaS, ONG.
- **Bloques soportados**: hero, features, about, gallery, services, testimonials, faq, cta, contact, map, pricing, team, stats, blog.

### Workflow
- **Roles**: administrator / Diseñador IA / Cliente Web.
- **Aprobación sección por sección**, comentarios, versionado, rollback.
- **Estado del proyecto**: borrador → briefing → revisión → aprobado → publicado.

### SEO / Legal
- Meta title/description automáticos compatibles con Yoast y Rank Math.
- **Schema.org** según tipo (LocalBusiness, Restaurant, Service, etc.).
- Generación de **política de privacidad, cookies y aviso legal** adaptada al país.
- **Banner de cookies** integrado.

### Integraciones externas
- WhatsApp flotante.
- Google Business Profile (place details + reviews + maps embed).
- Calendly.
- WPML / Polylang (traducción automática con Claude).
- GA4.

### Modo agencia
- Taxonomía de clientes.
- Tracking de coste IA (tokens + dólares por proyecto).
- Exportación del kit Elementor.
- Dashboard multi-cliente.

## Instalación

1. Sube la carpeta `ai-web-designer/` a `wp-content/plugins/`.
2. Activa el plugin.
3. Ve a **AI Web Designer → Ajustes** y configura tus API keys.
4. Crea tu primer proyecto.

## Requisitos

- WordPress 6.2+
- PHP 8.0+
- Elementor (Free o Pro)
- API key de Claude (Anthropic)
- API key del proveedor de imágenes elegido

## Estructura

```
ai-web-designer/
├── ai-web-designer.php          # Bootstrap
├── uninstall.php
├── readme.txt
├── includes/
│   ├── helpers.php
│   ├── class-plugin.php
│   ├── class-activator.php / class-deactivator.php
│   ├── class-database.php       # Tablas: versions, assets, ai_logs, comments, approvals
│   ├── class-cpt-project.php
│   ├── class-i18n.php
│   ├── ai/
│   │   ├── class-claude-client.php
│   │   ├── class-content-generator.php
│   │   ├── class-image-generator.php
│   │   ├── class-design-generator.php
│   │   └── class-scraper.php
│   ├── elementor/
│   │   ├── class-template-builder.php
│   │   └── class-template-library.php
│   ├── seo/
│   │   ├── class-seo-generator.php
│   │   └── class-schema-generator.php
│   ├── legal/class-legal-generator.php
│   ├── integrations/
│   │   ├── class-whatsapp.php
│   │   ├── class-gmb.php
│   │   ├── class-calendly.php
│   │   └── class-wpml.php
│   └── rest/class-rest-api.php
├── admin/
│   ├── class-admin.php
│   ├── views/                    # dashboard, wizard, projects, settings, approvals, agency, costs, templates-library
│   └── assets/{css,js}
└── public/class-public.php
```

## REST API

Endpoints bajo `/wp-json/aiwd/v1/`:

- `POST /generate/text`, `/generate/variants`, `/generate/image`, `/generate/design`, `/generate/legal`, `/generate/seo`, `/generate/blog`
- `POST /scrape`
- `POST /project/{id}/save`, `/project/{id}/approve`, `/project/{id}/comment`
- `GET  /project/{id}/versions`, `/project/{id}/export`
- `POST /translate`, `/remove-bg`

Todos requieren capacidad `aiwd_manage_projects` y nonce `wp_rest`.

## Próximos pasos

- Editor visual de blueprint en el lado del navegador.
- Preview en vivo del diseño antes de aplicarlo.
- Marketplace de plantillas.
- Conexión con Stripe/WooCommerce para vender los proyectos al cliente.
