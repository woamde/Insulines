"""Rapport médecin PDF : glycémies, TIR, insuline, glucides, poids."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from io import BytesIO
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import base64
import ipaddress
import logging
import os
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from starlette.responses import Response

BRAND = colors.HexColor("#0F766E")
BRAND_LIGHT = colors.HexColor("#CCFBF1")
GREY = colors.HexColor("#64748B")
LIGHT = colors.HexColor("#F1F5F9")
RED = colors.HexColor("#DC2626")
GREEN = colors.HexColor("#16A34A")
AMBER = colors.HexColor("#D97706")

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# E-mail (Emergent managed Resend) — URL constante, clé côté serveur uniquement
# ---------------------------------------------------------------------------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "GlycoSoin T1D")
EMAIL_DAILY_LIMIT = 5

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


async def send_report_email(*, to: str, subject: str, html: str, pdf: bytes | None = None, filename: str = "") -> str:
    _assert_safe_email(subject, html)
    if not EMAIL_KEY:
        raise HTTPException(status_code=503, detail="Envoi d'e-mail non configuré")
    payload = {
        "to": [to],
        "subject": subject,
        "html": html,
        "from_name": EMAIL_FROM_NAME,
    }
    if pdf is not None:
        payload["attachments"] = [{"filename": filename, "content": base64.b64encode(pdf).decode()}]
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
        resp.raise_for_status()
        return resp.json().get("id") or ""
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text[:200]}")
        raise HTTPException(status_code=502, detail="L'envoi de l'e-mail a échoué, réessayez plus tard")
    except httpx.HTTPError as e:
        logger.error(f"Email send error: {e}")
        raise HTTPException(status_code=502, detail="Service d'e-mail indisponible, réessayez plus tard")


MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def _tz(name: str):
    try:
        return ZoneInfo(name or "Europe/Paris")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("Europe/Paris")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _fmt_date(d) -> str:
    return f"{d.day} {MONTHS_FR[d.month - 1]} {d.year}"


def _fmt(v, digits=0, unit="") -> str:
    if v is None:
        return "—"
    txt = f"{v:.{digits}f}".replace(".", ",")
    return f"{txt}{unit}"


def _glucose_chart(readings, tz, days: int, width: float, height: float, low_t: float = 70, high_t: float = 180) -> Drawing:
    d = Drawing(width, height)
    if not readings:
        d.add(String(width / 2, height / 2, "Aucune mesure sur la période", textAnchor="middle", fontSize=9, fillColor=GREY))
        return d
    start = _aware(readings[0]["measured_at"])
    pts = [((_aware(r["measured_at"]) - start).total_seconds() / 86400, r["value_mgdl"]) for r in readings]
    x_max = max(1.0, max(p[0] for p in pts))

    lp = LinePlot()
    lp.x, lp.y, lp.width, lp.height = 36, 22, width - 48, height - 34
    lp.data = [pts]
    lp.lines[0].strokeColor = BRAND
    lp.lines[0].strokeWidth = 0.9 if len(pts) > 150 else 1.3
    lp.joinedLines = 1
    lp.xValueAxis.valueMin = 0
    lp.xValueAxis.valueMax = x_max
    lp.xValueAxis.valueSteps = [round(x_max * i / 6, 1) for i in range(7)]
    lp.xValueAxis.labelTextFormat = lambda v: (start + timedelta(days=v)).astimezone(tz).strftime("%d/%m")
    lp.xValueAxis.labels.fontSize = 7
    lp.yValueAxis.valueMin = 40
    lp.yValueAxis.valueMax = max(300, max(p[1] for p in pts) + 20)
    lp.yValueAxis.valueSteps = [40, 70, 100, 140, 180, 250, 300]
    lp.yValueAxis.labels.fontSize = 7

    # bande cible 70–180
    def y_for(v):
        return lp.y + (v - lp.yValueAxis.valueMin) / (lp.yValueAxis.valueMax - lp.yValueAxis.valueMin) * lp.height

    d.add(Rect(lp.x, y_for(low_t), lp.width, y_for(high_t) - y_for(low_t), fillColor=BRAND_LIGHT, strokeColor=None))
    d.add(Line(lp.x, y_for(low_t), lp.x + lp.width, y_for(low_t), strokeColor=RED, strokeWidth=0.5, strokeDashArray=[2, 2]))
    d.add(Line(lp.x, y_for(high_t), lp.x + lp.width, y_for(high_t), strokeColor=AMBER, strokeWidth=0.5, strokeDashArray=[2, 2]))
    d.add(lp)
    d.add(String(4, height - 10, "mg/dL", fontSize=7, fillColor=GREY))
    return d


def _tir_bar(low: float, in_range: float, high: float, width: float) -> Drawing:
    h = 10
    d = Drawing(width, h)
    x = 0
    for pct, col in ((low, RED), (in_range, GREEN), (high, AMBER)):
        w = width * pct / 100
        if w > 0:
            d.add(Rect(x, 0, w, h, fillColor=col, strokeColor=None))
        x += w
    return d


ACTIVITY_LABELS = {"marche": "Marche", "course": "Course", "velo": "Vélo", "natation": "Natation", "musculation": "Musculation", "autre": "Autre"}
INTENSITY_LABELS = {"legere": "légère", "moderee": "modérée", "intense": "intense"}


def build_pdf(*, user: dict, profile: dict, days: int, tz_name: str, readings, meals, doses, weights, activities=()) -> bytes:
    tz = _tz(tz_name)
    low_t = float(profile.get("target_low") or 70)
    high_t = float(profile.get("target_high") or 180)
    tir_goal = float(profile.get("tir_goal") or 70)
    lo, hi = _fmt(low_t, 0), _fmt(high_t, 0)
    now = datetime.now(tz)
    start = now - timedelta(days=days)
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
        title=f"Rapport glycémique — {profile.get('name') or user.get('name') or ''}",
        author="GlycoSoin T1D",
    )
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=18, textColor=BRAND, alignment=0, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12, textColor=BRAND, spaceBefore=10, spaceAfter=6)
    body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=9, leading=12)
    small = ParagraphStyle("small", parent=body, fontSize=8, textColor=GREY)
    cell = ParagraphStyle("cell", parent=body, fontSize=8, leading=10)
    cell_c = ParagraphStyle("cellc", parent=cell, alignment=TA_CENTER)
    W = A4[0] - doc.leftMargin - doc.rightMargin

    story = []
    name = profile.get("name") if profile.get("name") and profile.get("name") != "Profil" else (user.get("name") or "")
    story.append(Paragraph("Rapport de suivi glycémique", h1))
    story.append(Paragraph(
        f"Diabète de type 1 · Période du {_fmt_date(start)} au {_fmt_date(now)} ({days} jours) · "
        f"Généré le {_fmt_date(now)} à {now.strftime('%H:%M')} avec GlycoSoin T1D", small))
    story.append(Spacer(1, 6))

    # --- Patient
    weight_now = weights[-1]["weight_kg"] if weights else profile.get("weight_kg")
    height = profile.get("height_cm")
    bmi = (weight_now / ((height / 100) ** 2)) if (weight_now and height) else None
    patient_rows = [
        ["Patient", name or "—", "Âge", _fmt(profile.get("age"), 0, " ans")],
        ["Ancienneté du diabète", _fmt(profile.get("diabetes_years"), 0, " ans"), "Taille", _fmt(height, 0, " cm")],
        ["Poids actuel", _fmt(weight_now, 1, " kg"), "IMC", _fmt(bmi, 1)],
        ["Ratio I/C", _fmt(profile.get("ic_ratio"), 1, " g/U"), "Sensibilité (ISF)", _fmt(profile.get("isf"), 0, " mg/dL/U")],
        ["Glycémie cible (correction)", _fmt(profile.get("target_glucose"), 0, " mg/dL"), "Plage cible", f"{lo}–{hi} mg/dL"],
    ]
    t = Table(patient_rows, colWidths=[W * 0.24, W * 0.26, W * 0.22, W * 0.28])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("TEXTCOLOR", (0, 0), (0, -1), GREY), ("TEXTCOLOR", (2, 0), (2, -1), GREY),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [LIGHT, colors.white]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
    ]))
    story.append(t)

    # --- Synthèse glycémique
    values = [r["value_mgdl"] for r in readings]
    n = len(values)
    avg = sum(values) / n if n else None
    hba1c = (avg + 46.7) / 28.7 if avg else None
    hypo = sum(1 for v in values if v < low_t)
    hyper = sum(1 for v in values if v > high_t)
    severe_hypo = sum(1 for v in values if v < 54)
    tir_low = hypo / n * 100 if n else 0
    tir_high = hyper / n * 100 if n else 0
    tir_in = 100 - tir_low - tir_high if n else 0
    sd = (sum((v - avg) ** 2 for v in values) / n) ** 0.5 if n > 1 else None
    cv = sd / avg * 100 if (sd and avg) else None

    story.append(Paragraph("Synthèse glycémique", h2))
    synth = [
        ["Mesures", "Moyenne", "HbA1c estimée", "Écart-type / CV", f"Sous la cible < {lo}", "Hypo sévère < 54", f"Au-dessus > {hi}"],
        [str(n), _fmt(avg, 0, " mg/dL"), _fmt(hba1c, 1, " %"),
         f"{_fmt(sd, 0)} / {_fmt(cv, 0, ' %')}" if sd else "—", str(hypo), str(severe_hypo), str(hyper)],
    ]
    t = Table(synth, colWidths=[W / 7] * 7)
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BACKGROUND", (0, 0), (-1, 0), BRAND), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"), ("FONTSIZE", (0, 1), (-1, 1), 10),
        ("TEXTCOLOR", (4, 1), (5, 1), RED if hypo else colors.black), ("TEXTCOLOR", (6, 1), (6, 1), AMBER if hyper else colors.black),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
    ]))
    story.append(t)
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"<b>Temps dans la cible ({lo}–{hi} mg/dL) : {_fmt(tir_in, 0)} %</b> &nbsp;·&nbsp; "
        f"<font color='#DC2626'>en dessous {_fmt(tir_low, 0)} %</font> &nbsp;·&nbsp; "
        f"<font color='#D97706'>au-dessus {_fmt(tir_high, 0)} %</font> &nbsp;·&nbsp; objectif personnel > {_fmt(tir_goal, 0)} %"
        + (" — atteint" if tir_in >= tir_goal else ""), body))
    story.append(Spacer(1, 3))
    story.append(_tir_bar(tir_low, tir_in, tir_high, W))

    # --- Courbe
    story.append(Paragraph("Évolution de la glycémie", h2))
    story.append(_glucose_chart(readings, tz, days, W, 150, low_t, high_t))

    # --- Insuline & glucides
    basal = [d for d in doses if d["kind"] == "basale"]
    bolus_inj = [d for d in doses if d["kind"] != "basale"]
    basal_total = sum(d["units"] for d in basal)
    bolus_total = sum(d["units"] for d in bolus_inj) + sum((m.get("insulin_units") or 0) for m in meals)
    carbs_total = sum((m.get("carbs_g") or 0) for m in meals)
    basal_days = len({_aware(d["injected_at"]).astimezone(tz).date() for d in basal}) or 1
    total_daily = (basal_total + bolus_total) / days if days else 0
    basal_share = basal_total / (basal_total + bolus_total) * 100 if (basal_total + bolus_total) else None
    basal_names = sorted({d["insulin_name"] for d in basal if d.get("insulin_name")})

    story.append(Paragraph("Insuline et glucides", h2))
    ins = [
        ["Basale (lente)", "Bolus (rapide)", "Total quotidien moyen", "Part basale", "Glucides / jour", "Repas enregistrés"],
        [f"{_fmt(basal_total, 0, ' U')} · {_fmt(basal_total / basal_days, 1, ' U/j')}",
         f"{_fmt(bolus_total, 0, ' U')} · {_fmt(bolus_total / days, 1, ' U/j')}",
         _fmt(total_daily, 1, " U/j"), _fmt(basal_share, 0, " %"), _fmt(carbs_total / days, 0, " g"), str(len(meals))],
    ]
    t = Table(ins, colWidths=[W / 6] * 6)
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BACKGROUND", (0, 0), (-1, 0), BRAND), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
    ]))
    story.append(t)
    if basal_names:
        story.append(Spacer(1, 3))
        story.append(Paragraph(f"Insuline(s) basale(s) utilisée(s) : {', '.join(basal_names)}", small))

    # --- Poids
    story.append(Paragraph("Évolution du poids", h2))
    if weights:
        first, last = weights[0]["weight_kg"], weights[-1]["weight_kg"]
        delta = last - first
        sign = "+" if delta > 0 else ""
        trend = "stable" if abs(delta) < 0.5 else ("prise de poids" if delta > 0 else "perte de poids")
        story.append(Paragraph(
            f"<b>{_fmt(first, 1, ' kg')}</b> le {_fmt_date(_aware(weights[0]['measured_at']).astimezone(tz))} → "
            f"<b>{_fmt(last, 1, ' kg')}</b> le {_fmt_date(_aware(weights[-1]['measured_at']).astimezone(tz))} · "
            f"variation <b>{sign}{_fmt(delta, 1, ' kg')}</b> ({trend}) · {len(weights)} pesée(s)", body))
        if len(weights) > 1:
            rows = [["Date", "Poids", "Note"]] + [
                [_fmt_date(_aware(w["measured_at"]).astimezone(tz)), _fmt(w["weight_kg"], 1, " kg"), Paragraph(w.get("note") or "", cell)]
                for w in weights[-12:]
            ]
            t = Table(rows, colWidths=[W * 0.3, W * 0.2, W * 0.5], repeatRows=1)
            t.setStyle(TableStyle([
                ("FONTSIZE", (0, 0), (-1, -1), 8), ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
                ("TEXTCOLOR", (0, 0), (-1, 0), GREY), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#E2E8F0")),
            ]))
            story.append(Spacer(1, 4))
            story.append(t)
    else:
        story.append(Paragraph("Aucune pesée enregistrée sur la période." + (f" Poids du profil : {_fmt(weight_now, 1, ' kg')}." if weight_now else ""), body))

    # --- Activité physique
    if activities:
        story.append(Paragraph("Activité physique", h2))
        total_min = sum(a.get("duration_min", 0) for a in activities)
        story.append(Paragraph(
            f"<b>{len(activities)} séance(s)</b> · {total_min} min au total · {_fmt(total_min / days * 7, 0, ' min')} par semaine en moyenne", body))
        rows = [["Date", "Activité", "Durée", "Intensité", "Note"]] + [
            [_fmt_date(_aware(a["started_at"]).astimezone(tz)), ACTIVITY_LABELS.get(a["activity_type"], a["activity_type"]),
             f"{a['duration_min']} min", INTENSITY_LABELS.get(a["intensity"], a["intensity"]), Paragraph(a.get("note") or "", cell)]
            for a in sorted(activities, key=lambda x: x["started_at"], reverse=True)[:15]
        ]
        t = Table(rows, colWidths=[W * 0.22, W * 0.2, W * 0.13, W * 0.15, W * 0.3], repeatRows=1)
        t.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 8), ("BACKGROUND", (0, 0), (-1, 0), LIGHT), ("TEXTCOLOR", (0, 0), (-1, 0), GREY),
            ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#E2E8F0")),
        ]))
        story.append(Spacer(1, 4))
        story.append(t)

    # --- Détail journalier
    by_day = defaultdict(lambda: {"g": [], "carbs": 0.0, "bolus": 0.0, "basal": 0.0})
    for r in readings:
        by_day[_aware(r["measured_at"]).astimezone(tz).date()]["g"].append(r["value_mgdl"])
    for m in meals:
        day = by_day[_aware(m["eaten_at"]).astimezone(tz).date()]
        day["carbs"] += m.get("carbs_g") or 0
        day["bolus"] += m.get("insulin_units") or 0
    for d_ in doses:
        day = by_day[_aware(d_["injected_at"]).astimezone(tz).date()]
        day["basal" if d_["kind"] == "basale" else "bolus"] += d_["units"]

    story.append(Paragraph("Détail par jour", h2))
    rows = [[Paragraph(x, cell_c) for x in ["Date", "Mesures", "Moyenne", "Min", "Max", "TIR", "Glucides", "Bolus", "Basale"]]]
    for day in sorted(by_day.keys(), reverse=True):
        g = by_day[day]["g"]
        tir = sum(1 for v in g if low_t <= v <= high_t) / len(g) * 100 if g else None
        rows.append([
            day.strftime("%a %d/%m").replace("Mon", "lun").replace("Tue", "mar").replace("Wed", "mer").replace("Thu", "jeu").replace("Fri", "ven").replace("Sat", "sam").replace("Sun", "dim"),
            str(len(g)), _fmt(sum(g) / len(g) if g else None, 0), _fmt(min(g) if g else None, 0), _fmt(max(g) if g else None, 0),
            _fmt(tir, 0, " %"), _fmt(by_day[day]["carbs"], 0, " g"), _fmt(by_day[day]["bolus"], 1, " U"), _fmt(by_day[day]["basal"], 1, " U"),
        ])
    if len(rows) == 1:
        story.append(Paragraph("Aucune donnée journalière sur la période.", body))
    else:
        t = Table(rows, colWidths=[W * 0.16] + [W * 0.105] * 8, repeatRows=1)
        style = [
            ("FONTSIZE", (0, 0), (-1, -1), 7.5), ("ALIGN", (1, 0), (-1, -1), "CENTER"),
            ("BACKGROUND", (0, 0), (-1, 0), BRAND), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#E2E8F0")),
        ]
        for i, day in enumerate(sorted(by_day.keys(), reverse=True), start=1):
            g = by_day[day]["g"]
            if g and min(g) < low_t:
                style.append(("TEXTCOLOR", (3, i), (3, i), RED))
            if g and max(g) > 250:
                style.append(("TEXTCOLOR", (4, i), (4, i), AMBER))
        t.setStyle(TableStyle(style))
        story.append(t)

    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "Les valeurs sont issues des saisies de l'utilisateur et de son capteur de glucose en continu (le cas échéant). "
        "HbA1c estimée à partir de la glycémie moyenne (formule ADAG) : indicative, ne remplace pas le dosage en laboratoire. "
        "Document destiné à faciliter l'échange avec l'équipe soignante.", small))

    doc.build(story)
    return buf.getvalue()


def register_report(api_router: APIRouter, db, get_current_user) -> None:
    async def _generate(uid: str, user: dict, days: int, tz: str) -> tuple[bytes, str, dict]:
        days = max(7, min(days, 180))
        start = datetime.now(timezone.utc) - timedelta(days=days)
        profile = await db.profiles.find_one({"user_id": uid}) or {}
        readings = await db.glucose_readings.find(
            {"user_id": uid, "deleted_at": None, "measured_at": {"$gte": start}}
        ).sort("measured_at", 1).to_list(50000)
        meals = await db.meals.find({"user_id": uid, "deleted_at": None, "eaten_at": {"$gte": start}}).to_list(10000)
        doses = await db.insulin_doses.find({"user_id": uid, "deleted_at": None, "injected_at": {"$gte": start}}).to_list(10000)
        weights = await db.weight_entries.find(
            {"user_id": uid, "deleted_at": None, "measured_at": {"$gte": start}}
        ).sort("measured_at", 1).to_list(1000)
        activities = await db.activities.find({"user_id": uid, "deleted_at": None, "started_at": {"$gte": start}}).to_list(2000)
        pdf = await run_in_threadpool(
            build_pdf, user=user, profile=profile, days=days, tz_name=tz,
            readings=readings, meals=meals, doses=doses, weights=weights, activities=activities,
        )
        filename = f"glycosoin-rapport-{days}j-{datetime.now().strftime('%Y%m%d')}.pdf"
        return pdf, filename, profile

    @api_router.post("/report/email")
    async def report_email(days: int = 90, tz: str = "Europe/Paris", user: dict = Depends(get_current_user)):
        """Envoie le PDF au médecin enregistré dans le profil (destinataire côté serveur, modèle fixe)."""
        uid = user["user_id"]
        profile = await db.profiles.find_one({"user_id": uid}) or {}
        to = (profile.get("doctor_email") or "").strip().lower()
        if not to:
            raise HTTPException(status_code=400, detail="Renseignez l'e-mail de votre médecin dans votre profil")
        since = datetime.now(timezone.utc) - timedelta(days=1)
        sent_today = await db.report_emails.count_documents({"user_id": uid, "sent_at": {"$gte": since}})
        if sent_today >= EMAIL_DAILY_LIMIT:
            raise HTTPException(status_code=429, detail=f"Limite de {EMAIL_DAILY_LIMIT} envois par jour atteinte")

        pdf, filename, profile = await _generate(uid, user, days, tz)
        days = max(7, min(days, 180))
        patient = profile.get("name") if profile.get("name") and profile.get("name") != "Profil" else (user.get("name") or "un patient")
        doctor = (profile.get("doctor_name") or "").strip()
        subject = f"Rapport glycémique de {patient} — {days} jours"
        html = (
            '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#0F172A">'
            f'<p>Bonjour{(" " + escape(doctor)) if doctor else ""},</p>'
            f'<p>Vous trouverez en pièce jointe le rapport de suivi glycémique de <strong>{escape(patient)}</strong> '
            f'sur les <strong>{days} derniers jours</strong> (glycémies, temps dans la cible, HbA1c estimée, insuline, glucides, poids).</p>'
            f'<p>Ce document a été généré à la demande du patient depuis son application de suivi du diabète de type 1.</p>'
            f'<p style="font-size:12px;color:#64748B">Envoyé par {escape(EMAIL_FROM_NAME)}. Les valeurs proviennent des saisies du patient '
            f'et de son capteur ; l\'HbA1c est une estimation indicative.</p></td></tr></table>'
        )
        email_id = await send_report_email(to=to, subject=subject, html=html, pdf=pdf, filename=filename)
        await db.report_emails.insert_one({"user_id": uid, "to": to, "days": days, "email_id": email_id, "sent_at": datetime.now(timezone.utc)})
        return {"ok": True, "to": to, "days": days}

    @api_router.get("/report/pdf")
    async def report_pdf(days: int = 90, tz: str = "Europe/Paris", user: dict = Depends(get_current_user)):
        pdf, filename, _ = await _generate(user["user_id"], user, days, tz)
        return Response(
            content=pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
