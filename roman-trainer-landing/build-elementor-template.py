#!/usr/bin/env python3
"""Genera un template Elementor (.json) a partir del index.html de la landing.

Empaqueta toda la landing dentro de un único widget HTML, en una sección a
ancho completo, con la plantilla de página Canvas (sin header/footer del tema).
Importable desde: Elementor > Plantillas > Plantillas guardadas > Importar.
"""
import json
import re
import secrets
from pathlib import Path

SRC = Path("roman-trainer-landing/index.html")
OUT = Path("roman-trainer-landing/roman-trainer-elementor-template.json")

html = SRC.read_text(encoding="utf-8")

# --- Extraer el <head> y quedarnos con fuentes, tailwind y <style> ---
head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
# Quitar meta/title que no aportan dentro de un widget
head = re.sub(r"<meta[^>]*>", "", head)
head = re.sub(r"<title>.*?</title>", "", head, flags=re.S)
head_kept = head.strip()

# --- Extraer el contenido del <body> (incluye el <script> final) ---
body_inner = re.search(r"<body[^>]*>(.*?)</body>", html, re.S).group(1).strip()
# Clases del body para conservarlas en un wrapper
body_classes = re.search(r"<body([^>]*)>", html).group(1)
m_cls = re.search(r'class="([^"]*)"', body_classes)
wrapper_class = m_cls.group(1) if m_cls else ""

widget_html = (
    f"{head_kept}\n"
    f'<div class="{wrapper_class}">\n{body_inner}\n</div>'
)

def eid() -> str:
    return secrets.token_hex(4)[:7]

template = {
    "content": [
        {
            "id": eid(),
            "elType": "section",
            "settings": {
                "layout": "full_width",
                "gap": "no",
                "padding": {"unit": "px", "top": "0", "right": "0", "bottom": "0", "left": "0", "isLinked": True},
                "margin": {"unit": "px", "top": "0", "right": "0", "bottom": "0", "left": "0", "isLinked": True},
            },
            "elements": [
                {
                    "id": eid(),
                    "elType": "column",
                    "settings": {"_column_size": 100, "_inline_size": None},
                    "elements": [
                        {
                            "id": eid(),
                            "elType": "widget",
                            "widgetType": "html",
                            "settings": {"html": widget_html},
                        }
                    ],
                    "isInner": False,
                }
            ],
            "isInner": False,
        }
    ],
    "page_settings": {
        "template": "elementor_canvas",
        "hide_title": "yes",
    },
    "version": "0.4",
    "title": "Roman Trainer — Landing",
    "type": "page",
}

OUT.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"OK -> {OUT} ({OUT.stat().st_size} bytes)")
print(f"widget html: {len(widget_html)} chars | wrapper class: {wrapper_class[:40]}...")
