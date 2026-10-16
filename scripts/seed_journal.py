"""Seed script to import CSV rows into MongoDB glucose_readings collection.
Usage:
  python scripts\seed_journal.py scripts\samples\sample_journal.csv

The script reads CSV rows with headers: value_mgdl,insulin_units,meal_carbs,notes,measured_at
It uses MONGO_URI environment variable if set, otherwise mongodb://localhost:27017
"""
import os
import csv
import sys
from pymongo import MongoClient

def main(csv_path: str):
    mongo_uri = os.getenv('MONGO_URI') or os.getenv('MONGODB_URI') or 'mongodb://localhost:27017'
    client = MongoClient(mongo_uri)
    db = client.get_database('glycosoin')
    coll = db.get_collection('glucose_readings')

    inserted = 0
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            doc = {}
            if row.get('value_mgdl'):
                try:
                    doc['value_mgdl'] = float(row['value_mgdl'])
                except ValueError:
                    doc['value_mgdl'] = None
            if row.get('insulin_units'):
                try:
                    doc['insulin_units'] = float(row['insulin_units'])
                except ValueError:
                    doc['insulin_units'] = None
            if row.get('meal_carbs'):
                try:
                    doc['meal_carbs'] = float(row['meal_carbs'])
                except ValueError:
                    doc['meal_carbs'] = None
            if row.get('notes'):
                doc['notes'] = row['notes']
            if row.get('measured_at'):
                doc['timestamp'] = row['measured_at']
            if doc:
                coll.insert_one(doc)
                inserted += 1
    print(f"Inserted {inserted} documents into glycosoin.glucose_readings")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python scripts\\seed_journal.py path/to/file.csv')
        sys.exit(1)
    main(sys.argv[1])
