import sqlite3
from datetime import datetime

DB_NAME = "repas.db"

def init_db():
    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS historique_repas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date_creation TEXT NOT NULL,
                nom_plat TEXT NOT NULL,
                glucides_g REAL NOT NULL,
                dose_insuline_u REAL NOT NULL,
                niveau_confiance TEXT NOT NULL
            )
        """)
        conn.commit()

def enregistrer_repas(nom_plat: str, glucides: float, dose: float, confiance: str):
    with sqlite3.connect(DB_NAME) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO historique_repas (date_creation, nom_plat, glucides_g, dose_insuline_u, niveau_confiance)
            VALUES (?, ?, ?, ?, ?)
        """, (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), nom_plat, glucides, dose, confiance))
        conn.commit()

def obtenir_historique():
    with sqlite3.connect(DB_NAME) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM historique_repas ORDER BY id DESC")
        rows = cursor.fetchall()
        return [dict(row) for row in rows]